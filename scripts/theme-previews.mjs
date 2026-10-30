#!/usr/bin/env node
/**
 * Static theme previews (EGS-05): builds src/design/previews/ (the real design tokens, the four themes, the motion file and the player's
 * own item and arena styles, with the bundled fonts inlined) into .claude/temp/theme-previews/, one static page per theme
 * (`<id>.html`), then screenshots each at 1280x800 and 390x844 into .claude/temp/screens/phase2/themes/ and runs axe-core on it.
 *
 *   node scripts/theme-previews.mjs [--themes chalkboard,castle,parchment,pixel] [--no-shots] [--out <dir>] [--shots <dir>] [--json]
 *
 * Exit 0 when axe finds no serious or critical violation in any page (and nothing animates under prefers-reduced-motion), 1 when it
 * does, 3 when Chromium cannot be launched. No service is started; nothing leaves the machine.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const THEMES = [
  ['chalkboard', 'Chalkboard'],
  ['castle', 'Castle stone'],
  ['parchment', 'Parchment and brass'],
  ['pixel', 'Pixel quest'],
  ['postcard', 'Adriatic postcard'],
  ['noir', 'Case file noir']
]
const VIEWPORTS = [
  ['desktop', { width: 1280, height: 800 }],
  ['mobile', { width: 390, height: 844 }]
]

function parseArgs(argv) {
  const o = { themes: THEMES.map((t) => t[0]), shots: true, out: path.join(ROOT, '.claude', 'temp', 'theme-previews'), shotsDir: path.join(ROOT, '.claude', 'temp', 'screens', 'phase2', 'themes'), json: false }
  const rest = argv.slice()
  while (rest.length) {
    const a = rest.shift()
    if (a === '--themes') o.themes = String(rest.shift() ?? '').split(',').filter(Boolean)
    else if (a === '--no-shots') o.shots = false
    else if (a === '--out') o.out = path.resolve(String(rest.shift()))
    else if (a === '--shots') o.shotsDir = path.resolve(String(rest.shift()))
    else if (a === '--json') o.json = true
    else throw new Error(`unknown option ${a}`)
  }
  for (const t of o.themes) if (!THEMES.some((x) => x[0] === t)) throw new Error(`unknown theme ${t}`)
  return o
}

/** Builds the stylesheet with Vite (fonts inlined as data URIs, so the pages open over file://) and writes one HTML page per theme. */
async function buildPages(opts) {
  const { build } = await import('vite')
  const src = path.join(ROOT, 'src', 'design', 'previews')
  await build({
    root: src,
    configFile: false,
    publicDir: false,
    logLevel: 'warn',
    build: {
      outDir: opts.out,
      emptyOutDir: true,
      target: 'es2022',
      cssCodeSplit: false,
      reportCompressedSize: false,
      lib: { entry: path.join(src, 'previews.ts'), formats: ['iife'], name: 'EduPreviews', fileName: () => 'previews.js', cssFileName: 'previews' }
    }
  })
  const template = fs.readFileSync(path.join(src, 'template.html'), 'utf8')
  // the stylesheet goes into each page (fonts are data URIs already): a page is one file, opens over file://, and axe has no stylesheet to fetch
  const css = fs.readFileSync(path.join(opts.out, 'previews.css'), 'utf8')
  for (const [id, label] of THEMES) fs.writeFileSync(path.join(opts.out, `${id}.html`), template.replaceAll('__THEME__', id).replaceAll('__LABEL__', label).replace('__CSS__', () => css))
  fs.rmSync(path.join(opts.out, 'previews.js'), { force: true })
  fs.rmSync(path.join(opts.out, 'previews.css'), { force: true })
}

async function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2))
  } catch (e) {
    console.error(`${e instanceof Error ? e.message : e}\nusage: node scripts/theme-previews.mjs [--themes a,b] [--no-shots] [--out dir] [--shots dir] [--json]`)
    process.exit(2)
  }
  await buildPages(opts)
  const summary = { out: opts.out, pages: THEMES.map((t) => `${t[0]}.html`), shots: opts.shots ? opts.shotsDir : null, results: [], ok: true }
  if (!opts.shots) {
    console.log(JSON.stringify(summary, null, opts.json ? 0 : 2))
    return
  }

  let chromium
  try {
    ;({ chromium } = await import('playwright'))
  } catch (e) {
    console.error(`playwright is not installed: ${e instanceof Error ? e.message : e}`)
    process.exit(3)
  }
  let browser
  try {
    browser = await chromium.launch()
  } catch (e) {
    console.error(`Chromium cannot be launched (yarn playwright install chromium): ${e instanceof Error ? e.message.split('\n')[0] : e}`)
    process.exit(3)
  }
  const axeSource = fs.readFileSync(path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8')
  fs.mkdirSync(opts.shotsDir, { recursive: true })
  try {
    for (const [id] of THEMES.filter((t) => opts.themes.includes(t[0]))) {
      for (const [vpName, viewport] of VIEWPORTS) {
        const context = await browser.newContext({ viewport })
        const page = await context.newPage()
        const errors = []
        page.on('pageerror', (e) => errors.push(e.message))
        page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
        page.on('requestfailed', (r) => r.url().startsWith('file:') && errors.push(`request failed: ${r.url()}`))
        await page.goto(pathToFileURL(path.join(opts.out, `${id}.html`)).href)
        await page.evaluate(() => document.fonts.ready)
        await page.waitForTimeout(1200) // the screen entrance and the fonts
        await page.screenshot({ path: path.join(opts.shotsDir, `${id}-${vpName}.png`), fullPage: true })
        await page.evaluate(axeSource)
        const axe = await page.evaluate(() => window.axe.run(document, { resultTypes: ['violations'] }))
        const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
        // reduced motion: nothing may be running
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await page.reload()
        await page.waitForTimeout(200)
        const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)
        const fonts = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/['"]/g, '')))
        const result = {
          theme: id,
          viewport: vpName,
          axeViolations: axe.violations.length,
          serious: bad.length,
          details: bad.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, target: v.nodes[0]?.target })),
          overflowPx: Math.max(0, overflow),
          runningAnimationsWhenReduced: running,
          fontsLoaded: [...new Set(fonts)],
          errors
        }
        summary.results.push(result)
        if (bad.length || running || errors.length || overflow > 0) summary.ok = false
        await context.close()
      }
    }
  } finally {
    await browser.close().catch(() => undefined)
  }
  console.log(JSON.stringify(summary, null, opts.json ? 0 : 2))
  process.exit(summary.ok ? 0 : 1)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : String(e))
  process.exit(2)
})
