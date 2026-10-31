import type { SpeechError } from './types'

export class WhisperError extends Error {
  constructor(
    readonly code: SpeechError,
    message: string
  ) {
    super(message)
  }
}

/** POSTs a WAV to the local endpoint (`POST /stt`, body = the WAV) and returns the text of its `{text}` answer. */
export async function transcribe(url: string, wav: Uint8Array, lang: string, opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<string> {
  const f = opts.fetchImpl ?? fetch
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000)
  try {
    const base = url.replace(/\/+$/, '')
    const target = `${/\/stt$/.test(base) ? base : `${base}/stt`}?lang=${encodeURIComponent(lang)}`
    const res = await f(target, { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: wav as BodyInit, signal: ctrl.signal })
    if (!res.ok) throw new WhisperError('failed', `the speech endpoint answered ${res.status}`)
    const json = (await res.json()) as { text?: unknown }
    if (typeof json.text !== 'string') throw new WhisperError('failed', 'the speech endpoint sent no text')
    return json.text.trim()
  } catch (e) {
    if (e instanceof WhisperError) throw e
    throw new WhisperError('unavailable', e instanceof Error ? e.message : String(e))
  } finally {
    clearTimeout(timer)
  }
}
