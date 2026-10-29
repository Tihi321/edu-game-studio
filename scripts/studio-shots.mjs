#!/usr/bin/env node
/**
 * The studio's browser harness (EGS-05): builds the renderer, loads it in headless Chromium with a MOCKED `window.edustudio`, visits every
 * page and every Course tab, screenshots each at 1280x800 and 390x844, runs axe-core on each, and checks the keyboard (skip link, arrow keys
 * on the tabs, the dialog's focus trap and Escape), the fonts and the console. Exit 0 = nothing serious found, 1 = a failed check,
 * 2 = bad usage, 3 = Chromium cannot be launched.
 *
 * The mock answers the protocol like the engine does: the Course commands (getCourse, buildCourse, lintCourse, updateItem) run the REAL
 * engine handler (src/engine/edu/studio-commands.ts) on a temporary copy of the golden fixtures, so a build, a lint and a saved item are
 * true; the snapshot (models, agents, providers) and the generator status are fixed fixtures. Nothing touches ~/EduGames, no service is
 * started and no key is read.
 *
 *   node scripts/studio-shots.mjs [--out <dir>] [--no-build] [--quick] [--only <substring>]
 *
 *   --out <dir>      where the screenshots go (default .claude/temp/screens/phase2/studio)
 *   --no-build       reuse the renderer build of the last run
 *   --quick          desktop width, light scheme only
 *   --only <text>    run only the checks whose name contains the text
 *
 * Needs Chromium for Playwright (`yarn playwright install chromium`), and `out/player/` for a real build (`yarn build:player`); without it
 * a stand-in bundle is used, which is fine for the pages (the game itself is not played here).
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const flag = (n) => args.includes(`--${n}`)
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : d
}
const OUT = path.resolve(ROOT, opt('out', '.claude/temp/screens/phase2/studio'))
const TEMP = path.join(ROOT, '.claude', 'temp', 'studio-harness')
const DIST = path.join(TEMP, 'dist')
const ONLY = opt('only', '')
const QUICK = flag('quick')

const failures = []
const notes = []
const fail = (m) => {
  failures.push(m)
  console.error(`FAIL ${m}`)
}

// ---------------------------------------------------------------------------------------------- build

async function buildRenderer() {
  if (flag('no-build') && fs.existsSync(path.join(DIST, 'index.html'))) return
  const { build } = await import('vite')
  const react = (await import('@vitejs/plugin-react')).default
  fs.rmSync(DIST, { recursive: true, force: true })
  await build({
    root: path.join(ROOT, 'src', 'renderer'),
    configFile: false,
    base: './',
    logLevel: 'warn',
    plugins: [react()],
    build: { outDir: DIST, emptyOutDir: true, minify: 'esbuild', rollupOptions: { input: path.join(ROOT, 'src', 'renderer', 'index.html') } }
  })
}

// ---------------------------------------------------------------------------------------------- data

async function makeData(id, { courses = true, badPack = false } = {}) {
  const dir = path.join(TEMP, 'data', id)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(path.join(dir, 'courses'), { recursive: true })
  if (courses) {
    const fx = path.join(ROOT, 'tests', 'fixtures', 'courses')
    for (const [from, to] of [['solar-system', 'solar-system'], ['hr-a1-greetings', 'hr-a1-greetings'], ['broken', 'broken-demo']]) {
      fs.cpSync(path.join(fx, from), path.join(dir, 'courses', to), { recursive: true })
    }
  }
  if (courses) {
    // the same golden course in the other looks, so the Library shows every cover (a course names its look in shells.config)
    for (const [slug, theme] of [['solar-castle', 'castle'], ['solar-parchment', 'parchment'], ['solar-pixel', 'pixel']]) {
      fs.cpSync(path.join(dir, 'courses', 'solar-system'), path.join(dir, 'courses', slug), { recursive: true })
      const f = path.join(dir, 'courses', slug, 'course', 'pack.json')
      const pack = JSON.parse(fs.readFileSync(f, 'utf8'))
      pack.slug = slug
      pack.id = slug
      pack.shells = { enabled: ['quiz-arena'], config: { 'quiz-arena': { theme } } }
      fs.writeFileSync(f, JSON.stringify(pack, null, 2))
    }
  }
  if (badPack) {
    const c = path.join(dir, 'courses', 'bad-pack', 'course')
    fs.mkdirSync(c, { recursive: true })
    fs.writeFileSync(path.join(c, 'pack.json'), JSON.stringify({ schema: 1, id: 'bad-pack' }))
  }
  return dir
}

function playerDir() {
  const real = path.join(ROOT, 'out', 'player')
  if (fs.existsSync(path.join(real, 'player.js')) && fs.existsSync(path.join(real, 'player.css'))) return real
  const stub = path.join(TEMP, 'player-stub')
  fs.mkdirSync(stub, { recursive: true })
  fs.writeFileSync(path.join(stub, 'player.js'), '/* stand-in player */\n')
  fs.writeFileSync(path.join(stub, 'player.css'), '/* stand-in player css */\n')
  notes.push('out/player is missing: a stand-in player bundle was used for the builds')
  return stub
}

