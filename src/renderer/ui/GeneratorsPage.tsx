import { useEffect } from 'react'
import { sendCommand } from '../api'
import { langName } from '../lib/course'
import { useEdu } from '../store/hooks'
import { eduStore } from '../store/store'
import { Empty, Loading, Pill } from './common'

/** What an engine makes, in words (`voice` for speech, `effect` for a sound effect). */
const taskLabel = (task: 'music' | 'tts' | 'sfx'): string => (task === 'tts' ? 'voice' : task === 'sfx' ? 'effect' : 'music')

/** The language coverage of an engine: `any language`, `12 languages`, or null (no language input). */
function languageHint(languages: string[] | '*'): string | null {
  if (languages === '*') return 'any language'
  return languages.length > 0 ? `${languages.length} language${languages.length === 1 ? '' : 's'}` : null
}

function GeneratorCard({ id, name, role, ok, detail, hint }: { id: string; name: string; role: string; ok: boolean | null; detail: string; hint: string }) {
  return (
    <li className="gen-card sheet" data-testid={`gen-${id}`}>
      <div className="row spread">
        <h3>{name}</h3>
        <Pill tone={ok === null ? 'dim' : ok ? 'good' : 'bad'} testId={`gen-${id}-status`}>
          {ok === null ? 'checking' : ok ? 'running' : 'not running'}
        </Pill>
      </div>
      <p className="dim">{role}</p>
      {detail && (
        <p className="dim ellipsis" title={detail}>
          {detail}
        </p>
      )}
      {ok === false && (
        <p className="warn" data-testid={`gen-${id}-hint`}>
          {hint}
        </p>
      )}
    </li>
  )
}

