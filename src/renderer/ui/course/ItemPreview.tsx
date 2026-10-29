import { useEffect, useMemo, useRef, useState } from 'react'
import type { CourseItem, CoursePack, TextCatalog } from '../../../shared/course'
import { checkItem, makeTextResolver, SeededRandom, type CheckResult } from '../../../shared/edu'
import { GAME_DATA_FORMAT, GAME_DATA_VERSION, type GameData } from '../../../shared/game-data'
import { BUILTIN_RENDERERS } from '../../../player/items'
import { buildFeedback, type Feedback } from '../../../player/feedback'
import { makeUi, SPECIAL_LETTERS } from '../../../player/i18n'
import type { ItemContext, ItemRenderer, ItemView } from '../../../player/types'
import { courseAssetUrl } from '../../api'
import { Pill } from '../common'
import './embed'

const RENDERERS = new Map<string, ItemRenderer>(BUILTIN_RENDERERS.map((r) => [r.kind, r]))

/** The game data a renderer reads (`pack.assets`, the catalogs), made from the studio's course: nothing is built or saved. */
function gameDataOf(slug: string, pack: CoursePack, catalogs: Record<string, TextCatalog>, lang: string): GameData {
  const assets: Record<string, string> = {}
  for (const a of pack.assets) assets[a.id] = courseAssetUrl(slug, a.file)
  return { format: GAME_DATA_FORMAT, version: GAME_DATA_VERSION, slug, builtAt: '', engine: 'studio-preview', pack, catalogs, defaultLang: lang, assets, shell: 'quiz-arena' }
}

interface Answered {
  result: CheckResult
  feedback: Feedback
}

/**
 * The live preview of an item: the player's OWN renderer for the item's kind, mounted inside `.edu-stage[data-edu-theme]` (the scope the
 * player's CSS is written for), so it looks and behaves as in the game. The shared `checkItem` decides right or wrong, and the player's
 * `buildFeedback` writes what the learner would read after the answer. It is a draft: nothing is saved by answering.
 */
export function ItemPreview({ slug, pack, catalogs, item, lang, themeId }: { slug: string; pack: CoursePack; catalogs: Record<string, TextCatalog>; item: CourseItem; lang: string; themeId: string }) {
  const host = useRef<HTMLDivElement>(null)
  const [answered, setAnswered] = useState<Answered | null>(null)
  const [round, setRound] = useState(0)
  const renderer = RENDERERS.get(item.kind)
  const ui = useMemo(() => makeUi(lang, catalogs[lang]), [lang, catalogs])
  const text = useMemo(() => makeTextResolver(catalogs, lang, pack.targetLang), [catalogs, lang, pack.targetLang])

  useEffect(() => {
    const root = host.current
    if (!root) return
    root.replaceChildren()
    setAnswered(null)
    if (!renderer) return
    const check = { text, diacritics: pack.matching.diacritics, typos: pack.matching.typos }
    const data = gameDataOf(slug, pack, catalogs, lang)
    const seed = `preview:${item.id}:${round}`
    const assets = new Map(pack.assets.map((a) => [a.id, a]))
    let view: ItemView | undefined
    let done: CheckResult | undefined
    const ctx: ItemContext = {
      item,
      data,
      lang,
      text,
      check,
      rng: new SeededRandom(seed),
      seed,
      assetUrl: (id) => (id ? data.assets[id] : undefined),
      assetAlt: (id) => {
        const a = id ? assets.get(id) : undefined
        return a ? text.t(a.alt) : ''
      },
      ui,
      specialLetters: SPECIAL_LETTERS[pack.targetLang ?? lang] ?? [],
      submit: (answer) => {
        if (done) return done
        done = checkItem(item, answer, check)
        view?.reveal(done, answer)
        setAnswered({ result: done, feedback: buildFeedback(item, answer, done, { text, ui, rng: new SeededRandom(`${seed}:fb`) }) })
        return done
      }
    }
    try {
      view = renderer.render(ctx)
    } catch (e) {
      root.textContent = `The preview could not draw this item: ${(e as Error).message}`
      return
    }
    const prompt = renderer.ownsPrompt ? null : Object.assign(document.createElement('h2'), { className: 'prompt', textContent: text.t(item.prompt) })
    prompt?.setAttribute('data-testid', 'preview-prompt')
    const body = Object.assign(document.createElement('div'), { className: `item-body kind-${item.kind}` })
    body.setAttribute('data-kind', item.kind)
    body.appendChild(view.el)
    const section = Object.assign(document.createElement('section'), { className: 'question' })
    section.setAttribute('aria-label', 'Item preview')
    if (prompt) section.appendChild(prompt)
    section.appendChild(body)
    root.appendChild(section)
    return () => view?.destroy?.()
  }, [renderer, item, catalogs, lang, pack, slug, text, ui, round])

  return (
    <div className="preview" data-testid="item-preview">
      <div className="row spread">
        <h3 className="sub-title">Preview</h3>
        <div className="row">
          <Pill tone="dim" testId="preview-theme">
            {themeId} look
          </Pill>
          <button onClick={() => setRound((r) => r + 1)} data-testid="preview-reset">
            Try again
          </button>
        </div>
      </div>
      {!renderer ? (
        <p className="dim" data-testid="preview-unsupported">
          The player has no renderer for the kind “{item.kind}”, so there is nothing to preview.
        </p>
      ) : (
        <div className="edu-stage" data-edu-theme={themeId} data-testid="preview-stage" data-item={item.id}>
          <div ref={host} className="preview-host" />
        </div>
      )}
      {answered && <PreviewResult answered={answered} />}
      {renderer && !answered && <p className="dim preview-hint">Answer it here: the shared checker says right or wrong, as in the game. Nothing is saved.</p>}
    </div>
  )
}

function PreviewResult({ answered }: { answered: Answered }) {
  const { result, feedback } = answered
  return (
    <div className="preview-result" data-testid="preview-feedback" data-result={feedback.verdict} role="status">
      <p className="preview-verdict">
        <Pill tone={result.correct ? 'good' : result.partial ? 'warn' : 'bad'} testId="preview-verdict">
          {result.correct ? 'Right' : result.partial ? 'Partly right' : 'Not right'}
        </Pill>{' '}
        <span>{feedback.title}</span>
      </p>
      {feedback.detail && <p>{feedback.detail}</p>}
      {feedback.notes.map((n) => (
        <p key={n} className="dim">
          {n}
        </p>
      ))}
      {feedback.whys.map((w) => (
        <p key={w}>
          <b>Why that is not it.</b> {w}
        </p>
      ))}
      {feedback.answer.length > 0 && (
        <p>
          <b>The answer.</b> {feedback.answer.join('; ')}
        </p>
      )}
      {feedback.explanation && (
        <p>
          <b>The idea.</b> {feedback.explanation}
        </p>
      )}
      {feedback.dyk && (
        <p>
          <b>Did you know?</b> {feedback.dyk}
        </p>
      )}
    </div>
  )
}