// the fixed answers of the engine that are not about courses
const AT = '2026-10-29T10:00:00.000Z'
function snapshotEvent(dataDir) {
  const model = (provider, id, o = {}) => ({ ref: `${provider}/${id}`, provider, model: id, family: id.split('-')[0], local: false, kind: 'paid', group: 'paid', enabled: true, shown: true, source: 'config', vision: false, priceIn: 0.3, priceOut: 1.2, context: 128000, ...o })
  const provider = (id, name, o = {}) => ({ id, name, kind: 'openai', local: false, custom: false, enabled: true, jsonSchema: true, keyName: `${id.toUpperCase()}_API_KEY`, keySet: true, available: true, canList: true, concurrency: 2, concurrencyAuto: false, requestsToday: 14, dayFull: false, dayResetsAt: Date.parse('2026-10-30T00:00:00Z'), ...o })
  return {
    type: 'snapshot',
    dataDir,
    uptimeMs: 3600000,
    paused: false,
    agents: [
      { id: 'director-1', name: 'Mira', role: 'director', model: null, resolvedModel: 'client/claude-code', pin: null, paused: false, state: 'idle' },
      { id: 'director-2', name: 'Teo', role: 'director', model: 'deepseek/deepseek-chat', resolvedModel: 'deepseek/deepseek-chat', pin: null, paused: false, state: 'waiting-provider', task: 'plan the next job', problem: { kind: 'rate-limit', model: 'deepseek/deepseek-chat', message: 'HTTP 429', at: 1 } }
    ],
    models: [
      model('deepseek', 'deepseek-chat'),
      model('gemini', 'gemini-2.5-flash', { vision: true, priceIn: 0.1, priceOut: 0.4 }),
      model('anthropic', 'claude-sonnet-4-5', { vision: true, priceIn: 3, priceOut: 15 }),
      model('lmstudio', 'qwen3-8b', { local: true, kind: 'lmstudio', group: 'lmstudio', priceIn: 0, priceOut: 0 }),
      model('strata', 'strata-high', { local: true, kind: 'strata', group: 'strata', priceIn: 0, priceOut: 0 }),
      model('client', 'claude-code', { local: true, kind: 'client', priceIn: 0, priceOut: 0 })
    ],
    providers: [
      provider('deepseek', 'DeepSeek'),
      provider('gemini', 'Gemini', { rpd: 250, requestsToday: 31 }),
      provider('anthropic', 'Anthropic', { keySet: false, available: false, reason: 'no key (ANTHROPIC_API_KEY)' }),
      provider('lmstudio', 'LM Studio', { local: true, kind: 'lmstudio', keyName: undefined, keySet: false, concurrencyAuto: true, concurrency: 4 }),
      provider('strata', 'Strata', { local: true, kind: 'strata', keyName: undefined, keySet: false, concurrencyAuto: true }),
      provider('client', 'Claude Code (client)', { local: true, kind: 'client', keyName: undefined, keySet: false })
    ],
    roleDefaults: { director: 'client/claude-code' },
    servers: [{ id: 'lmstudio', down: false, slots: 4 }, { id: 'strata', down: true, slots: 0 }],
    spend: { today: 0.42, month: 6.1, dailyCap: 5, monthlyCap: 60 },
    running: [],
    settings: { fallbacks: ['paid', 'lmstudio', 'client'], fallbackShared: true, lmstudioParallel: 4, lmstudioContext: 16384, lmstudioTtlMinutes: 30 },
    secretsSet: ['DEEPSEEK_API_KEY', 'GEMINI_API_KEY'],
    keyNames: ['DEEPSEEK_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY'],
    at: AT
  }
}

