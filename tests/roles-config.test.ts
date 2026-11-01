import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { render } from '../src/engine/pipeline/prompts'
import { KNOWN_ROLES } from '../src/renderer/ui/roles'
import { parseMd, parseMdWith } from '../src/shared/md'
import { agentSchema, AUTHORED_ITEM_KINDS, factorySchema, formatsSchema, providersSchema, qualitySchema, ROLES, rolesSchema } from '../src/shared/schemas'
import { writeMd } from '../src/engine/store/atomic'
import { initDataFolder } from '../src/engine/store/dataFolder'
import { SEED_HASHES_FILE, seedHash } from '../src/engine/store/seedRefresh'
import { makeEnv, seedDir } from './helpers'
import { GUIDE } from '../src/engine/mcp/server'

const seed = (...p: string[]) => fs.readFileSync(path.join(seedDir, ...p), 'utf8')
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))

describe('the roles', () => {
  it('ROLES is the content team plus the art roles of EGS-15, and the picker list of the renderer is that list so far', () => {
    expect([...ROLES]).toEqual([
      'director',
      'curriculum-designer',
      'researcher',
      'subject-expert',
      'item-writer',
      'misconception-designer',
      'explainer',
      'language-coach',
      'fact-checker',
      'game-designer',
      'narrative-designer',
      'art-director',
      'art-critic',
      'composer',
      'voice-director',
      'translator',
      'playtester',
      'accessibility-reviewer',
      'child-safety-reviewer',
      'publisher'
    ])
    // the renderer's picker list (src/renderer/ui/roles.ts) is the same list, in the same order (the media roles joined it in EGS-22)
    expect([...KNOWN_ROLES]).toEqual([...ROLES])
  })

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
  it('quality.md: threshold 7, two rounds, the three must-pass reviewers and a weight for each dimension', () => {
    const q = parseMdWith(seed('config', 'quality.md'), qualitySchema).data
    expect(q).toMatchObject({ threshold: 7, max_rounds: 2, revise_below: 7, must_pass: ['fact-checker', 'accessibility-reviewer', 'child-safety-reviewer'] })
    expect(Object.keys(q.weights).sort()).toEqual(['accessibility', 'accuracy', 'age_fit', 'difficulty', 'flow', 'readability'])
  })

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

  it('the factory defaults: a research limit of 40 questions per course, unverified facts not allowed', () => {
    expect(factorySchema.parse({ kind: 'factory' })).toMatchObject({ research_limit_per_course: 40, allow_unverified_facts: false })
  })

  it('providers.md: the search providers in Scriptorium\'s order, client-search on and the keyed ones off', () => {
    const p = parseMdWith(seed('config', 'providers.md'), providersSchema).data
    expect(p.search_order).toEqual(['tavily', 'client-search', 'wikipedia', 'brave', 'serpapi', 'serphouse', 'duckduckgo'])
    const search = p.providers.filter((x) => x.kind === 'search')
    expect(search.map((x) => x.id)).toEqual(p.search_order)
    expect(search.find((x) => x.id === 'client-search')).toMatchObject({ engine: 'client', enabled: true, wait_minutes: 10, price_per_request: 0 })
    expect(search.find((x) => x.id === 'tavily')).toMatchObject({ engine: 'tavily', api_key_env: 'TAVILY_API_KEY' })
    for (const id of ['brave', 'serpapi', 'serphouse', 'duckduckgo']) expect(search.find((x) => x.id === id)!.enabled, id).toBe(false)
    expect(parseMd(seed('config', 'providers.md')).body).toContain('## Search providers')
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

  it('every seeded prompt file belongs to a known role, and _rules.md states the rules of the team', () => {
    const files = walk(path.join(seedDir, 'prompts')).map((f) => path.relative(path.join(seedDir, 'prompts'), f).split(path.sep).join('/'))
    for (const f of files) if (f !== '_rules.md') expect(ROLES as readonly string[], f).toContain(f.split('/')[0])
    const rules = parseMd(seed('prompts', '_rules.md')).body
    for (const phrase of ['JSON', 'fact base', '[f3]', 'language of the course', 'living author', 'copyrighted']) expect(rules, phrase).toContain(phrase)
  })
})

describe('a data folder made from the seed', () => {
  it('has the new config, prompts and agents, and records the hash of each seed file', async () => {
    const data = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TEMP ?? '.'), 'edu-seed-roles-'))
    try {
      await initDataFolder(data, seedDir)
      const hashes = (JSON.parse(fs.readFileSync(path.join(data, SEED_HASHES_FILE), 'utf8')) as { files: Record<string, string> }).files
      for (const rel of ['config/quality.md', 'config/formats.md', 'config/roles.md', 'config/providers.md', 'prompts/_rules.md', 'prompts/researcher/write_notes.md', 'prompts/researcher/check_notes.md', 'prompts/researcher/search_queries.md', 'prompts/researcher/from_knowledge.md', 'prompts/fact-checker/fact_check.md']) {
        expect(hashes[rel], rel).toBe(seedHash(fs.readFileSync(path.join(data, ...rel.split('/')), 'utf8')))
      }
      expect(fs.readdirSync(path.join(data, 'agents'))).toEqual(expect.arrayContaining(['director-default.md', 'fact-checker-leo-brandt.md', 'researcher-nora-wells.md', 'researcher-sam-okafor.md']))
    } finally {
      fs.rmSync(data, { recursive: true, force: true })
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

  it('the factory file sets the research limit and allow_unverified_facts, and the research service follows it', async () => {
    const env = await makeEnv({ paused: true, agents: [{ role: 'researcher', name: 'R' }], roles: { researcher: ['loc/m1'] } })
    try {
      expect(env.engine.factory).toMatchObject({ research_limit_per_course: 40, allow_unverified_facts: false })
      const file = path.join(env.dir, 'config', 'factory.md')
      await writeMd(file, { kind: 'factory', paused: true, research_limit_per_course: 1, allow_unverified_facts: true }, 'x\n')
      await env.engine.handleWatch({ kind: 'config', change: 'change', path: file, rel: 'config/factory.md' })
      expect(env.engine.factory).toMatchObject({ research_limit_per_course: 1, allow_unverified_facts: true })
      const ask = (q: string) => env.engine.edu.research.ask({ slug: 'rome', question: q, askedBy: 'you' })
      expect((await ask('First question here?')).status).toBe('created')
      expect((await ask('Second question here?')).status).toBe('limit')
    } finally {
      await env.cleanup()
    }
  })
})

describe('the MCP guide', () => {
  it('documents the research tools, the fact base and the client-search loop', () => {
    for (const phrase of ['## Research and the fact base', 'edu_ask_researcher', 'edu_factbase_get', 'edu_get_task {role: "searcher"}', 'client-search', 'research_limit_per_course', 'allow_unverified_facts', '[f3]', 'factbase/facts.md']) expect(GUIDE, phrase).toContain(phrase)
  })
})
