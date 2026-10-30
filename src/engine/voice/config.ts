import path from 'node:path'
import { z } from 'zod'
import { readMd } from '../store/atomic'

/** `config/voice.md`: the format, speed and chunking of the voice clips (the local engines themselves live in ComfyUI). */
export const voiceConfigSchema = z.object({
  /** The file format of a clip: the Flow previews and the ComfyUI save node both follow it. */
  format: z.enum(['mp3', 'wav']).default('mp3'),
  /** The speed multiplier of the engines that take one (OmniVoice, F5-TTS). */
  speed: z.number().min(0.5).max(2).default(1),
  /** A long line is split for `UnifiedTTSTextNode` after this many characters (100-1000). */
  chunkChars: z.number().int().min(100).max(1000).default(400),
  /** Google's free Gemini TTS allows this many requests a day (every `flow_narrate` call that reaches Gemini counts, a retry too). */
  geminiDailyLimit: z.number().int().min(0).default(10),
  /** The time zone whose midnight resets the Gemini quota: Google resets the free tier at Pacific midnight. */
  geminiResetTz: z.string().default('America/Los_Angeles'),
  /** The most characters one narration clip speaks (a longer text is cut at a sentence). */
  narrationMaxChars: z.number().int().min(100).max(4000).default(600)
})
export type VoiceConfig = z.infer<typeof voiceConfigSchema>

/** `config/voice.md`; a missing or broken file gives the defaults. */
export async function loadVoiceConfig(dataDir: string): Promise<VoiceConfig> {
  let data: Record<string, unknown> = {}
  try {
    data = (await readMd(path.join(dataDir, 'config', 'voice.md'))).data
  } catch {
    /* defaults */
  }
  const parsed = voiceConfigSchema.safeParse(data)
  return parsed.success ? parsed.data : voiceConfigSchema.parse({})
}
