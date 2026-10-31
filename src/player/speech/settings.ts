import { z } from 'zod'

/**
 * `pack.extensions.speaking` (EGS-18): `enabled` (default true for a course with a `targetLang`, false for any other) and `whisperUrl`
 * (a local whisper endpoint, see docs/speaking.md; only a loopback address is accepted, the audio never goes anywhere else).
 */
export interface SpeakingConfig {
  enabled: boolean
  whisperUrl?: string
}

const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?(\/.*)?$/i

const speakingSchema = z.object({
  enabled: z.boolean().optional(),
  whisperUrl: z.string().regex(LOOPBACK).optional()
})

export function speakingConfig(extensions: unknown, targetLang: string | undefined): SpeakingConfig {
  const raw = (extensions as { speaking?: unknown } | null | undefined)?.speaking
  const parsed = speakingSchema.safeParse(raw && typeof raw === 'object' ? raw : {})
  // a bad whisperUrl drops the whole block back to the defaults, never to a remote address
  const v = parsed.success ? parsed.data : {}
  const enabled = targetLang ? v.enabled !== false : false
  return { enabled, ...(enabled && v.whisperUrl ? { whisperUrl: v.whisperUrl } : {}) }
}
