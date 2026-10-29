import { useEffect, useMemo, useState } from 'react'
import type { CourseItem } from '../../../shared/course'
import { formOf } from '../../../shared/edu'
import type { CourseLoadedView } from '../../../shared/protocol'
import { THEMES } from '../../../design/themes'
import { saveItem } from '../../api'
import { buildSave, draftCatalogs, hasEdits, itemTextFields, moved, noEdits, optionsOf, toggleIn, withField, type TextEdits, type TextField } from '../../lib/items'
import { courseTheme, resolverFor, studioLang, unitOf } from '../../lib/course'
import type { CourseDoc } from '../../store/course'
import { Field, Pill } from '../common'
import { ItemPreview } from './ItemPreview'

type Json = Record<string, unknown>
const J = (item: CourseItem): Json => item as unknown as Json

/** A value that follows `value` after `ms` (the preview redraws when typing pauses, not on every key). */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/**
 * The editor of one item: its texts (in the edition you pick), the answer key of its kind, the difficulty, and the live preview of the
 * draft. Save sends `updateItem` (a merge patch plus the changed texts, the same call as `edu_item_update`); the engine refuses a change that
 * breaks the course and says why, and the page shows it here.
 */
export function ItemEditor({ slug, data, doc, item, onDirtyChange }: { slug: string; data: CourseLoadedView; doc: CourseDoc; item: CourseItem; onDirtyChange?: (dirty: boolean) => void }) {
  const { pack, text: catalogs } = data
  const [draft, setDraft] = useState<CourseItem>(item)
  const [edits, setEdits] = useState<TextEdits>(noEdits)
  const [lang, setLang] = useState(() => studioLang(data))
  const [themeId, setThemeId] = useState<string>(() => courseTheme(pack).id)
  // a different item, or a fresh copy from the engine after a save: start from it
  const sig = JSON.stringify(item)
  useEffect(() => {
    setDraft(JSON.parse(sig) as CourseItem)
    setEdits(noEdits())
  }, [sig])

  const fields = useMemo(() => itemTextFields(draft, pack, catalogs, lang), [draft, pack, catalogs, lang])
  const plan = useMemo(() => buildSave(item, draft, edits, pack, catalogs, lang), [item, draft, edits, pack, catalogs, lang])
  const previewCatalogs = useMemo(() => draftCatalogs(catalogs, pack, lang, edits), [catalogs, pack, lang, edits])
  // the preview follows typing after a short pause; another item shows at once
  const slowItem = useDebounced(draft, 250)
  const slowTexts = useDebounced(previewCatalogs, 250)
  const previewItem = slowItem.id === draft.id ? slowItem : draft
  const previewTexts = slowItem.id === draft.id ? slowTexts : previewCatalogs
  const dirty = plan !== null || hasEdits(edits)
  useEffect(() => {
    onDirtyChange?.(dirty)
    return () => onDirtyChange?.(false)
  }, [dirty, onDirtyChange])
  const unit = unitOf(pack, item)
  const text = resolverFor(data, lang)
  const saved = doc.saved?.id === item.id ? doc.saved : undefined
  // a save came back: the texts it sent are in the catalogs now, so the draft is clean again
  const savedAt = doc.saved?.id === item.id ? doc.saved.at : undefined
  useEffect(() => {
    if (savedAt) setEdits(noEdits())
  }, [savedAt])

  const setString = (f: TextField, value: string) => setEdits((e) => ({ ...e, strings: { ...e.strings, [f.key]: value } }))
  const setAccepted = (f: TextField, value: string) => setEdits((e) => ({ ...e, accepted: { ...e.accepted, [f.key]: value } }))

  return (
    <div className="editor" data-testid="item-editor" data-item={item.id}>
      <div className="editor-head">
        <h2 className="panel-title" data-testid="editor-title">
          {text.t(item.prompt)}
        </h2>
        <div className="row">
          <code data-testid="editor-id">{item.id}</code>
          <Pill tone="accent">{formOf(item)}</Pill>
          <Pill tone="dim">{unit ? text.t(pack.units.find((u) => u.id === unit)?.title ?? unit) : 'no unit'}</Pill>
          <Pill tone="dim">objective {item.objective}</Pill>
        </div>
      <div className="row editor-actions">
        <button type="submit" form="item-form" className="primary" disabled={!dirty || doc.saving} data-testid="item-save">
          {doc.saving ? 'Saving...' : 'Save item'}
        </button>
        <button
          type="button"
          disabled={!dirty || doc.saving}
          onClick={() => {
            setDraft(item)
            setEdits(noEdits())
          }}
          data-testid="item-revert"
        >
          Discard changes
        </button>
        {dirty && !doc.saving && <span className="dim" data-testid="item-dirty">Unsaved changes</span>}
      </div>
      {doc.saveError && (
        <p className="inline-error" role="alert" data-testid="item-save-error">
          {doc.saveError}
        </p>
      )}
      {saved && !dirty && (
        <p className="inline-ok" role="status" data-testid="item-saved">
          Saved.{' '}
          {saved.pendingCount > 0 ? `${saved.pendingCount} ${saved.pendingCount === 1 ? 'thing is' : 'things are'} still unfinished around this item: ${saved.pending[0]?.message ?? ''}` : 'Nothing else is missing for this item.'}
        </p>
      )}
      </div>

      <div className="editor-grid">
        <form
          className="editor-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (plan) saveItem(slug, item.id, plan.patch, plan.text)
          }}
          id="item-form"
          aria-label="Edit the item"
        >
          <div className="row">
            <Field label="Edit texts in">
              {(id) => (
                <select id={id} value={lang} onChange={(e) => setLang(e.target.value)} data-testid="editor-lang">
                  {pack.languages.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Difficulty">
              {(id) => (
                <select id={id} value={String(J(draft).difficulty ?? 3)} onChange={(e) => setDraft(withField(draft, 'difficulty', Number(e.target.value)))} data-testid="editor-difficulty">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? 'easiest' : n === 5 ? 'hardest' : ''}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>

          <KindControls item={draft} onChange={setDraft} resolve={(k) => text.t(k)} />

          <fieldset className="texts">
            <legend>Texts in {lang}</legend>
            {fields.length === 0 && <p className="dim">This item has no texts to edit.</p>}
            {fields.map((f) => {
              const value = f.role === 'accepted' ? (edits.accepted[f.key] ?? f.value) : (edits.strings[f.key] ?? f.value)
              const touched = f.role === 'accepted' ? f.key in edits.accepted : f.key in edits.strings
              return (
                <Field key={f.key} label={f.label} hint={f.role === 'accepted' ? 'One accepted answer per line. The first is the one the game shows.' : undefined} className={touched ? 'touched' : undefined}>
                  {(id, described) => (
                    <>
                      <textarea
                        id={id}
                        aria-describedby={described}
                        rows={f.role === 'accepted' ? Math.max(2, value.split('\n').length) : value.length > 90 ? 3 : 2}
                        value={value}
                        onChange={(e) => (f.role === 'accepted' ? setAccepted(f, e.target.value) : setString(f, e.target.value))}
                        data-testid={`field-${f.key}`}
                      />
                      <span className="key" title="The key of this text in the catalog">
                        {f.key}
                      </span>
                    </>
                  )}
                </Field>
              )
            })}
          </fieldset>

        </form>

        <div className="editor-side">
          <Field label="Preview in the look of">
            {(id) => (
              <select id={id} value={themeId} onChange={(e) => setThemeId(e.target.value)} data-testid="preview-theme-select">
                {THEMES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <ItemPreview slug={slug} pack={pack} catalogs={previewTexts} item={previewItem} lang={lang} themeId={themeId} />
        </div>
      </div>
    </div>
  )
}

/** The answer key of each kind, as controls. Kinds with no key of their own (typed, cloze, flashcard ...) are edited through their texts. */
function KindControls({ item, onChange, resolve }: { item: CourseItem; onChange(i: CourseItem): void; resolve(key: string): string }) {
  const j = J(item)
  switch (item.kind) {
    case 'mcq':
    case 'listening': {
      if (item.kind === 'listening' && j.mode !== 'choose') return <p className="dim">The learner types what the clip says; the accepted answers are in the texts below.</p>
      const opts = optionsOf(item)
      return (
        <fieldset className="choice-key" data-testid="key-answer">
          <legend>Right answer</legend>
          {opts.map((o) => (
            <label key={o.id} className="inline">
              <input type="radio" name="answer" checked={j.answer === o.id} onChange={() => onChange(withField(item, 'answer', o.id))} data-testid={`key-option-${o.id}`} />
              {resolve(o.text)}
            </label>
          ))}
        </fieldset>
      )
    }
    case 'true-false':
      return (
        <fieldset className="choice-key" data-testid="key-answer">
          <legend>The statement is</legend>
          {[true, false].map((v) => (
            <label key={String(v)} className="inline">
              <input type="radio" name="tf" checked={j.answer === v} onChange={() => onChange(withField(item, 'answer', v))} data-testid={`key-${v}`} />
              {v ? 'True' : 'False'}
            </label>
          ))}
        </fieldset>
      )
    case 'multi-select': {
      const opts = optionsOf(item)
      const answers = (j.answers as string[]) ?? []
      return (
        <fieldset className="choice-key" data-testid="key-answer">
          <legend>Right answers (all that apply)</legend>
          {opts.map((o) => (
            <label key={o.id} className="inline">
              <input
                type="checkbox"
                checked={answers.includes(o.id)}
                onChange={(e) =>
                  onChange(
                    withField(
                      item,
                      'answers',
                      toggleIn(
                        answers,
                        o.id,
                        e.target.checked,
                        opts.map((x) => x.id)
                      )
                    )
                  )
                }
                data-testid={`key-option-${o.id}`}
              />
              {resolve(o.text)}
            </label>
          ))}
        </fieldset>
      )
    }
    case 'hotspot': {
      const regions = (j.regions as { id: string; label: string }[]) ?? []
      return (
        <fieldset className="choice-key" data-testid="key-answer">
          <legend>The right place on the picture</legend>
          {regions.map((r) => (
            <label key={r.id} className="inline">
              <input type="radio" name="region" checked={j.answer === r.id} onChange={() => onChange(withField(item, 'answer', r.id))} data-testid={`key-region-${r.id}`} />
              {resolve(r.label)}
            </label>
          ))}
        </fieldset>
      )
    }
    case 'order': {
      const list = (j.items as { id: string; text: string }[]) ?? []
      return (
        <fieldset className="choice-key" data-testid="key-answer">
          <legend>The right order (the player shuffles it)</legend>
          <ol className="order-key">
            {list.map((o, i) => (
              <li key={o.id}>
                <span>{resolve(o.text)}</span>
                <span className="row">
                  <button type="button" disabled={i === 0} onClick={() => onChange(withField(item, 'items', moved(list, i, -1)))} aria-label={`Move ${resolve(o.text)} earlier`} data-testid={`key-up-${o.id}`}>
                    Earlier
                  </button>
                  <button type="button" disabled={i === list.length - 1} onClick={() => onChange(withField(item, 'items', moved(list, i, 1)))} aria-label={`Move ${resolve(o.text)} later`} data-testid={`key-down-${o.id}`}>
                    Later
                  </button>
                </span>
              </li>
            ))}
          </ol>
          <label className="inline">
            <input type="checkbox" checked={j.timeline === true} onChange={(e) => onChange(withField(item, 'timeline', e.target.checked))} data-testid="key-timeline" />
            Show it as a timeline
          </label>
        </fieldset>
      )
    }
    case 'sort-groups': {
      const groups = (j.groups as { id: string; title: string }[]) ?? []
      const list = (j.items as { id: string; text: string; group: string }[]) ?? []
      return (
        <fieldset className="choice-key" data-testid="key-answer">
          <legend>Which group each card belongs to</legend>
          {list.map((o) => (
            <Field key={o.id} label={resolve(o.text)}>
              {(id) => (
                <select id={id} value={o.group} onChange={(e) => onChange(withField(item, 'items', list.map((x) => (x.id === o.id ? { ...x, group: e.target.value } : x))))} data-testid={`key-group-${o.id}`}>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {resolve(g.title)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ))}
        </fieldset>
      )
    }
    default:
      return null
  }
}
