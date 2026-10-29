import { useMemo } from 'react'
import type { CourseLoadedView } from '../../../shared/protocol'
import { langName, textCoverage } from '../../lib/course'
import { Pill } from '../common'

/** Editions: every language of the course and how much of the text each catalog covers. */
export function EditionsTab({ data }: { data: CourseLoadedView }) {
  const { pack, text } = data
  const coverage = useMemo(() => textCoverage(pack, text), [pack, text])
  return (
    <div className="tab-body" data-testid="tab-editions">
      <h2 className="sr-only">Editions of this course</h2>
      <p className="dim">
        Every visible string of a course is a key in a text catalog, one file per language. An edition is a language the game can be played in; it needs every key. Book Translator makes new editions (EGS-18).
      </p>
      <ul className="editions" data-testid="edition-list">
        {coverage.map((c) => {
          const pct = c.needed === 0 ? 100 : Math.floor((c.present / c.needed) * 100)
          return (
            <li key={c.lang} className="edition" data-testid={`edition-${c.lang}`}>
              <div className="row spread">
                <h3>
                  {langName(c.lang)} <code>{c.lang}</code>
                </h3>
                <span className="row">
                  {c.lang === pack.sourceLang && <Pill tone="accent">source</Pill>}
                  {c.role === 'target' && <Pill tone="accent">language taught</Pill>}
                  {!c.hasCatalog && <Pill tone="bad">no catalog file</Pill>}
                  {c.missingCount === 0 && c.hasCatalog && <Pill tone="good">complete</Pill>}
                </span>
              </div>
              <div className="meter" role="meter" aria-label={`${langName(c.lang)} text coverage`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={`${pct} percent`}>
                <span style={{ width: `${pct}%` }} />
              </div>
              <p data-testid={`coverage-${c.lang}`}>
                {c.present} of {c.needed} texts, {pct}%.
                {c.role === 'target' ? ' This catalog holds the phrases the course teaches and their accepted answers; every edition reads them.' : ''}
              </p>
              {c.missingCount > 0 && (
                <details>
                  <summary data-testid={`missing-toggle-${c.lang}`}>
                    {c.missingCount} {c.missingCount === 1 ? 'text is' : 'texts are'} missing
                  </summary>
                  <ul className="missing">
                    {c.missing.map((m) => (
                      <li key={m.key}>
                        <code>{m.key}</code> <span className="dim">{m.where}</span>
                      </li>
                    ))}
                    {c.missingCount > c.missing.length && <li className="dim">and {c.missingCount - c.missing.length} more</li>}
                  </ul>
                </details>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
