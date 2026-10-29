import type { Stage } from '../lib/course'

const MARK = { done: '✓', partial: '…', todo: '' } as const
const WORD = { done: 'done', partial: 'in progress', todo: 'not started' } as const

/**
 * The pipeline of a course as numbered stages (it is a real sequence). A stage that is done has a tick, one in progress an ellipsis, and the
 * state is also written for screen readers, so the colour is never the only sign.
 */
export function StageStrip({ stages, testId, compact = false }: { stages: Stage[]; testId: string; compact?: boolean }) {
  return (
    <ol className={compact ? 'stages compact' : 'stages'} data-testid={testId} aria-label="Pipeline stages">
      {stages.map((s, i) => (
        <li key={s.id} className="stage" data-state={s.state} title={s.detail} data-testid={`${testId}-${s.id}`}>
          <span className="stage-n" aria-hidden="true">
            {s.state === 'done' ? MARK.done : i + 1}
          </span>
          <span className="stage-label">{s.label}</span>
          <span className="sr-only">
            {WORD[s.state]}: {s.detail}
          </span>
        </li>
      ))}
    </ol>
  )
}
