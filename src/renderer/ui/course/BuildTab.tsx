import { buildCourseNow, lintCourseNow, openGame } from '../../api'
import type { CourseLoadedView } from '../../../shared/protocol'
import { pipelineStages } from '../../lib/course'
import type { CourseDoc } from '../../store/course'
import { usePlaytestRuns } from '../../store/pipeline-hooks'
import { useState } from 'react'
import { ErrorBox, Loading, Pill } from '../common'
import { StageStrip } from '../StageStrip'

const when = (iso: string | undefined): string => (iso ? new Date(iso).toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' }) : '');

/** Build the game, lint it, and open it. The problems come with their codes (the lint's `PREREQ_CYCLE`, `ITEM_NO_KEY` ... and the validator's). */
export function BuildTab({ slug, data, doc }: { slug: string; data: CourseLoadedView; doc: CourseDoc }) {
  const runs = usePlaytestRuns(slug)
  const stages = pipelineStages(data, doc, runs.data.length)
  const { build } = data
  const [opened, setOpened] = useState<'ok' | 'no' | null>(null)
  const busy = doc.building || doc.linting
  return (
    <div className="tab-body" data-testid="tab-build">
      <section aria-labelledby="build-stages">
        <h2 id="build-stages" className="sub-title">
          Where the course is
        </h2>
        <StageStrip stages={stages} testId="build-stages-strip" />
      </section>

      <section aria-labelledby="build-game">
        <h2 id="build-game" className="sub-title">
          The game
        </h2>
        <p data-testid="build-state">
          {!build.built && (
            <>
              <Pill tone="warn">not built</Pill> No game folder yet. Build the course to make <code>courses/{slug}/build/</code>, a folder that plays in any browser, also from a file.
            </>
          )}
          {build.built && !build.stale && (
            <>
              <Pill tone="good">up to date</Pill> Built {when(build.builtAt)}.
            </>
          )}
          {build.built && build.stale && (
            <>
              <Pill tone="warn">out of date</Pill> The course changed after the build of {when(build.builtAt)}. Build again before you play or lint.
            </>
          )}
        </p>
        <div className="row actions">
          <button className="primary" onClick={() => buildCourseNow(slug)} disabled={busy} data-testid="build-run">
            {doc.building ? 'Building...' : build.built ? 'Build again' : 'Build the game'}
          </button>
          <button onClick={() => lintCourseNow(slug, build.stale === true)} disabled={busy} data-testid="lint-run">
            {doc.linting ? 'Checking...' : build.built && !build.stale ? 'Lint the game' : 'Build and lint'}
          </button>
          <button
            onClick={() => void openGame(slug).then((ok) => setOpened(ok ? 'ok' : 'no'))}
            disabled={!build.built}
            title={build.built ? undefined : 'Build the game first'}
            data-testid="game-open"
          >
            Open the game
          </button>
        </div>
        {opened === 'ok' && <p className="inline-ok" role="status" data-testid="game-opened">Opened in your browser.</p>}
        {opened === 'no' && (
          <p className="inline-warn" role="status" data-testid="game-open-failed">
            The game could not be opened from here (this works in the desktop app). Open <code>courses/{slug}/build/index.html</code> in a browser.
          </p>
        )}
      </section>

      {doc.building && <Loading label="Building the game" testId="build-loading" />}
      {doc.buildError && <ErrorBox title="The build failed" message={doc.buildError} onRetry={() => buildCourseNow(slug)} testId="build-error" />}
      {doc.build && !doc.building && <BuildResult slug={slug} report={doc.build} onForce={() => buildCourseNow(slug, true)} busy={busy} />}

      {doc.linting && <Loading label="Linting the game" testId="lint-loading" />}
      {doc.lintError && <ErrorBox title="The lint could not run" message={doc.lintError} onRetry={() => lintCourseNow(slug)} testId="lint-error" />}
      {doc.lint && !doc.linting && <LintResult report={doc.lint} />}
      {!doc.lint && !doc.linting && !doc.lintError && (
        <p className="dim" data-testid="lint-none">
          The lint has not run in this session. It checks the built game: every answer key, every text in every edition, two forms for each objective, and the prerequisite graph.
        </p>
      )}
    </div>
  )
}

function BuildResult({ slug, report, onForce, busy }: { slug: string; report: NonNullable<CourseDoc['build']>; onForce(): void; busy: boolean }) {
  return (
    <section aria-labelledby="build-result" data-testid="build-result">
      <h2 id="build-result" className="sub-title">
        Last build
      </h2>
      {report.ok ? (
        <p>
          <Pill tone={report.forced ? 'warn' : 'good'}>{report.forced ? 'built with problems' : 'built'}</Pill> {report.files} files written to <code>courses/{slug}/build/</code> at {when(report.at)}.
        </p>
      ) : (
        <p>
          <Pill tone="bad">not built</Pill> The course has {report.problems.length} {report.problems.length === 1 ? 'problem' : 'problems'}, so nothing was written. Fix them in the Items tab, or with the MCP tools, and build again.
        </p>
      )}
      {!report.ok && (
        <p>
          <button onClick={onForce} disabled={busy} data-testid="build-force">
            Build anyway
          </button>{' '}
          <span className="dim">Writes the game although the course has problems, so the lint can report them. Only for a course you are repairing.</span>
        </p>
      )}
      {report.problems.length > 0 && (
        <table className="problems" data-testid="build-problems">
          <caption className="sr-only">Problems of the course</caption>
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Where</th>
              <th scope="col">What</th>
            </tr>
          </thead>
          <tbody>
            {report.problems.map((p, i) => (
              <tr key={i}>
                <td>
                  <code>{p.code}</code>
                </td>
                <td>
                  <code>{p.path || '(course)'}</code>
                </td>
                <td>{p.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function LintResult({ report }: { report: NonNullable<CourseDoc['lint']> }) {
  return (
    <section aria-labelledby="lint-result" data-testid="lint-result">
      <h2 id="lint-result" className="sub-title">
        Lint
      </h2>
      <p data-testid="lint-summary">
        <Pill tone={report.ok ? 'good' : 'bad'}>{report.ok ? 'passes' : 'fails'}</Pill> {report.errors} {report.errors === 1 ? 'error' : 'errors'}, {report.warnings} {report.warnings === 1 ? 'warning' : 'warnings'}, checked {when(report.at)}
        {report.built ? ' (the game was built first)' : ''}.
        {report.stale && ' The course changed since this build.'}
      </p>
      {report.problems.length === 0 ? (
        <p className="inline-ok">Nothing to fix.</p>
      ) : (
        <table className="problems" data-testid="lint-problems">
          <caption className="sr-only">Problems the lint found</caption>
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Level</th>
              <th scope="col">Where</th>
              <th scope="col">What</th>
            </tr>
          </thead>
          <tbody>
            {report.problems.map((p, i) => (
              <tr key={i} data-severity={p.severity}>
                <td>
                  <code>{p.code}</code>
                </td>
                <td>
                  <Pill tone={p.severity === 'error' ? 'bad' : 'warn'}>{p.severity}</Pill>
                </td>
                <td>
                  <code>{p.path || '(course)'}</code>
                </td>
                <td>{p.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
