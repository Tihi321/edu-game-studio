import { useEffect } from 'react'
import { sendCommand } from '../../api'
import type { CourseLoadedView } from '../../../shared/protocol'
import { courseAssetUrl } from '../../api'
import { langName, resolverFor } from '../../lib/course'
import { useEdu } from '../../store/hooks'
import { eduStore } from '../../store/store'
import { Empty, Pill } from '../common'

/**
 * Voice: the listening items of the course with the clip each one plays, and which local voice engines are ready for the language the
 * course teaches (the engine's `voiceStatus`). Making the clips is EGS-17.
 */
export function VoiceTab({ slug, data }: { slug: string; data: CourseLoadedView }) {
  const { pack } = data
  const text = resolverFor(data)
  const voice = useEdu((s) => s.voice)
  const checking = useEdu((s) => s.checking.voice)
  const connected = useEdu((s) => s.connected)
  useEffect(() => {
    if (connected && !eduStore.getState().voice) {
      eduStore.getState().markChecking('voice')
      sendCommand({ type: 'voiceStatus' })
    }
  }, [connected])
  const listening = pack.items.filter((i) => i.kind === 'listening')
  const lang = pack.targetLang ?? pack.sourceLang
  const ready = voice?.engines.filter((e) => e.ready && (e.languages === '*' || e.languages.includes(lang)) && e.task === 'tts') ?? []
  const placeholder = pack.assets.filter((a) => a.kind === 'audio' && /placeholder|test tone|beep/i.test(text.t(a.alt))).length
  return (
    <div className="tab-body" data-testid="tab-voice">
      <section aria-labelledby="voice-engines">
        <h2 id="voice-engines" className="sub-title">
          Voices for {langName(lang)}
        </h2>
        {checking && !voice && <p className="dim" role="status">Checking the voice engines...</p>}
        {voice && (
          <p data-testid="voice-summary">
            {voice.ok ? (
              ready.length > 0 ? (
                <>
                  <Pill tone="good">ready</Pill> {ready.map((e) => e.label).join(', ')} can read {langName(lang)}.
                </>
              ) : (
                <>
                  <Pill tone="warn">no engine</Pill> None of the local voice engines that are ready reads {langName(lang)}. The Generators page shows what each engine reads.
                </>
              )
            ) : (
              <>
                <Pill tone="bad">ComfyUI not reachable</Pill> {voice.error}
              </>
            )}
          </p>
        )}
        <p className="dim">Making the clips for a course is the voice ticket (EGS-17). Until then listening items use the audio files the course carries.</p>
      </section>

      <section aria-labelledby="voice-items">
        <h2 id="voice-items" className="sub-title">
          Listening items
        </h2>
        {listening.length === 0 ? (
          <Empty title="No listening items" testId="voice-empty" level={3}>
            <p>This course has no item that plays a clip. A listening item (<code>kind: "listening"</code>) plays text-to-speech and asks the learner to choose or type what they heard.</p>
          </Empty>
        ) : (
          <>
            {placeholder > 0 && <p className="inline-warn">{placeholder} {placeholder === 1 ? 'clip is' : 'clips are'} a placeholder tone, not speech. The voice ticket replaces them.</p>}
            <ul className="voice-items" data-testid="voice-list">
              {listening.map((i) => {
                const asset = pack.assets.find((a) => a.id === i.asset)
                return (
                  <li key={i.id} data-testid={`voice-${i.id}`}>
                    <div>
                      <b>{text.t(i.prompt)}</b>
                      <p className="dim">
                        <code>{i.id}</code> says: “{text.t((i as unknown as { transcript: string }).transcript)}”
                      </p>
                    </div>
                    {asset ? <audio controls preload="none" src={courseAssetUrl(slug, asset.file)} aria-label={`Clip of ${i.id}: ${text.t(asset.alt)}`} data-testid={`voice-audio-${i.id}`} /> : <Pill tone="warn">no clip</Pill>}
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}
