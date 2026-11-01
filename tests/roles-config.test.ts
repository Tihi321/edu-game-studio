import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { render } from '../src/engine/pipeline/prompts'
import { parseMd, parseMdWith } from '../src/shared/md'
import { agentSchema, AUTHORED_ITEM_KINDS, formatsSchema, ROLES, rolesSchema } from '../src/shared/schemas'
import { writeMd } from '../src/engine/store/atomic'
import { makeEnv, seedDir } from './helpers'

const seed = (...p: string[]) => fs.readFileSync(path.join(seedDir, ...p), 'utf8')

describe('the roles', () => {

  it('config/roles.md lists every role with a model list: writers and designers paid first, checkers and the researcher local first', () => {
    const roles = parseMdWith(seed('config', 'roles.md'), rolesSchema).data.roles
    expect(Object.keys(roles).sort()).toEqual([...ROLES].sort())
    for (const role of ROLES) expect(roles[role]!.models.length, role).toBeGreaterThanOrEqual(3)
    for (const role of ['director', 'curriculum-designer', 'subject-expert', 'item-writer', 'misconception-designer', 'explainer', 'language-coach', 'game-designer', 'narrative-designer', 'publisher']) expect(roles[role]!.models, role).toEqual(['paid', 'strata', 'lmstudio'])
    for (const role of ['researcher', 'fact-checker']) expect(roles[role]!.models, role).toEqual(['strata/qwen3.8-flash-next-low', 'lmstudio', 'paid'])
    for (const role of ['accessibility-reviewer', 'child-safety-reviewer', 'playtester']) expect(roles[role]!.models, role).toEqual(['strata', 'lmstudio', 'paid'])
    expect(roles['art-director']!.models).toEqual(['paid', 'strata', 'lmstudio'])
    expect(roles.composer!.models).toEqual(['paid', 'strata', 'lmstudio'])
    expect(roles['voice-director']!.models).toEqual(['paid', 'strata', 'lmstudio'])
    expect(roles.translator!.models).toEqual(['paid', 'strata', 'lmstudio'])
    expect(roles['art-critic']!.models).toEqual(['gemini/gemini-2.5-flash', 'anthropic/claude-sonnet-4-5', 'lmstudio']) // vision models first: the critic sends images
    for (const role of ROLES) expect(parseMd(seed('config', 'roles.md')).body, role).toContain(`\`${role}\``) // every role is described
  })

  it('the seeded staff: two researchers and a fact-checker besides the director, every agent file valid and of a known role', () => {
    const dir = path.join(seedDir, 'agents')
    const agents = fs.readdirSync(dir).map((f) => ({ f, doc: parseMdWith(fs.readFileSync(path.join(dir, f), 'utf8'), agentSchema) }))
    expect(agents.filter((a) => a.doc.data.role === 'researcher')).toHaveLength(2)
    expect(agents.filter((a) => a.doc.data.role === 'fact-checker')).toHaveLength(1)
    for (const a of agents) {
      expect(ROLES as readonly string[], a.f).toContain(a.doc.data.role)
      expect(a.f.startsWith(`${a.doc.data.role}-`), a.f).toBe(true)
      expect(a.doc.body.trim().length, a.f).toBeGreaterThan(40)
    }
  })
})

describe('the seeded quality, formats and search providers', () => {

  it('formats.md: quick (2 units), standard (4), deep (6) and language-a1, -a2, -b1, -b2, with the item kinds the pipeline can author', () => {
    const f = parseMdWith(seed('config', 'formats.md'), formatsSchema).data.formats
    expect(f.map((x) => [x.id, x.units])).toEqual([['quick', 2], ['standard', 4], ['deep', 6], ['language-a1', 4], ['language-a2', 5], ['language-b1', 6], ['language-b2', 6]])
    for (const x of f) {
      // `conjugation` is listed by the language formats before it is an authored kind (EGS-27); resolveBrief leaves it out until then
      expect(x.item_kinds.every((k) => k === 'conjugation' || (AUTHORED_ITEM_KINDS as readonly string[]).includes(k)), x.id).toBe(true)
      expect(x.items_per_objective, x.id).toBeGreaterThanOrEqual(2)
      expect(x).toHaveProperty('articles_per_unit')
      expect(x).toHaveProperty('research_questions_per_unit')
      expect(x).toHaveProperty('objectives_per_unit')
    }
    expect(f.find((x) => x.id === 'language-a1')).toMatchObject({ language: true, cefr: 'A1', verb_units: 1, verbs_per_unit: 6 })
    expect(f.find((x) => x.id === 'language-a2')).toMatchObject({ language: true, cefr: 'A2', verb_units: 2, items_per_objective: 4 })
    expect(f.find((x) => x.id === 'language-b1')).toMatchObject({ language: true, cefr: 'B1', verb_units: 2, articles_per_unit: 2 })
    expect(f.find((x) => x.id === 'language-b1')).toMatchObject({ reading: true, reading_words: [200, 400], glossary_per_text: [6, 12] })
    expect(f.find((x) => x.id === 'language-b2')).toMatchObject({ language: true, cefr: 'B2', units: 6, objectives_per_unit: 3, items_per_objective: 5, articles_per_unit: 2, research_questions_per_unit: 2, verb_units: 1, reading: true, reading_words: [350, 700], glossary_per_text: [10, 20] })
    expect(f.find((x) => x.id === 'quick')).toMatchObject({ verb_units: 0, reading: false })
    expect(formatsSchema.safeParse({ kind: 'formats', formats: [{ id: 'Bad Id', label: 'x', units: 1 }] }).success).toBe(false)
    expect(formatsSchema.safeParse({ kind: 'formats', formats: [{ id: 'ok', label: 'x', units: 0 }] }).success).toBe(false)
  })
})

