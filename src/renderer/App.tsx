import { useEdu } from './store/hooks'
import { PAGES, eduStore } from './store/store'
import { AgentsPage } from './ui/AgentsPage'
import { CoursesPage } from './ui/CoursesPage'
import { ModelsPage } from './ui/ModelsPage'
import { SettingsPage } from './ui/SettingsPage'

export function App() {
  const page = useEdu((s) => s.page)
  const connected = useEdu((s) => s.connected)
  const warning = useEdu((s) => s.warnings[s.warnings.length - 1])
  const spend = useEdu((s) => s.spend)
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand" data-testid="brand">
          Edu Studio
        </span>
        <nav className="tabs row">
          {PAGES.map((p) => (
            <button key={p.id} className={page === p.id ? 'on' : ''} onClick={() => eduStore.getState().setPage(p.id)} data-testid={`nav-${p.id}`}>
              {p.label}
            </button>
          ))}
        </nav>
        <span className="dim" style={{ marginLeft: 'auto' }} data-testid="engine-status">
          {connected ? `engine connected · spend today $${spend.today.toFixed(2)}` : 'engine not connected'}
        </span>
      </header>
      {warning && <div className="warnbar">{warning}</div>}
      <main className="page">
        {page === 'courses' && <CoursesPage />}
        {page === 'models' && <ModelsPage />}
        {page === 'agents' && <AgentsPage />}
        {page === 'settings' && <SettingsPage />}
      </main>
    </div>
  )
}
