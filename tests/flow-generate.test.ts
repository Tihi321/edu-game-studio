import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_FLOW_OPTIONS, flowAspect, flowOptionsOf, flowQualityKind, flowSpritePrompt } from '../src/engine/assets/flow-image'
import { generateAsset } from '../src/engine/assets/generate'
import { resolveFile } from '../src/engine/assets/manifest'
import { FlowError } from '../src/engine/studios/flow'
import { studiosConfigSchema } from '../src/engine/studios/config'
import { entryOf, genKit } from './assets-fixtures'
import type { GenKit } from './assets-fixtures'

/**
 * Ported from VN Studio's `flow-generate` test, for a course: Google Flow makes an image ONLY when the course (or one asset) asks for it. Flow images are
 * free, but nothing in Edu Studio calls Flow by default.
 */

let kit: GenKit
beforeEach(async () => {
  kit = await genKit()
})
afterEach(async () => {
  await kit.done()
})

describe('pure helpers', () => {
  it('aspects: wide for backgrounds and pictures, tall for sprites, square for a tile sheet or a square picture', () => {
    expect(flowAspect('background')).toBe('16:9')
    expect(flowAspect('illustration')).toBe('16:9')
    expect(flowAspect('illustration', '1:1')).toBe('1:1')
    expect(flowAspect('sprite')).toBe('9:16')
    expect(flowAspect('tileset')).toBe('1:1')
  })
  it('quality kinds map to the keys of config/studios.md', () => {
    expect([flowQualityKind('background'), flowQualityKind('illustration'), flowQualityKind('sprite'), flowQualityKind('tileset')]).toEqual(['background', 'cg', 'sprite', 'sheet'])
    const c = studiosConfigSchema.parse({ flowImageQuality: { sprite: 'upscaled' }, flowJobTimeoutS: 10 })
    expect(flowOptionsOf(c).quality.sprite).toBe('upscaled')
    expect(flowOptionsOf(c).jobTimeoutMs).toBe(10_000)
    expect(DEFAULT_FLOW_OPTIONS.quality.background).toBe('upscaled')
  })
  it('a sprite prompt asks for a full body on a plain flat background, once', () => {
    const p = flowSpritePrompt('A knight in blue armour')
    expect(p).toMatch(/Full body, standing/)
    expect(p).toMatch(/Plain flat light grey background/)
    const again = flowSpritePrompt('A knight on a plain flat light grey background')
    expect(again.match(/grey background/gi)).toHaveLength(1)
  })
})

