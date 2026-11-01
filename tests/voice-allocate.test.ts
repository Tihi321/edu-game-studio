import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { allocateVoice, localChain, orderLanguages, voiceReads } from '../src/engine/voice/allocate'
import type { AllocationInput, VoiceAvailability } from '../src/engine/voice/allocate'
import { DEFAULT_GEMINI_RESET_TZ, GeminiQuota, dayIn, quotaFile, quotaView } from '../src/engine/voice/quota'

/**
 * The hub's voice allocation rule (EGS-17), pure: quota math per day and time zone, the counter persisting and resetting, Croatian first, a language
 * never split, forced providers, providers that are down.
 */

const up: VoiceAvailability = {
  gemini: { up: true },
  vibetts: { up: true, reads: (l) => ['en', 'hr', 'de'].includes(l) },
  comfy: { up: true, reads: () => true }
}
const down = (what: Partial<VoiceAvailability>): VoiceAvailability => ({ ...up, ...what })

const alloc = (o: Partial<AllocationInput> & { need: Record<string, number> }) => allocateVoice({ provider: 'auto', quota: { limit: 10, used: 0 }, avail: up, ...o })
const providers = (r: ReturnType<typeof alloc>): Record<string, string> => Object.fromEntries(Object.entries(r).map(([l, a]) => [l, a.provider]))

describe('quota math', () => {
  it('remaining is limit - used and never negative; a counter of another day counts as 0', () => {
    expect(quotaView({ day: '2026-10-30', used: 4 }, { limit: 10, tz: 'UTC', day: '2026-10-30' })).toEqual({ limit: 10, used: 4, remaining: 6, day: '2026-10-30', tz: 'UTC' })
    expect(quotaView({ day: '2026-10-30', used: 14 }, { limit: 10, tz: 'UTC', day: '2026-10-30' })).toMatchObject({ used: 14, remaining: 0 })
    expect(quotaView({ day: '2026-10-29', used: 9 }, { limit: 10, tz: 'UTC', day: '2026-10-30' })).toMatchObject({ used: 0, remaining: 10 })
    expect(quotaView(null, { limit: 0, tz: 'UTC', day: '2026-10-30' })).toMatchObject({ used: 0, remaining: 0 })
  })

  it('the day follows the configured time zone; an unknown zone falls back to the default one', () => {
    // summer time (UTC-7 until 2026-11-01): Pacific midnight is 07:00 UTC; winter time (UTC-8): 08:00 UTC
    expect(dayIn('America/Los_Angeles', new Date('2026-12-01T07:59:00Z'))).toBe('2026-11-30') // 23:59 on Nov 30
    expect(dayIn('America/Los_Angeles', new Date('2026-12-01T08:01:00Z'))).toBe('2026-12-01') // just after midnight
    expect(dayIn('America/Los_Angeles', new Date('2026-10-30T06:59:00Z'))).toBe('2026-10-29') // 23:59 on the 29th
    expect(dayIn('America/Los_Angeles', new Date('2026-10-30T07:01:00Z'))).toBe('2026-10-30') // midnight passed
    expect(dayIn('UTC', new Date('2026-10-30T07:01:00Z'))).toBe('2026-10-30')
    expect(dayIn('Pacific/Auckland', new Date('2026-10-30T12:00:00Z'))).toBe('2026-10-31')
    expect(dayIn('Not/AZone', new Date('2026-10-30T06:59:00Z'))).toBe(dayIn(DEFAULT_GEMINI_RESET_TZ, new Date('2026-10-30T06:59:00Z')))
  })
})

describe('the Gemini counter in the data folder', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'edu-quota-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('persists across instances, resets on a new day at midnight of the configured zone, and exhaust / reset work', async () => {
    let now = new Date('2026-10-30T06:00:00Z') // 23:00 on the 29th Pacific
    const make = () => new GeminiQuota(dir, { limit: 10, tz: 'America/Los_Angeles', now: () => now })
    const q = make()
    expect(await q.read()).toEqual({ limit: 10, used: 0, remaining: 10, day: '2026-10-29', tz: 'America/Los_Angeles' })
    expect((await q.add()).used).toBe(1)
    expect((await q.add(3)).remaining).toBe(6)
    expect(JSON.parse(await readFile(quotaFile(dir), 'utf8'))).toEqual({ day: '2026-10-29', used: 4 })
    expect((await make().read()).used).toBe(4) // another instance reads the same file

    now = new Date('2026-10-30T07:59:00Z') // after Pacific midnight (07:00 UTC): a new day
    expect(await q.read()).toMatchObject({ day: '2026-10-30', used: 0, remaining: 10 })
    expect((await q.add()).used).toBe(1)
    expect(JSON.parse(await readFile(quotaFile(dir), 'utf8'))).toEqual({ day: '2026-10-30', used: 1 })

    expect(await q.exhaust()).toMatchObject({ used: 10, remaining: 0 }) // a quota error from Google: used = limit for that day
    expect((await make().read()).remaining).toBe(0)
    expect(await q.reset()).toMatchObject({ used: 0, remaining: 10 })
    await q.add(25)
    expect(await q.read()).toMatchObject({ used: 25, remaining: 0 }) // never negative

    now = new Date('2026-10-31T08:01:00Z') // the next day
    expect(await q.read()).toMatchObject({ day: '2026-10-31', used: 0 })
  })

  it('the same instant is another day in another zone; an invalid zone falls back; concurrent adds are not lost', async () => {
    const at = new Date('2026-10-30T07:59:00Z')
    const utc = new GeminiQuota(dir, { limit: 10, tz: 'UTC', now: () => at })
    expect((await utc.read()).day).toBe('2026-10-30')
    const la = new GeminiQuota(dir, { limit: 10, tz: 'America/Los_Angeles', now: () => at })
    expect((await la.read()).day).toBe('2026-10-30')
    const bad = new GeminiQuota(dir, { limit: 10, tz: 'Not/AZone', now: () => new Date('2026-10-30T06:00:00Z') })
    expect((await bad.read()).day).toBe('2026-10-29') // the Pacific day
    await Promise.all([1, 2, 3, 4, 5].map(() => bad.add()))
    expect((await bad.read()).used).toBe(5)
  })
})

