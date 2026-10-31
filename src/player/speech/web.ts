import type { SpeechHandlers, SpeechService } from './types'

interface Rec {
  lang: string
  interimResults: boolean
  continuous: boolean
  maxAlternatives: number
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((e: { error?: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}
type RecCtor = new () => Rec

export function webRecognitionCtor(win: Window): RecCtor | undefined {
  const w = win as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

/** The Web Speech API recognizer (`lang` = the course's target language). */
export function webService(Ctor: RecCtor, lang: string): SpeechService {
  return {
    kind: 'web',
    lang,
    start(h: SpeechHandlers) {
      let rec: Rec
      let text = ''
      let failed = false
      try {
        rec = new Ctor()
        rec.lang = lang
        rec.interimResults = false
        rec.continuous = false
        rec.maxAlternatives = 1
        rec.onresult = (e) => {
          text = Array.from(e.results)
            .map((r) => r[0]?.transcript ?? '')
            .join(' ')
            .trim()
        }
        rec.onerror = (e) => {
          failed = true
          const code = e.error
          h.onState('error', code === 'not-allowed' || code === 'service-not-allowed' ? 'denied' : code === 'no-speech' ? 'no-speech' : code === 'network' || code === 'audio-capture' ? 'unavailable' : 'failed')
        }
        rec.onend = () => {
          if (failed) return
          if (text) h.onText(text)
          if (text) h.onState('idle')
          else h.onState('error', 'no-speech')
        }
        rec.start()
        h.onState('listening')
      } catch {
        h.onState('error', 'unavailable')
        return { stop: () => undefined }
      }
      return { stop: () => rec.stop() }
    }
  }
}