const GENERATOR_EVENTS = {
  comfyStatus: () => ({
    type: 'comfy.status',
    ok: true,
    lanes: [{ url: 'http://127.0.0.1:8188', reachable: true, running: 0, pending: 1, error: '' }, { url: 'http://127.0.0.1:8189', reachable: false, running: 0, pending: 0, error: 'connection refused' }],
    engines: [
      { id: 'flux-schnell', kind: 'image', label: 'FLUX.1 schnell', task: 'music', languages: [], ready: true, missing: [] },
      { id: 'ace-step', kind: 'audio', label: 'ACE-Step music', task: 'music', languages: [], ready: false, missing: ['unet=ace_step_v1.safetensors', 'node:ACEStepNode'] },
      { id: 'tts-kokoro', kind: 'audio', label: 'Kokoro voice', task: 'tts', languages: ['en', 'es', 'fr'], ready: true, missing: [] }
    ],
    customWorkflows: ['my-voice'],
    backgroundRemoval: { available: false, models: [] }
  }),
  listEngines: () => ({
    type: 'engines.listed',
    image: [{ id: 'flux-schnell', kind: 'image', label: 'FLUX.1 schnell', edit: false, task: 'music', languages: [] }],
    audio: [{ id: 'tts-kokoro', kind: 'audio', label: 'Kokoro voice', edit: false, task: 'tts', languages: ['en', 'es', 'fr'] }],
    palettes: ['gb', 'nes']
  }),
  listCustomWorkflows: () => ({ type: 'workflows.listed', workflows: [{ name: 'my-voice', kind: 'audio', languages: ['hr'] }] }),
  voiceStatus: () => ({
    type: 'voice.status',
    ok: true,
    error: '',
    comfyUrl: 'http://127.0.0.1:8188',
    defaultEngine: 'tts-kokoro',
    engines: [{ id: 'tts-kokoro', label: 'Kokoro voice', task: 'tts', languages: ['en', 'es', 'fr'], ready: true, missing: [] }, { id: 'tts-higgs', label: 'Higgs Audio', task: 'tts', languages: '*', ready: false, missing: ['node:UnifiedTTSTextNode'] }],
    workflows: [{ name: 'my-voice', languages: ['hr'] }]
  }),
  studiosStatus: () => ({
    type: 'studios.status',
    studios: [
      { id: 'pixel', name: 'Pixel Studio', ok: true, error: '', url: 'http://127.0.0.1:7455/mcp', repo: '../pixel-studio', hint: 'yarn mcp', tools: 31 },
      { id: 'chiptune', name: 'Chiptune Studio', ok: false, error: 'connection refused: start it with yarn mcp in the Chiptune Studio folder', url: 'http://127.0.0.1:7456/mcp', repo: '../chiptune-studio', hint: 'yarn mcp', tools: 0 },
      { id: 'flow', name: 'flow-music-mcp (Google Flow)', ok: false, error: 'Google Flow is not signed in', url: 'http://127.0.0.1:7457/mcp', repo: '../flow-music-mcp', hint: 'start it', tools: 0 }
    ]
  }),
  comfyFree: () => ({ type: 'comfy.freed', results: [{ lane: 'http://127.0.0.1:8188', ok: true }] }),
  mcpStatus: () => ({ type: 'mcp.status', enabled: true, listening: true, url: 'http://127.0.0.1:7463/mcp', error: '', port: 7463, tokenSet: false })
}

// ---------------------------------------------------------------------------------------------- the engine behind the mock

async function makeEngine(mode, dataDir, { CourseStore, handleStudioCommand }) {
  const courses = new CourseStore(dataDir, { playerDir: playerDir() })
  const displayDir = '~/EduGames'
  return async function answer(cmd) {
    const out = []
    const emit = (e) => out.push(e)
    if (mode === 'offline') return out
    switch (cmd.type) {
      case 'snapshot':
        emit({ type: 'engine.ready', pid: 1, dataDir: displayDir, at: AT })
        emit(snapshotEvent(displayDir))
        break
      case 'listCourses':
        emit({ type: 'courses.listed', courses: mode === 'empty' ? [] : await courses.list() })
        break
      case 'getCourse':
      case 'buildCourse':
      case 'lintCourse':
      case 'updateItem':
        if (mode === 'loading' && cmd.type === 'getCourse') break // never answers: the skeleton stays
        await handleStudioCommand({ courses, emit, log: () => undefined }, cmd)
        break
      default:
        if (GENERATOR_EVENTS[cmd.type]) emit(GENERATOR_EVENTS[cmd.type]())
    }
    return out
  }
}

// ---------------------------------------------------------------------------------------------- the page