describe('the allocation rule', () => {
  it('orders the languages: Croatian first, then English, then the rest by code', () => {
    expect(orderLanguages(['de', 'en', 'hr', 'fr'])).toEqual(['hr', 'en', 'de', 'fr'])
    expect(orderLanguages(['en', 'en', 'hr'])).toEqual(['hr', 'en'])
  })

  it('both fit in the quota: both go to Gemini, with the local voices as the fallback chain', () => {
    const r = alloc({ need: { hr: 4, en: 3 }, quota: { limit: 10, used: 0 } })
    expect(providers(r)).toEqual({ hr: 'gemini', en: 'gemini' })
    expect(r.hr!.chain).toEqual(['gemini', 'vibetts', 'comfy'])
    expect(Object.keys(r)).toEqual(['hr', 'en']) // Croatian is allocated first
  })

  it('hr and en together over what is left: Croatian on Gemini, English local (VibeTTS)', () => {
    const r = alloc({ need: { hr: 6, en: 5 }, quota: { limit: 10, used: 0 } })
    expect(providers(r)).toEqual({ hr: 'gemini', en: 'vibetts' })
    expect(r.en!.chain).toEqual(['vibetts', 'comfy'])
    expect(r.en!.reason).toMatch(/do not fit in the 4 Gemini request\(s\) left today/)
  })

  it('Croatian is preferred even when English would fit and Croatian would not use the whole quota', () => {
    // 3 left: hr needs 3 (fits, uses it all), en needs 1 (does not fit any more) -> en is local, not hr
    expect(providers(alloc({ need: { hr: 3, en: 1 }, quota: { limit: 10, used: 7 } }))).toEqual({ hr: 'gemini', en: 'vibetts' })
    // 3 left: hr needs 4 (does not fit), en needs 2 (fits) -> hr local, en Gemini: a language is never split to make it fit
    expect(providers(alloc({ need: { hr: 4, en: 2 }, quota: { limit: 10, used: 7 } }))).toEqual({ hr: 'vibetts', en: 'gemini' })
  })

  it('neither fits: both local; used up: everything local; a limit of 0 disables Gemini', () => {
    expect(providers(alloc({ need: { hr: 11, en: 11 }, quota: { limit: 10, used: 0 } }))).toEqual({ hr: 'vibetts', en: 'vibetts' })
    expect(providers(alloc({ need: { hr: 1, en: 1 }, quota: { limit: 10, used: 10 } }))).toEqual({ hr: 'vibetts', en: 'vibetts' })
    expect(providers(alloc({ need: { hr: 1 }, quota: { limit: 0, used: 0 } }))).toEqual({ hr: 'vibetts' })
    expect(providers(alloc({ need: { hr: 1 }, quota: { limit: 10, used: 25 } }))).toEqual({ hr: 'vibetts' }) // used over the limit: remaining is 0, not negative
  })

  it('a language is never split between providers: it has one provider, the others are only its fallback chain', () => {
    const r = alloc({ need: { hr: 7, en: 4 }, quota: { limit: 10, used: 0 } })
    expect(r.hr!.provider).toBe('gemini')
    expect(r.en!.provider).toBe('vibetts') // 3 left, 4 needed: the whole language goes local, not 3 + 1
    for (const a of Object.values(r)) expect(a.chain[0]).toBe(a.provider)
  })

  it('a language with nothing to speak is none and does not use quota', () => {
    const r = alloc({ need: { hr: 0, en: 2 }, quota: { limit: 10, used: 9 } })
    expect(r.hr).toMatchObject({ provider: 'none', need: 0, chain: [] })
    expect(r.en!.provider).toBe('vibetts') // 1 left, 2 needed
  })

  it('forced vibetts and comfy never use Gemini; comfy goes first for comfy; gemini still respects the quota', () => {
    expect(providers(alloc({ need: { hr: 1, en: 1 }, provider: 'vibetts' }))).toEqual({ hr: 'vibetts', en: 'vibetts' })
    expect(alloc({ need: { hr: 1 }, provider: 'vibetts' }).hr!.chain).toEqual(['vibetts', 'comfy'])
    expect(alloc({ need: { hr: 1 }, provider: 'comfy' }).hr!.chain).toEqual(['comfy', 'vibetts'])
    expect(alloc({ need: { hr: 1 }, provider: 'comfy' }).hr!.chain).not.toContain('gemini')
    // forced gemini: the quota still applies
    expect(providers(alloc({ need: { hr: 2, en: 9 }, provider: 'gemini', quota: { limit: 10, used: 5 } }))).toEqual({ hr: 'gemini', en: 'vibetts' })
    expect(providers(alloc({ need: { hr: 6 }, provider: 'gemini', quota: { limit: 10, used: 5 } }))).toEqual({ hr: 'vibetts' })
  })

  it('Gemini down (flow-music-mcp not running, signed out): everything local, and the reason says why', () => {
    const r = alloc({ need: { hr: 1, en: 1 }, avail: down({ gemini: { up: false, reason: 'flow-music-mcp is not running' } }) })
    expect(providers(r)).toEqual({ hr: 'vibetts', en: 'vibetts' })
    expect(r.hr!.reason).toMatch(/Gemini is not available \(flow-music-mcp is not running\)/)
  })

  it('VibeTTS not reading a language: ComfyUI TTS; VibeTTS down: ComfyUI; ComfyUI without an engine for it: VibeTTS only', () => {
    const noHr = down({ vibetts: { up: true, reads: (l) => l === 'en' } })
    expect(providers(alloc({ need: { hr: 1, en: 1 }, quota: { limit: 10, used: 10 }, avail: noHr }))).toEqual({ hr: 'comfy', en: 'vibetts' })
    expect(localChain('hr', 'auto', noHr)).toEqual(['comfy'])
    const noVibe = down({ vibetts: { up: false, reads: () => false, reason: 'not running' } })
    expect(providers(alloc({ need: { hr: 1 }, quota: { limit: 10, used: 10 }, avail: noVibe }))).toEqual({ hr: 'comfy' })
    const noEngine = down({ comfy: { up: true, reads: () => false } })
    expect(localChain('hr', 'auto', noEngine)).toEqual(['vibetts'])
  })

  it('everything down: provider none with no chain, and the reason names each provider (placeholders follow, never a failed run)', () => {
    const none = down({ gemini: { up: false, reason: 'not running' }, vibetts: { up: false, reads: () => false, reason: 'VibeTTS is not running' }, comfy: { up: true, reads: () => false, reason: 'no engine' } })
    const r = alloc({ need: { hr: 2, en: 1 }, avail: none })
    expect(providers(r)).toEqual({ hr: 'none', en: 'none' })
    expect(r.hr).toMatchObject({ chain: [], need: 2 })
    expect(r.hr!.reason).toMatch(/nothing can speak hr.*VibeTTS is not available \(VibeTTS is not running\).*ComfyUI TTS does not read hr.*placeholders/)
  })
})

