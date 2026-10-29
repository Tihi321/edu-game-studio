import type { CourseLoadedView } from '../../../shared/protocol'
import { courseTheme, langName, mainShell } from '../../lib/course'
import { useCourseBrief, useResearchNotes } from '../../store/pipeline-hooks'
import { Coming } from '../common'

/** The course facts (from the pack) and the brief and research of the pipeline (typed slots, filled by the pipeline tickets). */
export function BriefTab({ slug, data }: { slug: string; data: CourseLoadedView }) {
  const { pack, stats } = data
  const brief = useCourseBrief(slug)
  const research = useResearchNotes(slug)
  const theme = courseTheme(pack)
  const facts: [string, string][] = [
    ['Subject', pack.subject],
    ['Audience', pack.audience],
    ...(pack.cefr ? ([['Level (CEFR)', pack.cefr]] as [string, string][]) : []),
    ['Written in', langName(pack.sourceLang)],
    ['Editions', pack.languages.map(langName).join(', ')],
    ...(pack.targetLang ? ([['Language taught', langName(pack.targetLang)]] as [string, string][]) : []),
    ['Typed answers', `accents ${pack.matching.diacritics}, ${pack.matching.typos ? 'one-letter typos accepted' : 'typos not accepted'}`],
    ['Games', pack.shells.enabled.join(', ')],
    ['Look', `${theme.label} (for the ${mainShell(pack)} shell)`],
    ['Size', `${stats.units} units, ${stats.objectives} objectives, ${stats.items} items, ${pack.encyclopedia.articles.length} articles, ${pack.factbase.length} sources`]
  ]
  return (
    <div className="tab-body" data-testid="tab-brief">
      <section aria-labelledby="brief-facts">
        <h2 id="brief-facts" className="sub-title">
          About this course
        </h2>
        <dl className="facts" data-testid="course-facts">
          {facts.map(([k, v]) => (
            <div key={k} className="fact-row">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="brief-brief">
        <h2 id="brief-brief" className="sub-title">
          The brief
        </h2>
        {brief.data ? (
          <dl className="facts" data-testid="brief-data">
            <div className="fact-row">
              <dt>Topic</dt>
              <dd>{brief.data.topic}</dd>
            </div>
            <div className="fact-row">
              <dt>Audience</dt>
              <dd>{brief.data.audience}</dd>
            </div>
            {brief.data.notes && (
              <div className="fact-row">
                <dt>Notes</dt>
                <dd>{brief.data.notes}</dd>
              </div>
            )}
          </dl>
        ) : (
          <Coming ticket={brief.ticket} testId="brief-coming">
            <p>No brief is kept for this course yet. The director will write the topic, audience, level, languages, games and length here when the pipeline starts a course from an idea. The facts above come from the course files, so they are always current.</p>
          </Coming>
        )}
      </section>

      <section aria-labelledby="brief-research">
        <h2 id="brief-research" className="sub-title">
          Research notes
        </h2>
        {research.available ? (
          <ul className="plain" data-testid="research-list">
            {research.data.map((n) => (
              <li key={n.id}>
                <b>{n.title}</b> <span className="dim">{n.source}</span>
                <p>{n.summary}</p>
              </li>
            ))}
          </ul>
        ) : (
          <Coming ticket={research.ticket} testId="research-coming">
            <p>
              The researcher will collect sourced notes here, and the fact-checker will compare every item and article to them. The sources a course cites today are listed in the{' '}
              {pack.factbase.length > 0 ? `fact base (${pack.factbase.length} sources, shown with each article in the Encyclopedia tab)` : 'fact base, which this course does not have yet'}.
            </p>
          </Coming>
        )}
      </section>
    </div>
  )
}