const MOCK = `(() => {
  const cfg = window.__MOCK_CFG__
  const handlers = new Set()
  const emit = (e) => handlers.forEach((h) => h(e))
  window.edustudio = {
    fileBase: cfg.fileBase,
    on(h) { handlers.add(h); return () => handlers.delete(h) },
    send(cmd) {
      window.__sent = (window.__sent || []).concat([cmd])
      window.__eduSend(JSON.stringify(cmd)).then((list) => JSON.parse(list).forEach(emit))
    },
    openGame: async (slug) => { window.__opened = slug; return true },
    getStartWithWindows: async () => false,
    setStartWithWindows: async (on) => on
  }
})()`

function serve(dataDirs) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.png': 'image/png', '.json': 'application/json' }
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x')
    const p = decodeURIComponent(u.pathname)
    let file
    const m = /^\/files\/([^/]+)\/(.+)$/.exec(p)
    if (m && dataDirs[m[1]]) {
      file = path.resolve(dataDirs[m[1]], m[2])
      if (!file.startsWith(path.resolve(dataDirs[m[1]]) + path.sep)) file = undefined
    } else {
      file = path.resolve(DIST, '.' + (p === '/' ? '/index.html' : p))
      if (!file.startsWith(DIST)) file = undefined
    }
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end('not found')
      return
    }
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'access-control-allow-origin': '*' })
    fs.createReadStream(file).pipe(res)
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)))
}

const FLOW_CSS = 'html,body,#root,.app{height:auto!important;overflow:visible!important}.main-col{overflow:visible!important}.item-rows{max-height:none!important}'
const TESTID_SELECTOR = 'button, a[href], input, select, textarea, summary, audio[controls], [role="tab"], [role="button"]'

async function newPage(browser, origin, id, mode, dataDir, engineMods, vp, scheme) {
  const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme, reducedMotion: 'no-preference' })
  const page = await ctx.newPage()
  const problems = []
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console error: ${m.text()}`)
  })
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`))
  page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()}`))
  const answer = await makeEngine(mode, dataDir, engineMods)
  await page.exposeFunction('__eduSend', async (json) => JSON.stringify(await answer(JSON.parse(json))))
  await page.addInitScript(`window.__MOCK_CFG__ = ${JSON.stringify({ fileBase: `${origin}/files/${id}` })}`)
  await page.addInitScript(MOCK)
  return { ctx, page, problems, dataDir }
}

// ---------------------------------------------------------------------------------------------- checks

const axeSource = () => fs.readFileSync(path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8')
const summary = []

async function audit(page, name, { shot = true, vpName, scheme, axeOn = true } = {}) {
  await page.evaluate(() => document.fonts.ready)
  // let every finite animation end: axe measures colours, and a text that is still fading in reads as low contrast
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))))
  await page.waitForTimeout(80)
  const label = `${scheme === 'dark' ? 'dark-' : ''}${name}-${vpName}`
  if (shot) {
    fs.mkdirSync(OUT, { recursive: true })
    const flow = vpName === '1280' ? await page.addStyleTag({ content: FLOW_CSS }) : null
    await page.screenshot({ path: path.join(OUT, `${label}.png`), fullPage: true })
    if (flow) await flow.evaluate((el) => el.remove())
  }
  // every interactive element has a data-testid (the autoplay bot and Playwright drive the studio through them)
  const untested = await page.evaluate((sel) => {
    const out = []
    for (const el of document.querySelectorAll(`#root ${sel.split(',').join(', #root ')}`)) {
      if (!el.getAttribute('data-testid')) out.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40)}"`)
    }
    return out
  }, TESTID_SELECTOR)
  if (untested.length) fail(`${label}: ${untested.length} interactive element(s) without data-testid: ${untested.slice(0, 5).join('; ')}`)
  if (!axeOn) return
  if (!(await page.evaluate(() => typeof window.axe !== 'undefined'))) await page.evaluate(axeSource()) // not addScriptTag: the page's CSP refuses inline scripts, a protocol evaluate is not subject to it
  const res = await page.evaluate(async () => {
    const r = await window.axe.run(document, { resultTypes: ['violations'] })
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, target: v.nodes[0]?.target?.join(' ') ?? '', html: (v.nodes[0]?.html ?? '').slice(0, 140) }))
  })
  const bad = res.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  summary.push({ label, serious: bad.length, minor: res.length - bad.length, detail: res })
  for (const v of bad) fail(`${label}: axe ${v.impact} ${v.id} (${v.nodes}x) ${v.help} at ${v.target} ${v.html}`)
  for (const v of res.filter((x) => !bad.includes(x))) notes.push(`${label}: axe ${v.impact} ${v.id} (${v.nodes}x) ${v.help}`)
}

