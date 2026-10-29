import type { CustomWorkflowInfo, EngineEvent, EngineInfo, StudioStatusView } from '../../shared/protocol'

export type ComfyView = Extract<EngineEvent, { type: 'comfy.status' }>
export type VoiceView = Extract<EngineEvent, { type: 'voice.status' }>

/** What the Generators page shows: ComfyUI, the local voice engines and the studios. `null` until the engine answered. */
export interface GeneratorsData {
  comfy: ComfyView | null
  voice: VoiceView | null
  studios: StudioStatusView[] | null
  engines: { image: EngineInfo[]; audio: EngineInfo[]; palettes: string[] } | null
  workflows: CustomWorkflowInfo[] | null
  /** The answer to the last `comfyFree`: what each lane did. */
  freed: { lane: string; ok: boolean; error?: string }[] | null
  /** The checks sent and not yet answered. */
  checking: { comfy: boolean; voice: boolean; studios: boolean }
}

export const initialGenerators = (): GeneratorsData => ({ comfy: null, voice: null, studios: null, engines: null, workflows: null, freed: null, checking: { comfy: false, voice: false, studios: false } })

export function reduceGenerators(s: GeneratorsData, e: EngineEvent): Partial<GeneratorsData> {
  switch (e.type) {
    case 'comfy.status':
      return { comfy: e, checking: { ...s.checking, comfy: false } }
    case 'voice.status':
      return { voice: e, checking: { ...s.checking, voice: false } }
    case 'studios.status':
      return { studios: e.studios, checking: { ...s.checking, studios: false } }
    case 'workflows.listed':
      return { workflows: e.workflows }
    case 'comfy.freed':
      return { freed: e.results }
    case 'engines.listed':
      return { engines: { image: e.image, audio: e.audio, palettes: e.palettes } }
    case 'command.error':
      if (e.command === 'comfyStatus') return { checking: { ...s.checking, comfy: false } }
      if (e.command === 'voiceStatus') return { checking: { ...s.checking, voice: false } }
      if (e.command === 'studiosStatus') return { checking: { ...s.checking, studios: false } }
      return {}
    default:
      return {}
  }
}
