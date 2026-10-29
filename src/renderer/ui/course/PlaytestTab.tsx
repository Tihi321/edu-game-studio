import { courseFileUrl } from '../../api'
import type { CourseLoadedView } from '../../../shared/protocol'
import { useEdu } from '../../store/hooks'
import { usePlaytestRuns } from '../../store/pipeline-hooks'
import { Coming, CopyLine, Pill } from '../common'

const MODES = [
  { id: 'perfect', flag: '--mode perfect', what: 'answers every item right: every unit to three stars, the boss, the end screen' },
  { id: 'wrong', flag: '--mode wrong', what: 'answers every item wrong: the explanations show and the review queue fills' },
  { id: 'random', flag: '--mode random --accuracy 0.75 --seed 7', what: 'a seeded learner that must finish inside the step bound' },
  { id: 'keyboard', flag: '--keyboard --axe', what: 'plays with the keyboard only, and runs the accessibility checker on every screen' }
] as const

/**
 * The playtest: the autoplay bot plays the built game as simulated learners. The studio does not run it itself yet (it needs a browser
 * driver that the packaged app does not carry): the page gives the exact commands and shows the runs the playtester role records (EGS-08).
 */
export function PlaytestTab({ slug, data }: { slug: string; data: CourseLoadedView }) {
  const runs = usePlaytestRuns(slug)
  const dataDir = useEdu((s) => s.dataDir)
  const folder = `${dataDir || '<data folder>'}/courses/${slug}/build`
  return (
    <div className="tab-body" data-testid="tab-playtest">
      <section aria-labelledby="play-runs">
        <h2 id="play-runs" className="sub-title">
          Bot runs
        </h2>
        {runs.available ? (
          <ul className="runs" data-testid="run-list">
            {runs.data.map((r) => (
              <li key={r.id} data-testid={`run-${r.id}`}>
                <div className="row">
                  <Pill tone={r.ok ? 'good' : 'bad'}>{r.ok ? 'passed' : 'failed'}</Pill>
                  <b>{r.mode}</b>
                  <span className="dim">
                    {r.steps} steps, {r.correct} right, {r.wrong} wrong, {new Date(r.at).toLocaleString('en')}
                  </span>
                </div>
                {r.failures.length > 0 && (
                  <ul>
                    {r.failures.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                )}
                {r.screenshots.length > 0 && (
                  <div className="shots">
                    {r.screenshots.map((s) => (
                      <a key={s} href={courseFileUrl(s)} target="_blank" rel="noreferrer noopener">
                        <img src={courseFileUrl(s)} alt={`Screenshot of the ${r.mode} run: ${s.split('/').pop()}`} loading="lazy" />
                      </a>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <Coming ticket={runs.ticket} testId="playtest-coming">
            <p>No bot run is recorded for this course. The playtester role will run the bot after every build, keep the results here and send the problems back to the roles that can fix them.</p>
          </Coming>
        )}
      </section>

      <section aria-labelledby="play-how">
        <h2 id="play-how" className="sub-title">
          Run the bot yourself
        </h2>
        {!data.build.built && <p className="inline-warn">Build the game first (Build tab): the bot plays the built folder.</p>}
        <p className="dim">One run per mode. Each prints a summary and exits non-zero when a check fails. Add <code>--shots &lt;folder&gt;</code> to keep a screenshot of every screen.</p>
        <ul className="plain modes" data-testid="bot-modes">
          {MODES.map((m) => (
            <li key={m.id}>
              <p>
                <b>{m.id}</b> <span className="dim">{m.what}</span>
              </p>
              <CopyLine text={`yarn play "${folder}" ${m.flag}`} label={`run the ${m.id} bot`} testId={`bot-cmd-${m.id}`} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