const want = (name) => !ONLY || name.includes(ONLY)

async function openStudio(page, origin) {
  await page.goto(`${origin}/index.html`)
  await page.waitForSelector('[data-testid="page-courses"], [data-testid="nav-courses"]')
}

async function goTab(page, tab) {
  await page.click(`[data-testid="course-tab-${tab}"]`)
  await page.waitForSelector(`[data-testid="course-panel-${tab}"]`)
}

// ---------------------------------------------------------------------------------------------- scenarios

async function mainRun(browser, origin, dataDir, engineMods, vp, vpName, scheme) {
  const { ctx, page, problems } = await newPage(browser, origin, 'main', 'normal', dataDir, engineMods, vp, scheme)
  const o = { vpName, scheme }
  try {
    await openStudio(page, origin)
    await page.waitForSelector('[data-testid="stages-solar-system"]')
    await page.waitForSelector('[data-testid="stages-hr-a1-greetings"]')
    await page.waitForSelector('[data-testid="stages-broken-demo"]', { timeout: 8000 })
    if (want('library')) await audit(page, 'library', o)

    // the fonts of the studio are bundled and load under the page's CSP
    const faces = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')))
    for (const fam of ['Atkinson Hyperlegible Next', 'Young Serif']) if (!faces.includes(fam)) fail(`${vpName}: the font "${fam}" did not load (loaded: ${[...new Set(faces)].join(', ') || 'none'})`)

    const tabs = ['brief', 'curriculum', 'encyclopedia', 'items', 'game', 'assets', 'voice', 'editions', 'build', 'playtest']
    for (const slug of ['solar-system', 'hr-a1-greetings']) {
      if (!want(slug) && !want('course')) continue
      await page.click('[data-testid="nav-courses"]')
      await page.click(`[data-testid="course-${slug}"]`)
      await page.waitForSelector('[data-testid="course-title"]')
      for (const tab of tabs) {
        await goTab(page, tab)
        if (tab === 'items') await page.waitForSelector('[data-testid="item-list"], [data-testid="items-empty"]')
        if (tab === 'voice') await page.waitForSelector('[data-testid="voice-summary"], [data-testid="voice-empty"]')
        if (tab === 'game') await page.waitForSelector('[data-testid="preview-stage"]')
        await audit(page, `${slug}-${tab}`, o)
      }
    }

    if (want('item')) await itemEditorRun(page, o, dataDir, vpName === '1280' && scheme === 'light')
    if (want('build')) await buildRun(page, o)

    for (const [nav, name, ready] of [['models', 'models', 'models-page'], ['agents', 'agents', 'agent-list'], ['generators', 'generators', 'comfy-voices'], ['settings', 'settings', 'set-scheme']]) {
      if (!want(name)) continue
      await page.click(`[data-testid="nav-${nav}"]`)
      await page.waitForSelector(`[data-testid="${ready}"]`)
      if (nav === 'generators') await page.waitForSelector('[data-testid="comfy-voice-tts-kokoro"]')
      await audit(page, name, o)
    }
    if (want('models')) {
      await page.click('[data-testid="nav-models"]')
      await page.click('[data-testid="models-provider-gemini"]')
      await audit(page, 'models-provider', o)
      await page.click('[data-testid="models-add-provider"]')
      await page.waitForSelector('[data-testid="provider-form"]')
      await audit(page, 'models-add-provider', o)
    }
    if (want('agents')) {
      await page.click('[data-testid="nav-agents"]')
      await page.click('[data-testid="hire-open"]')
      await page.waitForSelector('[data-testid="hire-form"]')
      await audit(page, 'agents-hire', o)
    }
  } finally {
    for (const p of problems) fail(`${scheme}/${vpName}: ${p}`)
    await ctx.close()
  }
}

