import type { Dither } from '../../shared/media'
import { asStudioError, StudioError } from './chiptune'
import { createMcpClient } from './mcp-http'
import type { McpCallResult, McpHttpClient, McpToolInfo } from './mcp-http'

export interface ImportArgs {
  /** Absolute path of a PNG (JPG/WebP depend on the studio). */
  path: string
  name?: string
  width?: number
  height?: number
  scale?: number
  /** A palette id/name of the studio, or hex colours. */
  palette?: string | string[]
  maxColors?: number
  dither?: Dither
  outline?: boolean | string
  cleanup?: boolean
  alphaThreshold?: number
}

export interface ImportResult {
  documentId: string
  name: string
  width: number
  height: number
  colors: number
  transparentPixels: number
}

export interface ExportItem {
  document?: string
  /** Absolute path. */
  path: string
  width?: number
  height?: number
  scale?: number
  frame?: number
}

export interface DocumentInfo {
  documentId: string
  name: string
  width: number
  height: number
  path: string | null
  current: boolean
  dirty: boolean
}

export interface DrawReferenceResult {
  documentId: string
  name: string
  width: number
  height: number
  palette: string[]
  referenceLayerId: string
  /** The human-readable drawing guidance (the text part of the tool result). */
  guidance: string
}

/** What Edu Studio needs from Pixel Studio (the contract in `contracts.md`). Tests pass a fake. */
export interface PixelClient {
  readonly url: string
  importImage(args: ImportArgs, signal?: AbortSignal): Promise<ImportResult>
  exportPng(args: { document?: string; path: string; width?: number; height?: number; scale?: number }, signal?: AbortSignal): Promise<{ paths: string[]; width: number; height: number }>
  exportMany(items: ExportItem[], signal?: AbortSignal): Promise<{ paths: string[] }>
  drawSpriteFromReference(
    args: { reference: string; width: number; height: number; palette: string | string[]; expression?: string; name?: string },
    signal?: AbortSignal
  ): Promise<DrawReferenceResult>
  listDocuments(signal?: AbortSignal): Promise<DocumentInfo[]>
  openDocument(args: { path: string; exportTo?: string; exportWidth?: number; exportHeight?: number }, signal?: AbortSignal): Promise<{ documentId: string; name: string; width: number; height: number; path: string }>
  saveDocument(args: { document?: string; path?: string }, signal?: AbortSignal): Promise<{ documentId: string; path: string; exported?: string }>
  /** Any tool by name (the draw agent loop calls `draw_grid` and friends). */
  callTool(name: string, args: object, signal?: AbortSignal): Promise<McpCallResult>
  /** The tools the server offers (also the "is it up" check). */
  listTools(signal?: AbortSignal): Promise<McpToolInfo[]>
}

export interface PixelClientOptions {
  url: string
  notRunningHint: string
  timeoutMs?: number
  /** Timeout of `import_image`, the exports and the drawing calls. Default 120 s. */
  importTimeoutMs?: number
  fetchImpl?: typeof fetch
  mcp?: McpHttpClient
  /** The bearer token of Pixel Studio's MCP server (`PIXEL_STUDIO_MCP_TOKEN`). */
  token?: string | null
  /** Starts the studio when nothing answers (see `McpHttpOptions.ensureUp`). */
  ensureUp?: (signal?: AbortSignal) => Promise<true | string>
}

function need<T>(json: Record<string, unknown> | null, tool: string, key: string): T {
  if (!json || json[key] === undefined) throw new StudioError(`Pixel Studio: ${tool} did not return "${key}" (is the studio older than the Edu Studio contract?)`, 'contract')
  return json as T
}

export function createPixelClient(opts: PixelClientOptions): PixelClient {
  const timeoutMs = opts.timeoutMs ?? 15_000
  const longMs = opts.importTimeoutMs ?? 120_000
  const mcp = opts.mcp ?? createMcpClient({ url: opts.url, label: 'Pixel Studio', notRunningHint: opts.notRunningHint, timeoutMs, fetchImpl: opts.fetchImpl, token: opts.token, tokenVar: 'PIXEL_STUDIO_MCP_TOKEN', ensureUp: opts.ensureUp })
  const call = (tool: string, args: object, ms: number, signal?: AbortSignal) => asStudioError(() => mcp.callTool(tool, args, { timeoutMs: ms, signal }))
  return {
    url: mcp.url,
    importImage: async (args, signal) => need<ImportResult>((await call('import_image', args, longMs, signal)).json, 'import_image', 'documentId'),
    exportPng: async (args, signal) => need<{ paths: string[]; width: number; height: number }>((await call('export_png', args, longMs, signal)).json, 'export_png', 'paths'),
    exportMany: async (items, signal) => need<{ paths: string[] }>((await call('export_many', { items }, longMs, signal)).json, 'export_many', 'paths'),
    drawSpriteFromReference: async (args, signal) => {
      const r = await call('draw_sprite_from_reference', args, longMs, signal)
      return { ...need<Omit<DrawReferenceResult, 'guidance'>>(r.json, 'draw_sprite_from_reference', 'documentId'), guidance: r.human }
    },
    listDocuments: async (signal) => ((await call('list_documents', {}, timeoutMs, signal)).json?.documents as DocumentInfo[] | undefined) ?? [],
    openDocument: async (args, signal) => need<{ documentId: string; name: string; width: number; height: number; path: string }>((await call('open_document', args, timeoutMs, signal)).json, 'open_document', 'documentId'),
    saveDocument: async (args, signal) => need<{ documentId: string; path: string; exported?: string }>((await call('save_document', args, longMs, signal)).json, 'save_document', 'path'),
    callTool: (name, args, signal) => call(name, args, longMs, signal),
    listTools: (signal) => asStudioError(() => mcp.listTools({ timeoutMs, signal }))
  }
}
