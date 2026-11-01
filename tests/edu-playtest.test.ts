import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ChromiumMissingError, findPlayScript, PERSONAS, playtestDigest, runPlaytest } from '../src/engine/edu/playtest'
import type { BotSummary, PlaytestResult } from '../src/engine/edu/playtest'
import { tmp, useTemp } from './edu-build-helpers'
import { makeEduEnv } from './edu-helpers'

useTemp()

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const summary = (o: Partial<BotSummary> = {}): BotSummary => ({ mode: 'perfect', seed: 1, steps: 20, correct: 20, wrong: 0, screens: ['title', 'map', 'item', 'feedback', 'end'], finished: true, consoleErrors: 0, maxSteps: 100, ok: true, failures: [], ...o })

/** A stand-in for scripts/play.mjs: answers from FAKE_BOT (`<mode>-<seed>` -> {code, summary, stderr}) and logs its arguments to FAKE_BOT_LOG. */
async function fakeBot(): Promise<{ script: string; log: string }> {
  const dir = await tmp('edu-fakebot-')
  const script = path.join(dir, 'play.mjs')
  const log = path.join(dir, 'calls.log')
  fs.writeFileSync(
    script,
    `import fs from 'node:fs'
const a = process.argv.slice(2)
const get = (f) => a[a.indexOf(f) + 1]
const cfg = JSON.parse(process.env.FAKE_BOT || '{}')
const r = cfg[get('--mode') + '-' + get('--seed')] || { code: 0, summary: { mode: get('--mode'), seed: Number(get('--seed')), steps: 10, correct: 10, wrong: 0, screens: ['end'], finished: true, consoleErrors: 0, maxSteps: 50, ok: true, failures: [] } }
fs.appendFileSync(process.env.FAKE_BOT_LOG, JSON.stringify(a) + '\\n')
if (r.hang) await new Promise((res) => setTimeout(res, 60000))
if (r.stderr) console.error(r.stderr)
if (r.summary !== null) console.log(JSON.stringify(r.summary))
process.exit(r.code)
`
  )
  return { script, log }
}

const calls = (log: string): string[][] => fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[])