async function itemEditorRun(page, o, dataDir, functional) {
  const slug = 'solar-system'
  await page.click('[data-testid="nav-courses"]')
  await page.click(`[data-testid="course-${slug}"]`)
  await goTab(page, 'items')
  // one item of several kinds, each with its preview open
  for (const [id, name] of [['q-order-mcq', 'mcq'], ['q-sun-tf', 'true-false'], ['q-giants-multi', 'multi-select'], ['q-sun-cloze', 'cloze'], ['q-giants-typed', 'typed'], ['q-facts-match', 'match-pairs'], ['q-order-seq', 'order'], ['q-types-sort', 'sort-groups'], ['q-order-hotspot', 'hotspot'], ['q-sun-beeps', 'listening'], ['q-order-card', 'flashcard'], ['q-facts-cross', 'crossword'], ['q-planets-ws', 'word-search']]) {
    const row = page.locator(`[data-testid="item-row-${id}"]`)
    if ((await row.count()) === 0) continue
    await row.click()
    await page.waitForSelector(`[data-testid="item-editor"][data-item="${id}"]`)
    await page.waitForSelector(`[data-testid="preview-stage"][data-item="${id}"] .item-body`)
    await audit(page, `item-editor-${name}`, o)
  }
  if (!functional) return
  // --- the preview plays the item with the shared checker
  await page.click('[data-testid="item-row-q-order-mcq"]')
  await page.waitForSelector('[data-testid="preview-stage"] [data-testid="option-mercury"]')
  await page.click('[data-testid="preview-stage"] [data-testid="option-venus"]')
  await page.waitForSelector('[data-testid="preview-feedback"]')
  if ((await page.textContent('[data-testid="preview-verdict"]'))?.trim() !== 'Not right') fail('preview: a wrong option was not judged wrong')
  if (!(await page.textContent('[data-testid="preview-feedback"]'))?.includes('Venus is the second planet')) fail('preview: the explanation of the chosen wrong option is not shown')
  await page.click('[data-testid="preview-reset"]')
  await page.click('[data-testid="preview-stage"] [data-testid="option-mercury"]')
  await page.waitForSelector('[data-testid="preview-feedback"][data-result="correct"]')
  // --- an edit shows in the preview and saves through the engine
  const field = page.locator('[data-testid="field-q-order-mcq.prompt"]')
  const before = await field.inputValue()
  await field.fill(`${before} (edited)`)
  await page.waitForFunction(() => document.querySelector('[data-testid="preview-prompt"]')?.textContent?.includes('(edited)'))
  await page.click('[data-testid="item-save"]')
  await page.waitForSelector('[data-testid="item-saved"]')
  const disk = fs.readFileSync(path.join(dataDir, 'courses', slug, 'course', 'text', 'en.json'), 'utf8')
  if (!disk.includes('(edited)')) fail('item save: the edited text is not in the catalog file')
  await audit(page, 'item-saved', o)
  // --- the dirty item asks before it is left: a dialog that traps focus and closes on Escape
  await field.fill(`${before} (second edit)`)
  const next = page.locator('[data-testid="item-row-q-order-seq"], [data-testid^="item-row-"]').nth(2)
  const nextId = await next.getAttribute('data-testid')
  await next.click()
  await page.waitForSelector('[data-testid="unsaved-dialog"]')
  await audit(page, 'item-unsaved-dialog', o)
  const inDialog = () => page.evaluate(() => !!document.activeElement?.closest('[data-testid="unsaved-dialog"]'))
  if (!(await inDialog())) fail('dialog: the focus did not move into it')
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab')
    if (!(await inDialog())) fail('dialog: Tab left the dialog')
  }
  await page.keyboard.press('Shift+Tab')
  if (!(await inDialog())) fail('dialog: Shift+Tab left the dialog')
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-testid="unsaved-dialog"]', { state: 'detached' })
  const back = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))
  if (back !== nextId) fail(`dialog: Escape did not return the focus to ${nextId} (it is on ${back})`)
  if (!(await page.locator('[data-testid="item-dirty"]').count())) fail('dialog: Escape discarded the edit')
  await page.click('[data-testid="item-revert"]')
  // --- list rows are reached with the arrow keys
  await page.locator('[data-testid="item-row-q-order-mcq"]').focus()
  await page.keyboard.press('ArrowDown')
  if (!(await page.evaluate(() => document.activeElement?.getAttribute('data-testid')?.startsWith('item-row-')))) fail('items: ArrowDown does not move between rows')
}

