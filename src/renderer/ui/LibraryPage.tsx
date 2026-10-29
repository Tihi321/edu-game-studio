import { useEffect } from 'react'
import { loadCourse, sendCommand } from '../api'
import { courseTheme, courseTitle, langName, pipelineStages } from '../lib/course'
import { mcpSnippets } from '../lib/mcp'
import { useEdu } from '../store/hooks'
import { eduStore } from '../store/store'
import { CopyLine, Empty, ErrorBox, Loading } from './common'
import { StageStrip } from './StageStrip'
import type { CSSProperties } from 'react'

/** The Library: every course of the data folder as a card with a cover painted in the look of its game. */
export function LibraryPage() {
  const connected = useEdu((s) => s.connected)
  const dataDir = useEdu((s) => s.dataDir)
  const courses = useEdu((s) => s.courses)
  const loaded = useEdu((s) => s.coursesLoaded)
  const paused = useEdu((s) => s.paused)
  const mcp = useEdu((s) => s.mcp)
  const docs = useEdu((s) => s.docs)
  const playtests = useEdu((s) => s.playtests)

  useEffect(() => {
    if (connected) sendCommand({ type: 'listCourses' })
  }, [connected])
  // ask for the files of every listed course once (the cards show counts, languages and the pipeline from them)
  const slugs = courses.map((c) => c.slug).join(',')
  useEffect(() => {
    for (const c of eduStore.getState().courses) {
      const doc = eduStore.getState().docs[c.slug]
      if (!doc?.data && !doc?.loading && !doc?.error) loadCourse(c.slug)
    }
  }, [slugs])

  return (
    <div className="page-body" data-testid="page-courses">
      <header className="page-head">
        <h1>Library</h1>
        <div className="head-actions">
          <button onClick={() => sendCommand({ type: 'listCourses' })} disabled={!connected} data-testid="library-refresh">
            Refresh the list
          </button>
        </div>
      </header>
      <p className="lede dim" data-testid="courses-status">
        {connected ? `The engine is running${paused ? ' (queue paused)' : ''}. Courses live in ${dataDir || 'the data folder'}.` : 'The engine is not connected yet.'}
      </p>
      <p className="dim" data-testid="courses-mcp">
        {mcp?.listening ? `MCP server listening at ${mcp.url}` : 'The MCP server is not listening (Settings, MCP server).'}
      </p>

      {!connected && !loaded && <ErrorBox title="The engine is not connected" message="The studio shows courses from the engine. Start the app with yarn dev, or the engine alone with yarn engine, and this page fills in." testId="library-offline" />}
      {connected && !loaded && <Loading label="Reading the courses" testId="library-loading" />}
      {loaded && courses.length === 0 && <LibraryEmpty url={mcp?.url ?? null} tokenSet={!!mcp?.tokenSet} />}

      {courses.length > 0 && (
        <ul className="course-grid" data-testid="course-list">
          {courses.map((c) => {
            const doc = docs[c.slug]
            const data = doc?.data
            const theme = data ? courseTheme(data.pack) : undefined
            const title = data ? courseTitle(data) : c.title
            const stages = pipelineStages(data, doc, playtests[c.slug]?.length ?? 0)
            return (
              <li key={c.slug} className="course-card">
                <div className="cover" data-theme={theme?.id ?? 'none'} style={theme ? coverStyle(theme) : undefined} data-testid={`cover-${c.slug}`}>
                  <h2 className="cover-title">
                    <button className="card-open" onClick={() => eduStore.getState().showCourse(c.slug)} data-testid={`course-${c.slug}`}>
                      {title}
                    </button>
                  </h2>
                  <span className="cover-chips" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  {theme && <span className="cover-theme">{theme.label} look</span>}
                </div>
                <div className="card-body">
                    {data ? (
                      <>
                        <span className="card-line">
                          {data.pack.languages.map((l) => (
                            <span key={l} className="pill dim" title={langName(l)}>
                              {l}
                            </span>
                          ))}
                          {data.pack.targetLang && <span className="pill accent">teaches {langName(data.pack.targetLang)}</span>}
                        </span>
                        <span className="card-line card-counts" data-testid={`counts-${c.slug}`}>
                          {data.stats.units} {data.stats.units === 1 ? 'unit' : 'units'}, {data.stats.items} {data.stats.items === 1 ? 'item' : 'items'}
                        </span>
                        <StageStrip stages={stages} testId={`stages-${c.slug}`} compact />
                      </>
                    ) : doc?.error ? (
                      <span className="card-line bad-text" data-testid={`course-error-${c.slug}`}>
                        {doc.error}
                      </span>
                    ) : (
                      <span className="card-line dim" data-testid={`course-loading-${c.slug}`}>
                        Reading the course files...
                      </span>
                    )}
                    <span className="card-line dim card-date">Changed {new Date(c.updatedAt).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' })}</span>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function coverStyle(t: { swatch: { bg: string; surface: string; text: string; accent: string; accent2: string }; display: string; body: string }): CSSProperties {
  return {
    '--cv-bg': t.swatch.bg,
    '--cv-surface': t.swatch.surface,
    '--cv-text': t.swatch.text,
    '--cv-accent': t.swatch.accent,
    '--cv-accent-2': t.swatch.accent2,
    '--cv-display': t.display,
    '--cv-body': t.body
  } as CSSProperties
}

/** No course yet: how to make one (MCP or the CLI) and what comes. */
function LibraryEmpty({ url, tokenSet }: { url: string | null; tokenSet: boolean }) {
  const snip = mcpSnippets(url ?? 'http://127.0.0.1:7463/mcp', tokenSet)
  return (
    <Empty title="No courses yet" testId="courses-empty">
      <p>A course is a folder in the data folder. Two ways to start one:</p>
      <h3>Ask Claude Code to write it</h3>
      <p>Connect Claude Code to the studio once, then describe the course. It calls <code>edu_create_course</code> and the item tools, and the course appears here.</p>
      <CopyLine text={snip.http} label="connect Claude Code to the MCP server" testId="empty-mcp" />
      <h3>Import a course folder</h3>
      <p>A folder with <code>course/pack.json</code> and a text catalog per language, such as the golden fixtures in the repository:</p>
      <CopyLine text="yarn engine -- import-course tests/fixtures/courses/solar-system" label="import the solar-system fixture" testId="empty-import" />
      <p className="dim">Or call the MCP tool <code>edu_import_course</code> with the folder path. The writing pipeline that starts from a topic arrives with EGS-06 to EGS-08.</p>
    </Empty>
  )
}