describe('the playtest runner (a fake bot script)', () => {
  it('runs the five personas with their modes, seeds, accuracies and rounds, and is ok when every one passes', async () => {
    const bot = await fakeBot()
    const dir = await tmp('edu-build-')
    const r = await runPlaytest(dir, { playScript: bot.script, env: { ...process.env, FAKE_BOT_LOG: bot.log }, concurrency: 3 })
    expect(r.ok).toBe(true)
    expect(r.failures).toEqual([])
    expect(r.runs.map((x) => x.persona)).toEqual(['perfect', 'wrong', 'strong', 'average', 'struggling']) // the order of the personas, whatever finished first
    const seen = calls(bot.log)
    expect(seen).toHaveLength(5)
    for (const a of seen) expect(a.slice(0, 2)).toEqual([dir, '--json'])
    const args = (mode: string, seed: number) => seen.find((a) => a.includes(mode) && a[a.indexOf('--seed') + 1] === String(seed))!.join(' ')
    expect(args('perfect', 1)).toBe(`${dir} --json --mode perfect --seed 1`)
    expect(args('wrong', 2)).toBe(`${dir} --json --mode wrong --seed 2 --rounds 2`)
    expect(args('random', 3)).toContain('--accuracy 0.9')
    expect(args('random', 4)).toContain('--accuracy 0.75')
    expect(args('random', 5)).toContain('--accuracy 0.55')
    expect(PERSONAS.map((p) => p.id)).toEqual(['perfect', 'wrong', 'strong', 'average', 'struggling'])
  })

  it('a persona that fails makes the run not ok, with its failures; a console error is a failure even when the bot says ok', async () => {
    const bot = await fakeBot()
    const env = {
      ...process.env,
      FAKE_BOT_LOG: bot.log,
      FAKE_BOT: JSON.stringify({
        'random-5': { code: 1, summary: summary({ mode: 'random', seed: 5, finished: false, steps: 100, ok: false, failures: ['the game was not finished'] }) },
        'random-3': { code: 0, summary: summary({ mode: 'random', seed: 3, consoleErrors: 2 }) }
      })
    }
    const r = await runPlaytest(await tmp('edu-build-'), { playScript: bot.script, env })
    expect(r.ok).toBe(false)
    expect(r.runs.find((x) => x.persona === 'struggling')).toMatchObject({ ok: false, code: 1, failures: ['the game was not finished'] })
    expect(r.runs.find((x) => x.persona === 'strong')).toMatchObject({ ok: false, failures: ['2 console error(s) while playing'] })
    expect(r.runs.filter((x) => x.ok).map((x) => x.persona)).toEqual(['perfect', 'wrong', 'average'])
    expect(r.failures).toEqual(['strong: 2 console error(s) while playing', 'struggling: the game was not finished'])
  })

  it('a bot that runs past the timeout is reported as a timeout, not as "no result"', async () => {
    const bot = await fakeBot()
    const env = { ...process.env, FAKE_BOT_LOG: bot.log, FAKE_BOT: JSON.stringify({ 'perfect-1': { code: 0, summary: null, hang: true } }) }
    const r = await runPlaytest(await tmp('edu-build-'), { playScript: bot.script, env, personas: ['perfect'], timeoutMs: 1500 })
    expect(r.ok).toBe(false)
    expect(r.runs[0]!.failures[0]).toMatch(/timed out after 2 s without finishing/)
  })

  it('exit code 3 (no Chromium) is a clear error that says how to install it, not a crash; no JSON is a failure of that persona', async () => {
    const bot = await fakeBot()
    const env = { ...process.env, FAKE_BOT_LOG: bot.log, FAKE_BOT: JSON.stringify({ 'perfect-1': { code: 3, summary: null, stderr: 'browserType.launch: Executable does not exist' } }) }
    const err = await runPlaytest(await tmp('edu-build-'), { playScript: bot.script, env, personas: ['perfect'] }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ChromiumMissingError)
    expect((err as Error).message).toMatch(/cannot launch Chromium \(browserType\.launch: Executable does not exist\)/)
    expect((err as Error).message).toMatch(/yarn playwright install chromium/)
    const none = await runPlaytest(await tmp('edu-build-'), { playScript: bot.script, env: { ...env, FAKE_BOT: JSON.stringify({ 'perfect-1': { code: 2, summary: null, stderr: 'the build folder is missing' } }) }, personas: ['perfect'] })
    expect(none.ok).toBe(false)
    expect(none.runs[0]!.failures[0]).toMatch(/the bot printed no result \(exit 2\): the build folder is missing/)
    expect(none.runs[0]!.summary).toBeNull()
  })

  it('personas can be picked by id or given whole; an unknown persona and a missing script are errors', async () => {
    const bot = await fakeBot()
    const env = { ...process.env, FAKE_BOT_LOG: bot.log }
    const dir = await tmp('edu-build-')
    const r = await runPlaytest(dir, { playScript: bot.script, env, personas: ['perfect', { id: 'custom', mode: 'random', seed: 9, accuracy: 0.6 }] })
    expect(r.runs.map((x) => x.persona)).toEqual(['perfect', 'custom'])
    expect(calls(bot.log).map((a) => a.join(' ')).find((a) => a.includes('--seed 9'))).toContain('--mode random --seed 9 --accuracy 0.6')
    await expect(runPlaytest(dir, { playScript: bot.script, env, personas: ['nobody'] })).rejects.toThrow(/unknown persona\(s\): nobody \(known: perfect, wrong, strong, average, struggling\)/)
    await expect(runPlaytest(dir, { playScript: path.join(dir, 'nope.mjs') })).rejects.toThrow(/the autoplay bot script is not there/)
  })

  it('finds scripts/play.mjs of the repo, and EDU_PLAY_SCRIPT overrides it', () => {
    expect(findPlayScript({}, path.join(ROOT, 'src', 'engine', 'edu'))).toBe(path.join(ROOT, 'scripts', 'play.mjs'))
    expect(findPlayScript({ EDU_PLAY_SCRIPT: path.join(ROOT, 'elsewhere.mjs') })).toBe(path.join(ROOT, 'elsewhere.mjs'))
  })

  it('playtestDigest is the text the playtester reads: one block per persona with its numbers', () => {
    const result: PlaytestResult = {
      ok: false,
      durationMs: 1,
      failures: ['struggling: the game was not finished'],
      runs: [
        { persona: 'perfect', mode: 'perfect', code: 0, ok: true, summary: summary(), failures: [] },
        { persona: 'struggling', mode: 'random', code: 1, ok: false, summary: summary({ mode: 'random', seed: 5, finished: false, steps: 100, correct: 55, wrong: 45, ok: false }), failures: ['the game was not finished'] },
        { persona: 'wrong', mode: 'wrong', code: 2, ok: false, summary: null, failures: ['the bot printed no result (exit 2)'] }
      ]
    }
    const text = playtestDigest(result)
    expect(text).toContain('### perfect (perfect): passed')
    expect(text).toContain('steps 20 of at most 100, right 20, wrong 0, finished: yes, console errors 0')
    expect(text).toContain('### struggling (random, seed 5): FAILED')
    expect(text).toContain('failures: the game was not finished')
    expect(text).toContain('### wrong\nThe bot gave no result: the bot printed no result (exit 2)')
  })

  it('the service plays the built game of a course with the runner it was given (a fake in tests) and refuses an unknown course', async () => {
    const seen: string[] = []
    const fake = async (dir: string): Promise<PlaytestResult> => (seen.push(dir), { ok: true, runs: [], failures: [], durationMs: 0 })
    const env = await makeEduEnv({ engine: { playtest: fake } })
    try {
      await expect(env.engine.edu.playtest('nope')).rejects.toThrow(/no course "nope"/)
      await env.engine.edu.courses.create({ slug: 'rome', title: 'Rome', languages: ['en'], sourceLang: 'en', subject: 'Rome', audience: 'Teens' })
      expect((await env.engine.edu.playtest('rome')).ok).toBe(true)
      expect(seen).toEqual([path.join(env.dir, 'courses', 'rome', 'build')])
    } finally {
      await env.cleanup()
    }
  })
})
