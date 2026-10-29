import { useEffect } from 'react'
import { sendCommand } from '../api'
import { useEdu } from '../store/hooks'

/**
 * The skeleton's home page: the engine state and the courses found in the data folder. EGS-05 replaces it with the Library and the
 * Course pages (Brief, Curriculum, Encyclopedia, Items, Game, Assets, Voice, Editions, Build, Playtest).
 */
export function CoursesPage() {
  const connected = useEdu((s) => s.connected)
  const dataDir = useEdu((s) => s.dataDir)
  const courses = useEdu((s) => s.courses)
  const loaded = useEdu((s) => s.coursesLoaded)
  const paused = useEdu((s) => s.paused)
  const mcp = useEdu((s) => s.mcp)

  useEffect(() => {
    if (connected) sendCommand({ type: 'listCourses' })
  }, [connected])

  return (
    <div className="stack" style={{ maxWidth: 720 }} data-testid="page-courses">
      <div className="panel-title">Courses</div>
      <div className="dim" data-testid="courses-status">
        {connected ? `Engine running${paused ? ' (queue paused)' : ''}. Data folder: ${dataDir}` : 'The engine is not connected yet.'}
      </div>
      <div className="dim" data-testid="courses-mcp">
        {mcp?.listening ? `MCP server listening at ${mcp.url}` : 'MCP server is not listening (Settings > MCP).'}
      </div>
      {loaded && courses.length === 0 && (
        <div className="card" data-testid="courses-empty">
          No courses yet. The course store, the player and the content pipeline arrive in the next tickets (see ROADMAP.md).
        </div>
      )}
      {courses.map((c) => (
        <div key={c.slug} className="card row spread" data-testid={`course-${c.slug}`}>
          <b>{c.title}</b>
          <span className="dim">{c.updatedAt}</span>
        </div>
      ))}
    </div>
  )
}
