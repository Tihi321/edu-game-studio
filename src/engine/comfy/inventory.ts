import type { EngineTask } from '../../shared/media'
import {
  freeMemory,
  lanesOf,
  listModelFiles,
  objectInfo,
  queueState,
  removalModelsOf,
  type ComfyConfig,
  type ObjectInfo
} from './client'
import { listCustomWorkflows } from './custom-workflow'
import { ENGINES, mergeFiles } from './graphs'

/** Model folders the inventory lists. */
export const MODEL_FOLDERS: Record<string, string> = {
  checkpoints: 'Checkpoints (ACE-Step, YuE2)',
  diffusion_models: 'Diffusion models (UNets)',
  text_encoders: 'Text encoders (CLIP)',
  vae: 'VAEs',
  loras: 'LoRAs',
  background_removal: 'Background removal models'
}

export interface LaneReport {
  url: string
  reachable: boolean
  running: number
  pending: number
  error: string
}

export interface FileCheck {
  group: string
  key: string
  value: string
  folder: string
  /** null: the folder could not be listed, so unknown. */
  present: boolean | null
}

export interface EngineReport {
  id: string
  kind: 'image' | 'audio'
  label: string
  /** What it makes: `music` (the default), speech (`tts`) or a sound effect (`sfx`). */
  task: EngineTask
  /** The codes a TTS engine reads, `'*'` for any language; empty when it has no language input. */
  languages: string[] | '*'
  ready: boolean
  missing: string[]
}

export interface Inventory {
  ok: boolean
  lanes: LaneReport[]
  models: Record<string, string[]>
  /** Node class names known to ComfyUI (from `/object_info`). */
  nodes: string[]
  checks: FileCheck[]
  engines: EngineReport[]
  customWorkflows: string[]
  /** Background removal: core nodes present and at least one model file available. */
  backgroundRemoval: { available: boolean; models: string[] }
}

/**
 * Per-engine readiness from model files and (for the TTS/SFX engines) the ComfyUI node catalog. `nodes` is undefined when no lane
 * answered, so unknown nodes are not failures. The engines that the TTS Audio Suite manages (`task` tts/sfx) have no model files:
 * they are ready when their nodes are listed.
 */
export function engineReports(config: ComfyConfig, models: Record<string, string[]>, nodes?: readonly string[]): { checks: FileCheck[]; engines: EngineReport[] } {
  const groups = mergeFiles(config.files as never)
  const checks: FileCheck[] = []
  const engines: EngineReport[] = []
  for (const [id, engine] of Object.entries(ENGINES)) {
    const missing: string[] = []
    for (const [key, folder] of engine.requires ?? []) {
      const group = engine.fileGroup ?? 'audio'
      const value = groups[group][key] ?? ''
      const listed = models[folder] ?? []
      const present = listed.length === 0 ? null : listed.includes(value)
      if (!checks.some((c) => c.group === group && c.key === key)) checks.push({ group, key, value, folder, present })
      if (present === false) missing.push(`${key}=${value}`)
    }
    if (nodes) for (const node of engine.requiresNodes ?? []) if (!nodes.includes(node)) missing.push(`node:${node}`)
    engines.push({ id, kind: engine.kind, label: engine.label, task: engine.task ?? 'music', languages: engine.languages ?? [], ready: missing.length === 0, missing })
  }
  return { checks, engines }
}

/** One round of reads, no generation: lane health, model files, node catalog, engine readiness, custom workflows. */
export async function buildInventory(config: ComfyConfig, opts: { workflowDirs?: string[] } = {}): Promise<Inventory> {
  const lanes: LaneReport[] = []
  let models: Record<string, string[]> = {}
  let info: ObjectInfo = {}
  let listed = false
  /** The node classes ComfyUI lists; undefined when no lane answered (then node readiness is unknown, not a failure). */
  let knownNodes: string[] | undefined
  for (const url of lanesOf(config)) {
    const report: LaneReport = { url, reachable: false, running: 0, pending: 0, error: '' }
    try {
      const state = await queueState(url)
      report.reachable = true
      report.running = state.running
      report.pending = state.pending
      if (!listed) {
        listed = true
        for (const folder of Object.keys(MODEL_FOLDERS)) {
          models[folder] = await listModelFiles(url, folder).catch(() => [])
        }
        try {
          info = await objectInfo(url)
          knownNodes = Object.keys(info)
        } catch {
          info = {}
        }
      }
    } catch (error) {
      report.error = (error as Error).message
    }
    lanes.push(report)
  }
  if (!listed) models = {}
  const { checks, engines } = engineReports(config, models, knownNodes)
  const removal = removalModelsOf(info)
  return {
    ok: lanes.some((l) => l.reachable),
    lanes,
    models,
    nodes: knownNodes ?? [],
    checks,
    engines,
    customWorkflows: opts.workflowDirs ? await listCustomWorkflows(opts.workflowDirs) : [],
    backgroundRemoval: { available: !!info.RemoveBackground && removal.length > 0, models: removal }
  }
}

/** Frees VRAM on every lane; returns a per-lane result (errors do not throw). */
export async function freeAllLanes(config: ComfyConfig): Promise<Array<{ lane: string; ok: boolean; error?: string }>> {
  const out: Array<{ lane: string; ok: boolean; error?: string }> = []
  for (const lane of lanesOf(config)) {
    try {
      await freeMemory(lane)
      out.push({ lane, ok: true })
    } catch (e) {
      out.push({ lane, ok: false, error: (e as Error).message })
    }
  }
  return out
}

export { freeMemory }