describe('German (EGS-33)', () => {
  it('Kokoro-only availability: German has nowhere to go -> no provider (placeholders + a reason)', () => {
    const kokoroOnly = down({ vibetts: { up: true, reads: (l) => voiceReads({ engine: 'kokoro', languages: ['en', 'de'] }, l) }, comfy: { up: true, reads: () => false } })
    const r = alloc({ need: { de: 4 }, avail: kokoroOnly, provider: 'vibetts' })
    expect(r.de).toMatchObject({ provider: 'none', chain: [] })
    expect(r.de!.reason).toMatch(/does not read de/)
  })

  it('a voice list is a probe: Kokoro never reads de or hr even if a listing claims it; Supertonic does when listed', () => {
    expect(voiceReads({ engine: 'kokoro', languages: ['de', 'en'] }, 'de')).toBe(false)
    expect(voiceReads({ engine: 'Kokoro', languages: ['en'] }, 'en')).toBe(true)
    expect(voiceReads({ engine: 'supertonic', languages: ['de'] }, 'de')).toBe(true)
    expect(voiceReads({ engine: 'supertonic', languages: ['hr'] }, 'de')).toBe(false)
  })

  it('Supertonic available: German goes to VibeTTS (and Gemini is not the first choice when it does not fit)', () => {
    const r = alloc({ need: { de: 40 }, quota: { limit: 10, used: 0 } })
    expect(r.de).toMatchObject({ provider: 'vibetts', chain: ['vibetts', 'comfy'] })
  })

  it('10 left, 4 hr and 40 de clips: hr on Gemini, de local', () => {
    expect(providers(alloc({ need: { hr: 4, de: 40 }, quota: { limit: 10, used: 0 } }))).toEqual({ hr: 'gemini', de: 'vibetts' })
  })
})
