import { speakingConfig } from './settings'
import type { SpeechService } from './types'
import { webRecognitionCtor, webService } from './web'
import { canRecord, whisperService } from './whisper'

export type { SpeechError, SpeechHandlers, SpeechService, SpeechSession, SpeechState } from './types'
export { speakingConfig } from './settings'

/**
 * The speech service of a course, or undefined when the course has none: not a language course, `extensions.speaking.enabled` false, or no
 * recognizer in this browser (then the player shows no mic button). A configured local whisper endpoint wins over the browser's recognizer.
 */
export function createSpeechService(win: Window, extensions: unknown, targetLang: string | undefined): SpeechService | undefined {
  const cfg = speakingConfig(extensions, targetLang)
  if (!cfg.enabled || !targetLang) return undefined
  if (cfg.whisperUrl && canRecord(win)) return whisperService(win, cfg.whisperUrl, targetLang)
  const Ctor = webRecognitionCtor(win)
  return Ctor ? webService(Ctor, targetLang) : undefined
}