describe('the seeded prompts', () => {
  const VARS: Record<string, string[]> = {
    'researcher/check_notes': ['question', 'notes'],
    'researcher/write_notes': ['question', 'context', 'pages'],
    'researcher/search_queries': ['question', 'tried'],
    'researcher/from_knowledge': ['question', 'context'],
    'fact-checker/fact_check': ['title', 'round', 'factbase', 'sources', 'language_rules', 'coverage', 'content', 'scores_example']
  }

  it('every variable a handler passes is used by its template, and every {{var}} of a template is passed', () => {
    for (const [key, vars] of Object.entries(VARS)) {
      const file = path.join(seedDir, 'prompts', ...key.split('/')) + '.md'
      const body = parseMd(fs.readFileSync(file, 'utf8')).body
      const used = new Set([...body.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map((m) => m[1]!))
      expect([...used].sort(), key).toEqual([...vars].sort())
      const out = render(body, Object.fromEntries(vars.map((v) => [v, `<${v}>`])))
      for (const v of vars) expect(out, `${key} ${v}`).toContain(`<${v}>`)
      expect(out, key).not.toMatch(/\{\{/)
      const meta = parseMd(fs.readFileSync(file, 'utf8')).data
      expect(meta, key).toMatchObject({ kind: 'prompt', role: key.split('/')[0], task: key.split('/')[1] })
    }
  })
})

describe('quality and formats in the engine', () => {
  it('the engine loads both at start and reloads them when the files change; an invalid file keeps what was loaded', async () => {
    const env = await makeEnv()
    try {
      const e = env.engine
      expect(e.getQuality()).toMatchObject({ threshold: 7, max_rounds: 2, must_pass: ['fact-checker', 'accessibility-reviewer', 'child-safety-reviewer'] })
      expect(e.getFormats().map((f) => f.id)).toEqual(['quick', 'standard', 'deep', 'language-a1', 'language-a2', 'language-b1', 'language-b2'])
      expect(e.edu.deps.getQuality()).toBe(e.getQuality())
      expect(e.edu.deps.getFormats()).toEqual(e.getFormats())
      const file = path.join(env.dir, 'config', 'quality.md')
      await writeMd(file, { kind: 'quality', threshold: 8.5, max_rounds: 1, must_pass: ['fact-checker'], weights: { accuracy: 3 } }, 'mine\n')
      await e.handleWatch({ kind: 'config', change: 'change', path: file, rel: 'config/quality.md' })
      expect(e.getQuality()).toMatchObject({ threshold: 8.5, max_rounds: 1, must_pass: ['fact-checker'], weights: { accuracy: 3 } })
      const formats = path.join(env.dir, 'config', 'formats.md')
      await writeMd(formats, { kind: 'formats', formats: [{ id: 'mini', label: 'Mini', units: 1 }, { id: 'off', label: 'Off', units: 3, enabled: false }] }, 'mine\n')
      await e.handleWatch({ kind: 'config', change: 'change', path: formats, rel: 'config/formats.md' })
      expect(e.getFormats()).toEqual([expect.objectContaining({ id: 'mini', units: 1, objectives_per_unit: 3, items_per_objective: 3, articles_per_unit: 1, research_questions_per_unit: 2 })]) // defaults filled, a disabled format hidden
      // a broken file: the previous version stays, and the log says why
      await writeMd(file, { kind: 'quality', threshold: 99 }, 'bad\n')
      await e.handleWatch({ kind: 'config', change: 'change', path: file, rel: 'config/quality.md' })
      expect(e.getQuality().threshold).toBe(8.5)
      expect(env.logs.some((l) => /quality\.md/.test(l))).toBe(true)
    } finally {
      await env.cleanup()
    }
  })
})
