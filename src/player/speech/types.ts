/** Speaking practice (EGS-18): a recognizer turns the learner's voice into text for a text input. It never scores pronunciation. */

export type SpeechState = 'idle' | 'listening' | 'thinking' | 'error'

/** Why a recognition failed: shown to the learner as a short sentence, typing always remains. */
export type SpeechError = 'denied' | 'no-speech' | 'unavailable' | 'failed'

export interface SpeechHandlers {
  onState(state: SpeechState, error?: SpeechError): void
  /** The final transcript of this turn. */
  onText(text: string): void
}

export interface SpeechSession {
  /** Ends the turn: a recognizer that has heard something still delivers its text. */
  stop(): void
}

export interface SpeechService {
  /** `web`: the browser's Web Speech API (Chromium sends the audio to the browser vendor). `whisper`: a local whisper.cpp endpoint. */
  kind: 'web' | 'whisper'
  lang: string
  start(handlers: SpeechHandlers): SpeechSession
}
