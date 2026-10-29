import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { formOf } from '../../../shared/edu'
import type { CourseLoadedView } from '../../../shared/protocol'
import { kindCounts } from '../../lib/items'
import { resolverFor, unitOf } from '../../lib/course'
import type { CourseDoc } from '../../store/course'
import { Empty, Field, Modal } from '../common'
import { ItemEditor } from './ItemEditor'

/** The items of a course: a filterable list on the left, the editor and the live preview of the chosen item on the right. */
export function ItemsTab({ slug, data, doc }: { slug: string; data: CourseLoadedView; doc: CourseDoc }) {
  const { pack } = data
  const text = resolverFor(data)
  const [kind, setKind] = useState('')
  const [unit, setUnit] = useState('')
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  /** The item the user asked for while the open one has unsaved changes: a dialog asks what to do. */
  const [asked, setAsked] = useState<string | null>(null)
  const onDirty = useCallback((d: boolean) => setDirty(d), [])
  const choose = (id: string) => (dirty && id !== picked ? setAsked(id) : setPicked(id))
  const list = useRef<HTMLUListElement>(null)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const t = resolverFor({ pack, text: data.text })
    return pack.items.filter((i) => {
      if (kind && i.kind !== kind) return false
      if (unit && unitOf(pack, i) !== unit) return false
      if (q && !i.id.toLowerCase().includes(q) && !t.t(i.prompt).toLowerCase().includes(q)) return false
      return true
    })
  }, [pack, kind, unit, query, data.text])

  if (pack.items.length === 0) {
    return (
      <Empty title="This course has no items yet" testId="items-empty">
        <p>Items are the questions of the game. Add them with the MCP tool <code>edu_item_add</code> (any of the 13 kinds), and ask each fact in two or more forms. They appear here and can then be edited and previewed.</p>
      </Empty>
    )
  }
  const item = pack.items.find((i) => i.id === picked) ?? null
  const onKey = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('button.item-row') ?? [])]
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (i < 0) return
    e.preventDefault()
    buttons[Math.max(0, Math.min(buttons.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus()
  }

  return (
    <div className="items-layout" data-testid="items-tab">
      <div className="items-list">
        <h2 className="sub-title">Items</h2>
        <div className="filters" role="search" aria-label="Filter the items">
          <Field label="Kind">
            {(id) => (
              <select id={id} value={kind} onChange={(e) => setKind(e.target.value)} data-testid="items-filter-kind">
                <option value="">All kinds ({pack.items.length})</option>
                {kindCounts(pack).map((k) => (
                  <option key={k.kind} value={k.kind}>
                    {k.form} ({k.count})
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Unit">
            {(id) => (
              <select id={id} value={unit} onChange={(e) => setUnit(e.target.value)} data-testid="items-filter-unit">
                <option value="">All units</option>
                {pack.units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {text.t(u.title)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Search">
            {(id) => <input id={id} type="search" value={query} placeholder="Id or question" onChange={(e) => setQuery(e.target.value)} data-testid="items-filter-search" />}
          </Field>
        </div>
        <p className="dim" role="status" data-testid="items-count">
          {rows.length} of {pack.items.length} items
        </p>
        <ul className="item-rows" ref={list} onKeyDown={onKey} data-testid="item-list">
          {rows.map((i) => (
            <li key={i.id}>
              <button className={i.id === picked ? 'item-row on' : 'item-row'} aria-current={i.id === picked ? 'true' : undefined} onClick={() => choose(i.id)} data-testid={`item-row-${i.id}`}>
                <span className="item-row-prompt">{text.t(i.prompt)}</span>
                <span className="item-row-meta">
                  <span className="pill accent">{formOf(i)}</span>
                  <code>{i.id}</code>
                </span>
              </button>
            </li>
          ))}
          {rows.length === 0 && (
            <li className="dim" data-testid="items-none">
              No item matches the filters.
            </li>
          )}
        </ul>
      </div>
      <div className="items-editor">
        {item ? (
          <ItemEditor slug={slug} data={data} doc={doc} item={item} onDirtyChange={onDirty} />
        ) : (
          <Empty title="Pick an item" testId="items-pick">
            <p>Choose an item on the left to edit its texts and answer key and to play it in the preview, in the look of the game.</p>
          </Empty>
        )}
      </div>
      {asked && (
        <Modal title="This item has unsaved changes" onClose={() => setAsked(null)} testId="unsaved-dialog" width={460}>
          <p>Your edits to “{picked ? text.t(pack.items.find((i) => i.id === picked)?.prompt ?? picked) : ''}” are not saved. Save them first with the Save item button, or discard them to open the other item.</p>
          <div className="row">
            <button className="primary" data-autofocus onClick={() => setAsked(null)} data-testid="unsaved-keep">
              Keep editing
            </button>
            <button
              onClick={() => {
                setPicked(asked)
                setAsked(null)
              }}
              data-testid="unsaved-discard"
            >
              Discard and open the other item
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