async function buildRun(page, o) {
  await page.click('[data-testid="nav-courses"]')
  await page.click('[data-testid="course-solar-system"]')
  await goTab(page, 'build')
  await page.click('[data-testid="build-run"]')
  await page.waitForSelector('[data-testid="build-result"]')
  await page.click('[data-testid="lint-run"]')
  await page.waitForSelector('[data-testid="lint-result"]')
  const summaryText = (await page.textContent('[data-testid="lint-summary"]')) ?? ''
  if (!summaryText.includes('passes')) fail(`build: the solar-system fixture did not lint clean in the studio: ${summaryText}`)
  await audit(page, 'solar-system-build-done', o)
  await page.click('[data-testid="game-open"]')
  await page.waitForSelector('[data-testid="game-opened"]')
  // a course with problems: the build is refused, "Build anyway" writes it, and the lint reports codes
  await page.click('[data-testid="nav-courses"]')
  await page.click('[data-testid="course-broken-demo"]')
  await goTab(page, 'build')
  await page.click('[data-testid="build-run"]')
  await page.waitForSelector('[data-testid="build-problems"]')
  await audit(page, 'broken-build-refused', o)
  await page.click('[data-testid="build-force"]')
  await page.waitForFunction(() => document.querySelector('[data-testid="build-result"]')?.textContent?.includes('built with problems'))
  await page.click('[data-testid="lint-run"]')
  await page.waitForSelector('[data-testid="lint-problems"]')
  await audit(page, 'broken-lint', o)
}

async function stateRuns(browser, origin, engineMods, vp, vpName) {
  const o = { vpName, scheme: 'light' }
  // empty library
  {
    const dir = await makeData('empty', { courses: false })
    const { ctx, page, problems } = await newPage(browser, origin, 'empty', 'empty', dir, engineMods, vp, 'light')
    await openStudio(page, origin)
    await page.waitForSelector('[data-testid="courses-empty"]')
    await audit(page, 'library-empty', o)
    for (const p of problems) fail(`empty/${vpName}: ${p}`)
    await ctx.close()
  }
  // engine not connected
  {
    const dir = await makeData('offline', { courses: false })
    const { ctx, page, problems } = await newPage(browser, origin, 'offline', 'offline', dir, engineMods, vp, 'light')
    await openStudio(page, origin)
    await page.waitForSelector('[data-testid="library-offline"]')
    await audit(page, 'library-offline', o)
    for (const p of problems) fail(`offline/${vpName}: ${p}`)
    await ctx.close()
  }
  // courses are listed but their files are still being read
  {
    const dir = await makeData('loading')
    const { ctx, page, problems } = await newPage(browser, origin, 'loading', 'loading', dir, engineMods, vp, 'light')
    await openStudio(page, origin)
    await page.waitForSelector('[data-testid="course-loading-solar-system"]')
    await audit(page, 'library-loading', o)
    await page.click('[data-testid="course-solar-system"]')
    await page.waitForSelector('[data-testid="course-loading"]')
    await audit(page, 'course-loading', o)
    for (const p of problems) fail(`loading/${vpName}: ${p}`)
    await ctx.close()
  }
  // a course whose files cannot be read: the engine's command.error shows where the course is
  {
    const dir = await makeData('bad', { courses: false, badPack: true })
    const { ctx, page, problems } = await newPage(browser, origin, 'bad', 'normal', dir, engineMods, vp, 'light')
    await openStudio(page, origin)
    await page.waitForSelector('[data-testid="course-error-bad-pack"]')
    await audit(page, 'library-error', o)
    await page.click('[data-testid="course-bad-pack"]')
    await page.waitForSelector('[data-testid="course-error"]')
    await audit(page, 'course-error', o)
    for (const p of problems) fail(`bad/${vpName}: ${p}`)
    await ctx.close()
  }
}

