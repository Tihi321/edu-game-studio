import { useEffect, useRef } from 'react'
import { useEdu } from './store/hooks'
import { PAGES, eduStore } from './store/store'
import { AgentsPage } from './ui/AgentsPage'
import { CoursePage } from './ui/course/CoursePage'
import { GeneratorsPage } from './ui/GeneratorsPage'
import { LibraryPage } from './ui/LibraryPage'
import { ModelsPage } from './ui/ModelsPage'
import { SettingsPage } from './ui/SettingsPage'

/**
 * The shell: a left rail (the margin of the exercise book, with the red rule beside it) with the nav and the engine state, and the page.
 * The first thing in the tab order is the skip link. Moving to another page moves the focus to the page, so a keyboard or screen-reader user
 * starts at its top.
 */
export function App() {
  const page = useEdu((s) => s.page)
  const openCourse = useEdu((s) => s.openCourse)
  const connected = useEdu((s) => s.connected)
  const warnings = useEdu((s) => s.warnings)
  const spend = useEdu((s) => s.spend)
  const main = useRef<HTMLElement>(null)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    main.current?.focus({ preventScroll: true })
    main.current?.scrollTo?.(0, 0)
  }, [page, openCourse])
  const warning = warnings[warnings.length - 1]
  return (
    <div className="app">
      <a
        className="skip-link"
        href="#main"
        data-testid="skip-link"
        onClick={(e) => {
          e.preventDefault()
          main.current?.focus()
        }}
      >
        Skip to the page
      </a>
      <aside className="rail">
        <div className="brand" data-testid="brand">
          <span className="brand-name">Edu Studio</span>
          <span className="brand-sub">turns a topic into a game</span>
        </div>
        <nav aria-label="Studio">
          <ul className="nav">
            {PAGES.map((p) => (
              <li key={p.id}>
                <button
                  className={page === p.id ? 'nav-item on' : 'nav-item'}
                  aria-current={page === p.id ? 'page' : undefined}
                  onClick={() => eduStore.getState().setPage(p.id)}
                  data-testid={`nav-${p.id}`}
                >
                  {p.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="rail-foot" data-testid="engine-status">
          <span className={connected ? 'dot on' : 'dot'} aria-hidden="true" />
          <span>
            {connected ? 'Engine connected' : 'Engine not connected'}
            {connected && <span className="dim rail-spend"> Spent today ${spend.today.toFixed(2)}</span>}
          </span>
        </div>
      </aside>
      <div className="main-col">
        {warning && (
          <div className="warnbar" role="status" data-testid="warnbar">
            {warning}
            {warnings.length > 1 && <span className="dim"> ({warnings.length - 1} earlier)</span>}
          </div>
        )}
        <main id="main" ref={main} tabIndex={-1} className="page">
          {page === 'courses' && (openCourse ? <CoursePage slug={openCourse} key={openCourse} /> : <LibraryPage />)}
          {page === 'models' && <ModelsPage />}
          {page === 'agents' && <AgentsPage />}
          {page === 'generators' && <GeneratorsPage />}
          {page === 'settings' && <SettingsPage />}
        </main>
      </div>
    </div>
  )
}
