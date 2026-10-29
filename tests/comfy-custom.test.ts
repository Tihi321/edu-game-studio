import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createComfyClient, parseComfyConfig } from '../src/engine/comfy/client'
import {
  fillWorkflow,
  listCustomWorkflows,
  loadCustomWorkflow,
  parseMapping,
  parseWorkflowJson,
  validateMapping,
  workflowKind
} from '../src/engine/comfy/custom-workflow'
import { uiToApi, type SchemaMap, type UiWorkflow } from '../src/engine/comfy/ui-to-api'

const SEED_WORKFLOWS = path.resolve(__dirname, '..', 'seed', 'workflows')

afterEach(() => vi.unstubAllGlobals())

describe('custom workflow mapping', () => {
  it('loads and validates the seeded chatterbox workflow', async () => {
    const wf = await loadCustomWorkflow(SEED_WORKFLOWS, 'chatterbox-multilingual')
    expect(wf.graph['1']!.class_type).toBe('FL_ChatterboxMultilingualTTS')
    expect(wf.mapping.output).toEqual({ node: '3' })
    expect(workflowKind(wf.graph, wf.mapping)).toBe('audio')
    expect(await listCustomWorkflows([SEED_WORKFLOWS])).toContain('chatterbox-multilingual')
    // Croatian is not offered by Chatterbox multilingual: the language table must not claim it.
    expect(wf.mapping.languages?.hr).toBeUndefined()
  })

  it('fills the mapped inputs without touching the original graph', async () => {
    const wf = await loadCustomWorkflow(SEED_WORKFLOWS, 'chatterbox-multilingual')
    const before = JSON.stringify(wf.graph)
    const { graph, outputNode, seed } = fillWorkflow(wf, { text: 'Dobar dan', language: 'de', seed: 42, voiceRef: 'voice.mp3' })
    expect(graph['1']!.inputs).toMatchObject({ text: 'Dobar dan', language: 'German (de)', seed: 42 })
    expect(graph['2']!.inputs.audio).toBe('voice.mp3')
    expect(outputNode).toBe('3')
    expect(seed).toBe(42)
    expect(JSON.stringify(wf.graph)).toBe(before)
    expect(fillWorkflow(wf, { language: 'xx' }).graph['1']!.inputs.language).toBe('xx')
  })

  it('fills image fields and snaps the size to 16', () => {
    const graph = parseWorkflowJson(
      JSON.stringify({
        1: { class_type: 'CLIPTextEncode', inputs: { text: '' } },
        2: { class_type: 'CLIPTextEncode', inputs: { text: '' } },
        3: { class_type: 'EmptyLatentImage', inputs: { width: 1, height: 1, batch_size: 1 } },
        4: { class_type: 'KSampler', inputs: { seed: 0, steps: 4 } },
        5: { class_type: 'LoadImage', inputs: { image: 'x.png' } },
        6: { class_type: 'SaveImage', inputs: {} }
      })
    )
    const mapping = parseMapping(
      'prompt: { node: "1", input: text }\nnegative: { node: "2", input: text }\nwidth: { node: "3", input: width }\nheight: { node: "3", input: height }\nseed: { node: "4", input: seed }\nsteps: { node: "4", input: steps }\nreference: { node: "5", input: image }\noutput: "6"\n'
    )
    expect(validateMapping(graph, mapping)).toEqual([])
    const { graph: g } = fillWorkflow({ name: 'x', graph, mapping }, { prompt: 'p', negative: 'n', width: 1000, height: 500, seed: 9, steps: 6, reference: 'up.png' })
    expect(g['1']!.inputs.text).toBe('p')
    expect(g['2']!.inputs.text).toBe('n')
    expect(g['3']!.inputs).toMatchObject({ width: 1008, height: 496 })
    expect(g['4']!.inputs).toMatchObject({ seed: 9, steps: 6 })
    expect(g['5']!.inputs.image).toBe('up.png')
    expect(workflowKind(graph, mapping)).toBe('image')
  })

  it('reports mapping problems against the graph', () => {
    const graph = parseWorkflowJson(JSON.stringify({ 1: { class_type: 'A', inputs: { x: ['2', 0] } }, 2: { class_type: 'B', inputs: {} } }))
    const mapping = parseMapping('prompt: { node: "9", input: text }\nseed: { node: "1", input: x }\noutput: "7"\n')
    const problems = validateMapping(graph, mapping)
    expect(problems).toEqual(expect.arrayContaining([expect.stringMatching(/prompt: node "9"/), expect.stringMatching(/seed: 1\.x is linked/), expect.stringMatching(/output: node "7"/)]))
  })

  it('rejects UI-format JSON and bad mapping files', () => {
    expect(() => parseWorkflowJson('{"nodes":[],"links":[]}')).toThrow(/UI-format/)
    expect(() => parseWorkflowJson('nope')).toThrow(/not valid JSON/)
    expect(() => parseMapping('prompt: { node: "1" }\noutput: "2"')).toThrow(/prompt/)
    expect(() => parseMapping('prompt: { node: "1", input: a }')).toThrow(/output/)
  })

  it('throws when a file is missing or the mapping is invalid', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'edu-wf-'))
    try {
      await expect(loadCustomWorkflow(dir, 'none')).rejects.toThrow(/not found/)
      await writeFile(path.join(dir, 'bad.json'), JSON.stringify({ 1: { class_type: 'A', inputs: {} } }))
      await writeFile(path.join(dir, 'bad.map.yaml'), 'prompt: { node: "5", input: t }\noutput: "1"\n')
      await expect(loadCustomWorkflow(dir, 'bad')).rejects.toThrow(/node "5"/)
      await expect(loadCustomWorkflow(dir, '../evil')).rejects.toThrow(/invalid workflow name/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('runs a custom workflow through the client: uploads the voice reference, fills text, returns the output node file', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'edu-data-'))
    try {
      await mkdir(path.join(dir, 'config', 'workflows'), { recursive: true })
      const wfDir = path.join(dir, 'config', 'workflows')
      await writeFile(path.join(wfDir, 'chatterbox-multilingual.json'), await (await import('node:fs/promises')).readFile(path.join(SEED_WORKFLOWS, 'chatterbox-multilingual.json')))
      await writeFile(path.join(wfDir, 'chatterbox-multilingual.map.yaml'), await (await import('node:fs/promises')).readFile(path.join(SEED_WORKFLOWS, 'chatterbox-multilingual.map.yaml')))
      const posted: Array<{ prompt: Record<string, { inputs: Record<string, unknown> }> }> = []
      const uploads: string[] = []
      const json = (b: unknown) => new Response(JSON.stringify(b))
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string, init?: RequestInit) => {
          const url = new URL(String(input))
          if (url.pathname === '/queue') return json({ queue_running: [], queue_pending: [] })
          if (url.pathname === '/upload/image') {
            const f = (init!.body as FormData).get('image') as File
            uploads.push(f.name)
            return json({ name: f.name, subfolder: '', type: 'input' })
          }
          if (url.pathname === '/prompt') {
            posted.push(JSON.parse(String(init!.body)))
            return json({ prompt_id: 'p' })
          }
          if (url.pathname === '/history/p') {
            return json({ p: { status: { status_str: 'success' }, outputs: { 1: { audio: [{ filename: 'wrong.mp3' }] }, 3: { audio: [{ filename: 'edu/voice_00001_.mp3' }] } } } })
          }
          if (url.pathname === '/view') return new Response(url.searchParams.get('filename'))
          throw new Error(`unexpected ${url.pathname}`)
        })
      )
      const client = createComfyClient({ config: parseComfyConfig({ pollIntervalMs: 1 }), dataDir: dir })
      const r = await client.generate({ engine: 'custom:chatterbox-multilingual', text: 'Hello there', language: 'en', voiceRef: Buffer.from('audio'), seed: 3 })
      expect(r.kind).toBe('audio')
      expect(r.ext).toBe('mp3')
      expect(r.bytes.toString()).toBe('edu/voice_00001_.mp3')
      expect(uploads).toHaveLength(1)
      const g = posted[0]!.prompt
      expect(g['1']!.inputs).toMatchObject({ text: 'Hello there', language: 'English (en)', seed: 3 })
      expect(g['2']!.inputs.audio).toBe(uploads[0])
      await expect(client.generate({ engine: 'custom:missing', text: 'x' })).rejects.toThrow(/not found/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// A trimmed copy of ComfyUI's audio-chatterbox_tts_multilingual.json (UI format) plus the node schemas it needs.
const UI: UiWorkflow = {
  nodes: [
    {
      id: 2, type: 'LoadAudio', mode: 0,
      inputs: [{ name: 'audio', link: null }, { name: 'audioUI', link: null }, { name: 'upload', link: null }],
      widgets_values: ['voice.mp3', null],
      widgets_values_named: { audio: 'voice.mp3', upload: null }
    },
    {
      id: 1, type: 'FL_ChatterboxMultilingualTTS', mode: 0,
      inputs: [{ name: 'audio_prompt', link: 1 }, { name: 'text', link: null }, { name: 'language', link: null }, { name: 'seed', link: null }],
      widgets_values: ['Hello', 'English (en)', 0.5, 2101809668, 'randomize', false],
      widgets_values_named: { text: 'Hello', language: 'English (en)', seed: 2101809668, control_after_generate: 'randomize', use_cpu: false }
    },
    { id: 4, type: 'MarkdownNote', mode: 0, widgets_values: ['notes'] },
    { id: 3, type: 'SaveAudioMP3', mode: 0, inputs: [{ name: 'audio', link: 2 }], widgets_values: ['audio/ComfyUI', 'V0'], widgets_values_named: { filename_prefix: 'audio/ComfyUI', quality: 'V0' } }
  ],
  links: [[1, 2, 0, 1, 0, 'AUDIO'], [2, 1, 0, 3, 0, 'AUDIO']]
}
const SCHEMAS: SchemaMap = {
  LoadAudio: { input: { required: { audio: [['voice.mp3'], {}] } } },
  FL_ChatterboxMultilingualTTS: {
    input: {
      required: {
        text: ['STRING', {}],
        language: [['English (en)'], {}],
        exaggeration: ['FLOAT', {}],
        seed: ['INT', { control_after_generate: true }]
      },
      optional: { audio_prompt: ['AUDIO'], use_cpu: ['BOOLEAN', {}] }
    }
  },
  SaveAudioMP3: { input: { required: { audio: ['AUDIO', {}], filename_prefix: ['STRING', {}], quality: [['V0'], {}] } } }
}

describe('ui-to-api', () => {
  it('converts the chatterbox UI workflow: links, widget values, dropped notes and upload helpers', () => {
    const { prompt, skipped, warnings } = uiToApi(UI, SCHEMAS)
    expect(Object.keys(prompt).sort()).toEqual(['1', '2', '3'])
    expect(skipped).toEqual(['4:MarkdownNote'])
    expect(warnings).toEqual([])
    expect(prompt['1']).toMatchObject({
      class_type: 'FL_ChatterboxMultilingualTTS',
      inputs: { text: 'Hello', language: 'English (en)', seed: 2101809668, audio_prompt: ['2', 0] }
    })
    expect(prompt['1']!.inputs).not.toHaveProperty('control_after_generate')
    expect(prompt['2']!.inputs).toEqual({ audio: 'voice.mp3' })
    expect(prompt['3']!.inputs).toEqual({ filename_prefix: 'audio/ComfyUI', quality: 'V0', audio: ['1', 0] })
  })

  it('falls back to schema widget order and skips the control-after-generate value', () => {
    const ui: UiWorkflow = { nodes: [{ id: 1, type: 'FL_ChatterboxMultilingualTTS', widgets_values: ['Hi', 'English (en)', 0.7, 99, 'fixed', true] }] }
    const { prompt } = uiToApi(ui, SCHEMAS)
    expect(prompt['1']!.inputs).toEqual({ text: 'Hi', language: 'English (en)', exaggeration: 0.7, seed: 99, use_cpu: true })
  })

  it('inlines Reroute and PrimitiveNode and drops muted nodes', () => {
    const ui: UiWorkflow = {
      nodes: [
        { id: 1, type: 'PrimitiveNode', widgets_values: [1234] },
        { id: 2, type: 'Reroute', inputs: [{ name: '', link: 10 }] },
        { id: 3, type: 'A', inputs: [{ name: 'seed', link: 11 }, { name: 'img', link: 12 }] },
        { id: 4, type: 'B', mode: 2 },
        { id: 5, type: 'C' }
      ],
      links: [[10, 5, 0, 2, 0, 'IMAGE'], [11, 1, 0, 3, 0, 'INT'], [12, 2, 0, 3, 1, 'IMAGE']]
    }
    const { prompt, skipped } = uiToApi(ui)
    expect(prompt['3']!.inputs).toEqual({ seed: 1234, img: ['5', 0] })
    expect(Object.keys(prompt).sort()).toEqual(['3', '5'])
    expect(skipped).toEqual(expect.arrayContaining(['1:PrimitiveNode', '2:Reroute', '4:B']))
  })

  it('warns when widget values cannot be placed because the node is unknown', () => {
    const { warnings } = uiToApi({ nodes: [{ id: 1, type: 'Mystery', widgets_values: [1] }] })
    expect(warnings[0]).toMatch(/Mystery/)
  })
})