/** The tools the studio makes media with: ComfyUI (with the local voice engines) and the studio apps, and whether each answers now. */
export function GeneratorsPage() {
  const comfy = useEdu((s) => s.comfy)
  const voice = useEdu((s) => s.voice)
  const studios = useEdu((s) => s.studios)
  const engines = useEdu((s) => s.engines)
  const workflows = useEdu((s) => s.workflows)
  const freed = useEdu((s) => s.freed)
  const connected = useEdu((s) => s.connected)
  const checking = useEdu((s) => s.checking)
  const refresh = () => {
    const st = eduStore.getState()
    st.markChecking('comfy')
    st.markChecking('voice')
    st.markChecking('studios')
    sendCommand({ type: 'comfyStatus' })
    sendCommand({ type: 'listEngines' })
    sendCommand({ type: 'listCustomWorkflows' })
    sendCommand({ type: 'voiceStatus' })
    sendCommand({ type: 'studiosStatus' })
  }
  useEffect(() => {
    if (connected) refresh()
  }, [connected])

  const lanes = comfy?.lanes ?? []
  const reachable = lanes.filter((l) => l.reachable).length
  const ready = comfy?.engines.filter((e) => e.ready).length ?? 0
  const pixel = studios?.find((s) => s.id === 'pixel')
  const chiptune = studios?.find((s) => s.id === 'chiptune')
  const flow = studios?.find((s) => s.id === 'flow')
  const busy = checking.comfy || checking.voice || checking.studios
  return (
    <div className="page-body" data-testid="page-generators">
      <header className="page-head">
        <h1>Generators</h1>
        <div className="head-actions">
          <button onClick={refresh} disabled={!connected || busy} data-testid="comfy-refresh">
            {busy ? 'Checking...' : 'Check again'}
          </button>
          <button onClick={() => sendCommand({ type: 'comfyFree' })} disabled={!reachable} title="Unloads the models from the video memory of every reachable lane" data-testid="comfy-free">
            Free video memory
          </button>
        </div>
      </header>
      <p className="lede dim">The studio makes pictures, music and voices with these tools. Courses work without them; the media tickets (EGS-15 to EGS-17) use them.</p>
      {!connected && <Empty title="The engine is not connected" testId="generators-offline"><p>The checks run in the engine. Start the app or the engine and this page fills in.</p></Empty>}

      <h2 className="sr-only">Generator apps</h2>
      <ul className="gen-grid" data-testid="generators">
        <GeneratorCard
          id="comfy"
          name="ComfyUI"
          role="Images, music, local voices and sound effects"
          ok={comfy ? comfy.ok : null}
          detail={comfy ? `${reachable} of ${lanes.length} lanes, ${ready} engines ready` : ''}
          hint="Start ComfyUI, then check again. The lanes are in config/comfy.md."
        />
        <GeneratorCard
          id="pixel"
          name="Pixel Studio"
          role="Pixel art: converts images, or draws small sprites"
          ok={pixel ? pixel.ok : null}
          detail={pixel ? (pixel.ok ? `${pixel.tools} tools at ${pixel.url}` : pixel.url) : ''}
          hint={pixel?.error || 'Start it headless: yarn build and yarn mcp in the Pixel Studio folder.'}
        />
        <GeneratorCard
          id="chiptune"
          name="Chiptune Studio"
          role="Chip music: calm loops that play seamlessly"
          ok={chiptune ? chiptune.ok : null}
          detail={chiptune ? (chiptune.ok ? `${chiptune.tools} tools at ${chiptune.url}` : chiptune.url) : ''}
          hint={chiptune?.error || 'Start it headless: yarn build and yarn mcp in the Chiptune Studio folder.'}
        />
        <GeneratorCard id="flow" name="Google Flow" role="Images, voices and songs through flow-music-mcp" ok={flow ? flow.ok : null} detail={flow ? flow.url : ''} hint={flow?.error || 'Start flow-music-mcp and sign in to Google Flow.'} />
      </ul>

      <section className="sheet panel" data-testid="comfy-status" aria-labelledby="gen-comfy">
        <h2 id="gen-comfy" className="panel-title">
          ComfyUI
        </h2>
        {!comfy && (checking.comfy ? <Loading label="Asking ComfyUI" testId="comfy-loading" /> : <p className="dim">Not checked yet.</p>)}
        {comfy && (
          <div className="stack">
            <p className="row">
              <Pill tone={comfy.ok ? 'good' : 'bad'}>{comfy.ok ? 'ready' : 'not ready'}</Pill>
              <span className="dim">
                {reachable} of {lanes.length} lanes reachable, {ready} of {comfy.engines.length} engines ready
              </span>
            </p>
            {lanes.map((l) => (
              <p className="row lane" key={l.url} data-testid={`lane-${l.url}`}>
                <Pill tone={l.reachable ? 'good' : 'bad'}>{l.reachable ? 'reachable' : 'unreachable'}</Pill>
                <code>{l.url}</code>
                {l.reachable && (
                  <span className="dim">
                    {l.running} running, {l.pending} pending
                  </span>
                )}
                {!l.reachable && l.error && <span className="warn">{l.error}</span>}
              </p>
            ))}
            {!lanes.length && <p className="warn">No ComfyUI lane is set. Add one in config/comfy.md in the data folder.</p>}
            {freed && (
              <p className="dim" data-testid="comfy-freed" role="status">
                Free video memory: {freed.map((f) => `${f.lane} ${f.ok ? 'freed' : `failed${f.error ? ` (${f.error})` : ''}`}`).join('; ') || 'nothing to free'}
              </p>
            )}
          </div>
        )}
      </section>

      <section className="sheet panel" data-testid="comfy-engines" aria-labelledby="gen-engines">
        <h2 id="gen-engines" className="panel-title">
          Engines
        </h2>
        {comfy ? (
          <ul className="plain engine-list">
            {comfy.engines.map((e) => (
              <li className="row" key={`${e.kind}:${e.id}`} data-testid={`engine-${e.id}`}>
                <Pill tone={e.ready ? 'good' : 'warn'}>{e.ready ? 'ready' : 'missing'}</Pill>
                <b>{e.label}</b>
                <Pill tone="dim">{taskLabel(e.task)}</Pill>
                <span className="dim">
                  <code>{e.id}</code> ({e.kind}
                  {engines?.image.concat(engines.audio).find((x) => x.id === e.id)?.edit ? ', editor' : ''})
                </span>
                {languageHint(e.languages) && <span className="dim">{languageHint(e.languages)}</span>}
                {!e.ready && e.missing.length > 0 && (
                  <span className="warn ellipsis" title={e.missing.join('\n')}>
                    {e.missing.length} missing: {e.missing.slice(0, 3).join(', ')}
                    {e.missing.length > 3 ? ', ...' : ''}
                  </span>
                )}
              </li>
            ))}
            {!comfy.engines.length && <li className="dim">No engines known.</li>}
          </ul>
        ) : (
          <p className="dim">Waiting for ComfyUI.</p>
        )}
      </section>

      <section className="sheet panel" data-testid="comfy-voices" aria-labelledby="gen-voices">
        <h2 id="gen-voices" className="panel-title">
          Local voices
        </h2>
        {!voice && (checking.voice ? <Loading label="Asking the voice engines" testId="voices-loading" /> : <p className="dim">Not checked yet.</p>)}
        {voice && (
          <div className="stack">
            {!voice.ok && (
              <p className="warn" data-testid="comfy-voices-error">
                {voice.error}
              </p>
            )}
            <p className="row">
              <Pill tone={voice.ok ? 'good' : 'bad'}>{voice.ok ? 'reachable' : 'not reachable'}</Pill>
              <span className="dim">{voice.comfyUrl || 'config/comfy.md'}</span>
              <span className="dim">
                default engine: <code>{voice.defaultEngine}</code>
              </span>
            </p>
            <ul className="plain engine-list">
              {voice.engines.map((e) => (
                <li className="row" key={e.id} data-testid={`comfy-voice-${e.id}`}>
                  <Pill tone={e.ready ? 'good' : 'warn'}>{e.ready ? 'ready' : 'missing'}</Pill>
                  <b>{e.label}</b>
                  <Pill tone="dim">{taskLabel(e.task)}</Pill>
                  {languageHint(e.languages) && <span className="dim">{languageHint(e.languages)}</span>}
                  {!e.ready && e.missing.length > 0 && (
                    <span className="warn ellipsis" title={e.missing.join('\n')}>
                      {e.missing.slice(0, 3).join(', ')}
                      {e.missing.length > 3 ? ', ...' : ''}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            {voice.ok && !voice.engines.length && <p className="dim">No local voice or sound-effect engine is installed.</p>}
            {voice.workflows.length > 0 && <p className="dim">Custom voice workflows: {voice.workflows.map((w) => `${w.name} (${w.languages.map(langName).join(', ')})`).join('; ')}</p>}
          </div>
        )}
      </section>

      <section className="sheet panel" data-testid="comfy-bgremoval" aria-labelledby="gen-bg">
        <h2 id="gen-bg" className="panel-title">
          Background removal
        </h2>
        {comfy?.backgroundRemoval.available ? (
          <p className="row">
            <Pill tone="good">available</Pill>
            <span className="dim">
              {comfy.backgroundRemoval.models.length} model file(s): {comfy.backgroundRemoval.models.join(', ')}
            </span>
          </p>
        ) : (
          <p className="row">
            <Pill tone="warn">no model</Pill>
            <span className="dim">No model in models/background_removal: sprites use flat-background keying.</span>
          </p>
        )}
      </section>

      <section className="sheet panel" data-testid="comfy-workflows" aria-labelledby="gen-workflows">
        <h2 id="gen-workflows" className="panel-title">
          Custom workflows
        </h2>
        <ul className="plain">
          {(workflows ?? []).map((w) => (
            <li className="row" key={w.name}>
              <b>{w.name}</b>
              <Pill>{w.kind}</Pill>
              {w.languages.length > 0 && <span className="dim">speaks {w.languages.map(langName).join(', ')}</span>}
            </li>
          ))}
          {!workflows?.length && comfy?.customWorkflows.map((n) => <li key={n}>{n}</li>)}
          {!workflows?.length && !comfy?.customWorkflows.length && <li className="dim">None. Put a ComfyUI workflow (.json) and its .map.yaml in the data folder&apos;s workflows/ folder.</li>}
        </ul>
      </section>
    </div>
  )
}
