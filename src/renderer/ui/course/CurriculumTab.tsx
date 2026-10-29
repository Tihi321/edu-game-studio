import { useMemo, useState, type KeyboardEvent } from 'react'
import { formOf } from '../../../shared/edu'
import type { CourseLoadedView } from '../../../shared/protocol'
import { layoutUnits } from '../../lib/graph'
import { resolverFor } from '../../lib/course'
import { useCurriculumNotes } from '../../store/pipeline-hooks'
import { Coming, Pill } from '../common'

const NODE_W = 200
const NODE_H = 76

const BLOOM_NOTE: Record<string, string> = {
  remember: 'recall facts',
  understand: 'explain ideas',
  apply: 'use it in a new case',
  analyze: 'compare and break down',
  evaluate: 'judge and justify',
  create: 'make something new'
}

/** Units, the prerequisite graph as an SVG, and the objectives of each unit with their Bloom level and how they are asked. */
export function CurriculumTab({ slug, data }: { slug: string; data: CourseLoadedView }) {
  const { pack } = data
  const text = resolverFor(data)
  const notes = useCurriculumNotes(slug)
  const layout = useMemo(() => layoutUnits(pack.units, { nodeW: NODE_W, nodeH: NODE_H }), [pack.units])
  const [unitId, setUnitId] = useState<string | null>(null)
  const title = (id: string): string => text.t(pack.units.find((u) => u.id === id)?.title ?? id)
  const pick = (id: string) => setUnitId((cur) => (cur === id ? null : id))
  const onKey = (e: KeyboardEvent, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      pick(id)
    }
  }
  const shown = unitId ? pack.units.filter((u) => u.id === unitId) : pack.units
  const requiresText = (id: string): string => {
    const u = pack.units.find((x) => x.id === id)
    return u && u.requires.length > 0 ? `Needs ${u.requires.map(title).join(' and ')}` : 'Starts here, no prerequisite'
  }
  return (
    <div className="tab-body" data-testid="tab-curriculum">
      <section aria-labelledby="cur-graph">
        <h2 id="cur-graph" className="sub-title">
          Prerequisites between units
        </h2>
        <p className="dim">A unit opens in the game when the units it needs are mastered. Choose a unit to see only its objectives.</p>
        {layout.cycle && (
          <p className="inline-error" role="alert" data-testid="graph-cycle">
            The units need each other in a circle ({layout.cycle.join(' to ')}), so the game cannot open them. The lint reports this as PREREQ_CYCLE.
          </p>
        )}
        {layout.unknown.length > 0 && (
          <p className="inline-error" role="alert" data-testid="graph-unknown">
            A unit needs {layout.unknown.join(', ')}, which {layout.unknown.length === 1 ? 'is' : 'are'} not unit ids of this course.
          </p>
        )}
        <div className="graph-wrap">
          <svg className="graph" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} role="group" aria-label="Prerequisite graph of the units" data-testid="unit-graph">
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" className="graph-arrow" />
              </marker>
            </defs>
            {layout.edges.map((e) => (
              <path key={`${e.from}>${e.to}`} d={e.path} className="graph-edge" markerEnd="url(#arrow)" data-testid={`edge-${e.from}-${e.to}`} />
            ))}
            {layout.nodes.map((n) => {
              const selected = unitId === n.id
              const lines = wrap(title(n.id), 24)
              const counts = `${pack.objectives.filter((o) => o.unit === n.id).length} objectives, ${pack.items.filter((i) => pack.objectives.find((o) => o.id === i.objective)?.unit === n.id).length} items`
              return (
                <g
                  key={n.id}
                  transform={`translate(${n.x} ${n.y})`}
                  className={selected ? 'graph-node on' : 'graph-node'}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  aria-describedby={`unit-desc-${n.id}`}
                  onClick={() => pick(n.id)}
                  onKeyDown={(e) => onKey(e, n.id)}
                  data-testid={`unit-node-${n.id}`}
                >
                  <desc id={`unit-desc-${n.id}`}>{requiresText(n.id)}</desc>
                  <rect width={NODE_W} height={NODE_H} rx={4} />
                  <text x={12} y={22} className="graph-title">
                    {lines.map((l, i) => (
                      <tspan key={i} x={12} dy={i === 0 ? 0 : 18}>
                        {l}
                      </tspan>
                    ))}
                  </text>
                  <text x={12} y={NODE_H - 10} className="graph-sub">
                    {counts}
                  </text>
                </g>
              )
            })}
          </svg>
        </div>
      </section>

      <section aria-labelledby="cur-units">
        <h2 id="cur-units" className="sub-title">
          Units and objectives
        </h2>
        <ol className="units" data-testid="unit-list">
          {shown.map((u) => {
            const objectives = pack.objectives.filter((o) => o.unit === u.id)
            return (
              <li key={u.id} className="unit" data-testid={`unit-${u.id}`}>
                <h3>{text.t(u.title)}</h3>
                {u.summary && <p className="dim">{text.t(u.summary)}</p>}
                <p className="unit-req">{requiresText(u.id)}</p>
                {objectives.length === 0 && <p className="inline-error">This unit has no objective, so no item can be asked for it.</p>}
                <ul className="objectives">
                  {objectives.map((o) => {
                    const items = pack.items.filter((i) => i.objective === o.id)
                    const forms = new Set(items.map((i) => formOf(i))).size
                    return (
                      <li key={o.id} data-testid={`objective-${o.id}`}>
                        <span className="obj-text">{text.t(o.text)}</span>
                        <span className="obj-meta">
                          <Pill tone="accent" title={BLOOM_NOTE[o.bloom]}>
                            {o.bloom}
                          </Pill>
                          <Pill tone={forms >= 2 ? 'good' : 'warn'} title="The lint wants every objective asked in two or more forms">
                            {items.length} {items.length === 1 ? 'item' : 'items'}, {forms} {forms === 1 ? 'form' : 'forms'}
                          </Pill>
                          {o.facts.length > 0 && <Pill tone="dim">{o.facts.length} {o.facts.length === 1 ? 'source' : 'sources'}</Pill>}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </li>
            )
          })}
        </ol>
      </section>

      <section aria-labelledby="cur-notes">
        <h2 id="cur-notes" className="sub-title">
          Why the units are in this order
        </h2>
        {notes.available ? (
          <ul className="plain" data-testid="curriculum-notes">
            {notes.data.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        ) : (
          <Coming ticket={notes.ticket} testId="curriculum-coming">
            <p>The curriculum designer will leave its reasoning here: why these objectives, why this order, which Bloom level each one aims at. Nothing was recorded for this course.</p>
          </Coming>
        )}
      </section>
    </div>
  )
}

/** Breaks a title into lines of at most `n` characters at spaces; at most two lines (the rest stays on the second). */
function wrap(s: string, n: number): string[] {
  const words = s.split(/\s+/)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if (cur && `${cur} ${w}`.length > n && lines.length === 0) {
      lines.push(cur)
      cur = w
    } else cur = cur ? `${cur} ${w}` : w
  }
  lines.push(cur)
  return lines
}
