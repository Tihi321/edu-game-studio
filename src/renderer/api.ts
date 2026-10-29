import type { Command, EngineEvent, EduStudioApi, TextPatchView } from '../shared/protocol'
import { fileUrl, type HostApi, type PickKind } from './hostApi'
import { eduStore } from './store/store'

/** The host (Electron preload) API. Every extra is optional, so a plain browser page can still load. */
export type RendererApi = EduStudioApi &
  Partial<HostApi> & {
    /** Where course files are served from instead of the `edustudio-file://` protocol (the browser harness sets it). */
    fileBase?: string
  }

declare global {
  interface Window {
    edustudio: RendererApi
  }
}

export function sendCommand(command: Command): void {
  window.edustudio.send(command)
}

/**
 * Connects the store to the engine: events are queued and applied every 50 ms,
 * so a burst of streamed tokens causes one render, not hundreds.
 * Returns a function that disconnects.
 */
export function connectEngine(api: RendererApi = window.edustudio): () => void {
  let queue: EngineEvent[] = []
  let scheduled = false
  const flush = () => {
    scheduled = false
    const batch = queue
    queue = []
    eduStore.getState().applyEvents(batch)
  }
  const off = api.on((event) => {
    queue.push(event)
    if (!scheduled) {
      scheduled = true
      setTimeout(flush, 50)
    }
  })
  api.send({ type: 'snapshot' })
  api.send({ type: 'listCourses' })
  return () => {
    off()
    queue = []
  }
}

/** URL of a file in the data folder, such as `courses/<slug>/course/assets/map.svg`. */
export function courseFileUrl(rel: string): string {
  const base = typeof window !== 'undefined' ? window.edustudio?.fileBase : undefined
  return base ? `${base.replace(/\/$/, '')}/${rel.split('/').map(encodeURIComponent).join('/')}` : fileUrl(rel)
}

/** URL of a source asset of a course (`file` is the pack's `assets[].file`, such as `assets/map.svg`). */
export function courseAssetUrl(slug: string, file: string): string {
  return courseFileUrl(`courses/${slug}/course/${file.replace(/^\.?\//, '')}`)
}

// ---- the Course page's commands: each marks what the studio now waits for, then sends ----

/** Asks the engine for a course. The page shows it as loading until `course.loaded` (or a `command.error`) comes. */
export function loadCourse(slug: string): void {
  eduStore.getState().markCourse(slug, { loading: true })
  sendCommand({ type: 'getCourse', slug })
}

export function buildCourseNow(slug: string, force = false): void {
  eduStore.getState().markCourse(slug, { building: true, buildError: undefined })
  sendCommand({ type: 'buildCourse', slug, ...(force ? { force: true } : {}) })
}

export function lintCourseNow(slug: string, rebuild = false): void {
  eduStore.getState().markCourse(slug, { linting: true, lintError: undefined })
  sendCommand({ type: 'lintCourse', slug, ...(rebuild ? { rebuild: true } : {}) })
}

/** Saves an item with a merge patch and the texts it needs. */
export function saveItem(slug: string, id: string, patch: Record<string, unknown>, text?: TextPatchView): void {
  eduStore.getState().markCourse(slug, { saving: true, saveError: undefined })
  sendCommand({ type: 'updateItem', slug, id, patch, ...(text ? { text } : {}) })
}

/** Opens the built game of a course in the default browser (desktop app only). */
export async function openGame(slug: string): Promise<boolean> {
  return (await window.edustudio.openGame?.(slug)) ?? false
}

export async function openFolder(rel: string): Promise<boolean> {
  return (await window.edustudio.openFolder?.(rel)) ?? false
}

/** Folder picker (desktop app only; null when cancelled or in a plain browser). */
export async function pickFolder(title?: string): Promise<string | null> {
  return (await window.edustudio.pickFolder?.(title)) ?? null
}

export async function pickFile(title?: string, kind: PickKind = 'any'): Promise<string | null> {
  return (await window.edustudio.pickFile?.(title, kind)) ?? null
}

/** The end of a file in the data folder (a course's log.md), or null. */
export async function tailText(rel: string, bytes: number): Promise<string | null> {
  const r = await window.edustudio.tailFile?.(rel, -bytes)
  return r ? r.text : null
}

export async function readText(rel: string): Promise<string | null> {
  return (await window.edustudio.readFile?.(rel)) ?? null
}

export async function getStartWithWindows(): Promise<boolean | null> {
  return (await window.edustudio.getStartWithWindows?.()) ?? null
}

export async function setStartWithWindows(on: boolean): Promise<boolean | null> {
  return (await window.edustudio.setStartWithWindows?.(on)) ?? null
}