describe('generating images with Google Flow', () => {
  const flowMedia = { art: { provider: 'flow' } }

  it('Flow is never called by default: a course makes its images with ComfyUI', async () => {
    await generateAsset(kit.ctx({ flow: kit.flow }), entryOf('img-article-a-u1-1', 'illustration'))
    await generateAsset(kit.ctx({ flow: kit.flow }), entryOf('img-quiz-arena-bg-u1', 'background'))
    expect(kit.flow.calls).toHaveLength(0)
    expect(kit.comfy.requests).toHaveLength(2)
  })

  it('with art.provider: flow each kind sends the right aspect, quality and project, and ComfyUI makes no image', async () => {
    const run = async (kind: 'background' | 'illustration' | 'tileset', id: string) => generateAsset(kit.ctx({ media: flowMedia, flow: kit.flow }), entryOf(id, kind))
    const bg = await run('background', 'bg')
    const ill = await run('illustration', 'ill')
    const tiles = await run('tileset', 'tiles')
    for (const r of [bg, ill, tiles]) expect(r.ok).toBe(true)
    const sent = kit.flow.calls.filter((c) => c.tool === 'flow_generate').map((c) => c.args)
    expect(sent.map((a) => [a.aspect, a.quality, a.project, a.name])).toEqual([
      ['16:9', 'upscaled', 'edu-demo', 'bg'],
      ['16:9', 'upscaled', 'edu-demo', 'ill'],
      ['1:1', 'original', 'edu-demo', 'tiles']
    ])
    expect(kit.comfy.requests).toHaveLength(0)
    if (!bg.ok || bg.skipped) throw new Error('expected a version')
    expect(bg.version).toMatchObject({ engine: 'flow', seed: null, remote: { provider: 'flow', id: expect.stringMatching(/^media-/) } })
    expect(await sharp(await readFile(resolveFile(kit.dir, bg.entry)!)).metadata()).toMatchObject({ format: 'webp', width: 1280, height: 720 })
  })

  it('a course can name the Flow model and the Flow project', async () => {
    await generateAsset(kit.ctx({ media: { art: { provider: 'flow', flowModel: 'Nano Banana Pro', flowProject: 'mine' } }, flow: kit.flow }), entryOf('bg', 'background'))
    expect(kit.flow.calls[0]!.args).toMatchObject({ model: 'Nano Banana Pro', project: 'mine' })
  })

  it('a sprite from Flow is cut out and trimmed like any other, and asks for one figure on a plain background', async () => {
    const r = await generateAsset(kit.ctx({ media: { art: { provider: 'flow', pixelProvider: 'builtin' } }, flow: kit.flow }), entryOf('img-rpg-hero', 'sprite'))
    expect(r.ok).toBe(true)
    expect(kit.flow.calls[0]!.args).toMatchObject({ aspect: '9:16', quality: 'original' })
    expect(String(kit.flow.calls[0]!.args.prompt)).toMatch(/plain flat light grey background/i)
    expect(String(kit.flow.calls[0]!.args.prompt)).toMatch(/Full body, standing/)
    if (!r.ok || r.skipped) throw new Error('expected a version')
    expect(kit.comfy.removalCalls).toBe(1) // the figure is cut out by ComfyUI (BiRefNet), as for a ComfyUI sprite
    const meta = await sharp(await readFile(resolveFile(kit.dir, r.entry)!)).metadata()
    expect(meta).toMatchObject({ format: 'webp' })
    expect(meta.height! % 6).toBe(0)
  })

  it('one asset can ask for Flow (provider: flow) while the course uses ComfyUI; an engine given for one run uses ComfyUI', async () => {
    const r = await generateAsset(kit.ctx({ flow: kit.flow }), entryOf('a', 'illustration', { provider: 'flow' }))
    expect(r.ok && !r.skipped && r.version.engine).toBe('flow')
    expect(kit.comfy.requests).toHaveLength(0)
    const again = await generateAsset(kit.ctx({ flow: kit.flow }), entryOf('b', 'illustration', { provider: 'flow' }), { engine: 'qwen-image-2.1' })
    expect(again.ok && !again.skipped && again.version.engine).toBe('qwen-image-2.1')
    expect(kit.comfy.requests).toHaveLength(1)
    // a course that is not flow turns an asset that was made by Flow back to ComfyUI
    const back = await generateAsset(kit.ctx(), entryOf('c', 'illustration', { engine: 'flow' }))
    expect(back.ok && !back.skipped && back.version.engine).toBe('qwen-image-2.1')
  })

  it('Flow errors fail the asset with the message and leave the entry unchanged; Flow not configured is an error too', async () => {
    kit.flow.imageError = new FlowError('Google Flow is not signed in: run yarn login in flow-music-mcp', 'signedOut')
    const e = entryOf('bg', 'background')
    expect(await generateAsset(kit.ctx({ media: flowMedia, flow: kit.flow }), e)).toEqual({ ok: false, entry: e, error: 'Google Flow is not signed in: run yarn login in flow-music-mcp' })
    const none = await generateAsset(kit.ctx({ media: flowMedia }), e)
    expect(none).toMatchObject({ ok: false, error: expect.stringMatching(/not configured/) })
    expect(kit.comfy.requests).toHaveLength(0)
  })

  it('Flow down (not running) fails the asset with the hint, so the caller can put a placeholder in', async () => {
    kit.flow.up = false
    const r = await generateAsset(kit.ctx({ media: flowMedia, flow: kit.flow }), entryOf('bg', 'background'))
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/not running/) })
  })
})