async function keyboardRun(browser, origin, dataDir, engineMods) {
  const { ctx, page, problems } = await newPage(browser, origin, 'main', 'normal', dataDir, engineMods, { width: 1280, height: 800 }, 'light')
  await openStudio(page, origin)
  await page.waitForSelector('[data-testid="stages-solar-system"]')
  // the skip link is the first stop and moves the focus to the page
  await page.keyboard.press('Tab')
  if ((await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))) !== 'skip-link') fail('keyboard: the skip link is not the first Tab stop')
  await page.keyboard.press('Enter')
  if ((await page.evaluate(() => document.activeElement?.id)) !== 'main') fail('keyboard: the skip link did not move the focus to the page')
  // the nav is reachable and operable
  await page.locator('[data-testid="nav-settings"]').focus()
  await page.keyboard.press('Enter')
  await page.waitForSelector('[data-testid="page-settings"]')
  await page.locator('[data-testid="nav-courses"]').focus()
  await page.keyboard.press('Enter')
  await page.locator('[data-testid="course-solar-system"]').focus()
  await page.keyboard.press('Enter')
  await page.waitForSelector('[data-testid="course-tabs"]')
  // the ARIA tabs pattern: one tab stop, arrows move and select, Home and End jump
  await page.locator('[data-testid="course-tab-brief"]').focus()
  const selected = () => page.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-testid'))
  await page.keyboard.press('ArrowRight')
  if ((await selected()) !== 'course-tab-curriculum') fail(`keyboard: ArrowRight on the tabs selected ${await selected()}`)
  await page.keyboard.press('End')
  if ((await selected()) !== 'course-tab-playtest') fail(`keyboard: End on the tabs selected ${await selected()}`)
  await page.keyboard.press('ArrowRight')
  if ((await selected()) !== 'course-tab-brief') fail(`keyboard: ArrowRight after the last tab selected ${await selected()}`)
  await page.keyboard.press('ArrowLeft')
  if ((await selected()) !== 'course-tab-playtest') fail('keyboard: ArrowLeft on the first tab did not wrap')
  await page.keyboard.press('Home')
  const tabStops = await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].filter((t) => t.tabIndex === 0).length)
  if (tabStops !== 1) fail(`keyboard: ${tabStops} tabs are tab stops (should be 1)`)
  // the focus ring is visible
  await page.locator('[data-testid="course-tab-brief"]').focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  const ring = await page.evaluate(() => {
    const cs = getComputedStyle(document.activeElement)
    return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) }
  })
  if (ring.style === 'none' || ring.width < 2) fail(`keyboard: the focused tab has no visible focus ring (${JSON.stringify(ring)})`)
  for (const p of problems) fail(`keyboard: ${p}`)
  await ctx.close()
}

// ---------------------------------------------------------------------------------------------- main

async function main() {
  let chromium
  try {
    ;({ chromium } = await import('playwright'))
  } catch {
    console.error('playwright is not installed (yarn install)')
    process.exit(2)
  }
  fs.mkdirSync(TEMP, { recursive: true })
  await buildRenderer()
  const { tsImport } = await import('tsx/esm/api')
  const here = pathToFileURL(path.join(ROOT, 'scripts', 'x.mjs')).href
  const { CourseStore } = await tsImport('../src/engine/edu/store.ts', here)
  const { handleStudioCommand } = await tsImport('../src/engine/edu/studio-commands.ts', here)
  const engineMods = { CourseStore, handleStudioCommand }

  const mainDir = await makeData('main')
  const dirs = { main: mainDir, empty: path.join(TEMP, 'data', 'empty'), offline: path.join(TEMP, 'data', 'offline'), loading: path.join(TEMP, 'data', 'loading'), bad: path.join(TEMP, 'data', 'bad') }
  const server = await serve(dirs)
  const origin = `http://127.0.0.1:${server.address().port}`
  let browser
  try {
    browser = await chromium.launch()
  } catch (e) {
    console.error(`Chromium cannot be launched (yarn playwright install chromium): ${String(e.message).split('\n')[0]}`)
    process.exit(3)
  }
  const t0 = Date.now()
  try {
    const runs = [
      [{ width: 1280, height: 800 }, '1280', 'light'],
      [{ width: 390, height: 844 }, '390', 'light'],
      ...(QUICK ? [] : [[{ width: 1280, height: 800 }, '1280', 'dark']])
    ]
    for (const [vp, vpName, scheme] of runs) {
      // a fresh copy of the data for each run: the item test edits a file
      const dir = await makeData('main')
      console.log(`run ${vpName} ${scheme}`)
      await mainRun(browser, origin, dir, engineMods, vp, vpName, scheme)
    }
    for (const [vp, vpName] of [[{ width: 1280, height: 800 }, '1280'], [{ width: 390, height: 844 }, '390']]) {
      if (want('state') || !ONLY) await stateRuns(browser, origin, engineMods, vp, vpName)
    }
    if (want('keyboard')) await keyboardRun(browser, origin, await makeData('main'), engineMods)
  } catch (e) {
    fail(`harness error: ${e?.stack ?? e}`)
  } finally {
    await browser.close()
    server.close()
  }

  console.log(`\naxe-core per page (serious or critical / other):`)
  for (const s of summary) console.log(`  ${s.serious === 0 ? 'ok  ' : 'FAIL'} ${s.label.padEnd(44)} ${s.serious} / ${s.minor}`)
  if (notes.length) console.log(`\nnotes:\n${[...new Set(notes)].map((n) => `  ${n}`).join('\n')}`)
  console.log(`\n${summary.length} audited states, screenshots in ${path.relative(ROOT, OUT)}, ${((Date.now() - t0) / 1000).toFixed(0)} s`)
  if (failures.length) {
    console.error(`\n${failures.length} failure(s)`)
    process.exit(1)
  }
  console.log('ok')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
