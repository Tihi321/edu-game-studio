import { useEffect, useState, type ReactNode } from 'react'
import { pickFile, pickFolder } from '../api'
import type { PickKind } from '../hostApi'
import { useEdu } from '../store/hooks'

export type Tone = 'good' | 'bad' | 'warn' | 'dim' | 'accent'

export function Pill({ tone = 'dim', children, title, testId }: { tone?: Tone; children: ReactNode; title?: string; testId?: string }) {
  return (
    <span className={`pill ${tone}`} title={title} data-testid={testId}>
      {children}
    </span>
  )
}

export function Modal({ title, onClose, children, width = 560 }: { title: string; onClose(): void; children: ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal card" style={{ width }} role="dialog" aria-label={title}>
        <div className="row spread">
          <div className="panel-title">{title}</div>
          <button onClick={onClose} aria-label="Close">
            x
          </button>
        </div>
        <div className="stack" style={{ marginTop: 8 }}>
          {children}
        </div>
      </div>
    </div>
  )
}

/** A path text box with a Browse button (the desktop app's picker); typing a path works too. */
export function PathField({
  value,
  onChange,
  mode,
  kind = 'any',
  placeholder,
  testId
}: {
  value: string
  onChange(v: string): void
  mode: 'folder' | 'file'
  kind?: PickKind
  placeholder?: string
  testId?: string
}) {
  const canPick = typeof window !== 'undefined' && !!window.edustudio?.pickFolder
  return (
    <div className="row" style={{ flexWrap: 'nowrap' }}>
      <input style={{ flex: 1, minWidth: 0 }} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} data-testid={testId} />
      <button
        disabled={!canPick}
        title={canPick ? undefined : 'Only in the desktop app'}
        onClick={() => void (mode === 'folder' ? pickFolder('Choose a folder') : pickFile('Choose a file', kind)).then((p) => p && onChange(p))}
      >
        Browse...
      </button>
    </div>
  )
}

/** The newest error the engine reported for this course (or any command when no slug), if it is recent. */
export function useRecentError(slug: string | null, command?: string): string | null {
  const errors = useEdu((s) => s.errors)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(t)
  }, [])
  const last = [...errors].reverse().find((e) => (slug === null || e.slug === slug || !e.slug) && (!command || e.command === command))
  return last && now - last.at < 30000 ? `${last.command}: ${last.message}` : null
}

export function ProgressBar({ fraction }: { fraction: number | null }) {
  return (
    <div className="bar">
      <div className={fraction === null ? 'bar-fill busy' : 'bar-fill'} style={fraction === null ? undefined : { width: `${Math.round(fraction * 100)}%` }} />
    </div>
  )
}
