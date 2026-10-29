import { useMemo, useState } from 'react'
import type { CourseItem } from '../../../shared/course'
import type { CourseLoadedView } from '../../../shared/protocol'
import { THEMES } from '../../../design/themes'
import { courseTheme, mainShell, resolverFor } from '../../lib/course'
import { Empty, Pill } from '../common'
import { ItemPreview } from './ItemPreview'

/** The game shells and the roadmap tickets that build the ones that are not there yet. */
export const SHELL_INFO: { id: string; name: string; blurb: string; ticket: string | null }[] = [
  { id: 'quiz-arena', name: 'Quiz arena', blurb: 'Rounds of mixed questions with a timer, a combo, a boss round and a review of the misses.', ticket: null },
  { id: 'mindmaze', name: 'MindMaze castle', blurb: 'Walk a castle of rooms; every door is a question.', ticket: 'EGS-11' },
  { id: 'encyclopedia', name: 'Encyclopedia explorer', blurb: 'Articles with images, a timeline and a map, and hunts that send you back into them.', ticket: 'EGS-10' },
  { id: 'rpg', name: 'RPG quest', blurb: 'A tile map, characters and turn battles where the moves are answers.', ticket: 'EGS-12' },
  { id: 'roleplay', name: 'Language role-play', blurb: 'Dialogue scenes you answer in the language you learn, and a vocabulary garden.', ticket: 'EGS-13' },
  { id: 'detective', name: 'Detective and escape room', blurb: 'Logic puzzles that code makes and proves, with clues taken from the course.', ticket: 'EGS-14' }
]

/** The first multiple-choice item, else the first item: the one every look is shown with. */
function sampleItem(items: readonly CourseItem[]): CourseItem | undefined {
  return items.find((i) => i.kind === 'mcq') ?? items.find((i) => i.kind === 'true-false') ?? items[0]
}

export function GameTab({ slug, data }: { slug: string; data: CourseLoadedView }) {
  const { pack } = data
  const used = courseTheme(pack)
  const [look, setLook] = useState<string>(used.id)
  const sample = useMemo(() => sampleItem(pack.items), [pack.items])
  const text = resolverFor(data)
  const lang = pack.languages.includes(pack.sourceLang) ? pack.sourceLang : (pack.languages[0] ?? pack.sourceLang)
  const shell = mainShell(pack)
  return (
    <div className="tab-body" data-testid="tab-game">
      <section aria-labelledby="game-shells">
        <h2 id="game-shells" className="sub-title">
          Game
        </h2>
        <p className="dim">One course, several games. The course file lists which it plays in (<code>shells.enabled</code>).</p>
        <ul className="shells" data-testid="shell-list">
          {SHELL_INFO.map((s) => {
            const on = pack.shells.enabled.includes(s.id)
            return (
              <li key={s.id} className={s.ticket ? 'shell soon' : 'shell'} data-testid={`shell-${s.id}`}>
                <div className="row spread">
                  <h3>{s.name}</h3>
                  <span className="row">
                    {on && <Pill tone="accent">on in this course</Pill>}
                    {s.ticket ? <Pill tone="dim">coming with {s.ticket}</Pill> : <Pill tone="good">available</Pill>}
                  </span>
                </div>
                <p>{s.blurb}</p>
              </li>
            )
          })}
        </ul>
      </section>

      <section aria-labelledby="game-looks">
        <h2 id="game-looks" className="sub-title">
          Look
        </h2>
        <p className="dim">
          This course uses the <b>{used.label}</b> look for its {shell} game. The quiz arena plays the chalkboard look in this version; the other looks belong to the shells that use them and are shown here with a real question of this course.
        </p>
        {!sample ? (
          <Empty title="Add an item to see the looks" testId="looks-empty">
            <p>The looks are shown with a question from the course, and this course has none yet.</p>
          </Empty>
        ) : (
          <>
            <fieldset className="looks" data-testid="look-picker">
              <legend>Compare the looks</legend>
              {THEMES.map((t) => (
                <label key={t.id} className={look === t.id ? 'look on' : 'look'} data-testid={`look-${t.id}`}>
                  <input type="radio" name="look" value={t.id} checked={look === t.id} onChange={() => setLook(t.id)} aria-describedby={`look-desc-${t.id}`} data-testid={`look-radio-${t.id}`} />
                  <span className="look-head">
                    <b>{t.label}</b>
                    {used.id === t.id && <Pill tone="accent">used by this course</Pill>}
                  </span>
                  <span className="swatches" aria-hidden="true">
                    {Object.values(t.swatch).map((c) => (
                      <i key={c} style={{ background: c }} />
                    ))}
                  </span>
                  <span className="look-sample" aria-hidden="true">
                    <span className="edu-stage mini" data-edu-theme={t.id}>
                      <span className="mini-q" style={{ fontFamily: t.display }}>
                        {text.t(sample.prompt)}
                      </span>
                      <span className="mini-a" style={{ fontFamily: t.body }}>
                        <span>A</span>
                        <span>B</span>
                        <span>C</span>
                      </span>
                    </span>
                  </span>
                  <span className="dim look-desc" id={`look-desc-${t.id}`}>
                    {t.description} Fonts: {t.fonts.map((f) => f.replace(/-/g, ' ')).join(', ')}.
                  </span>
                </label>
              ))}
            </fieldset>
            <ItemPreview slug={slug} pack={pack} catalogs={data.text} item={sample} lang={lang} themeId={look} />
          </>
        )}
      </section>
    </div>
  )
}
