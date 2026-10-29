import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * The playtest runner: plays a BUILT game with the autoplay bot (`scripts/play.mjs`, headless Chromium, EGS-04) as a set of simulated
 * learners, and says whether the game is playable. The bot runs as a child process of the same Node that runs the engine (inside Electron
 * `ELECTRON_RUN_AS_NODE` makes the executable behave as Node); it needs `playwright` with Chromium (`yarn playwright install chromium`).
 *
 * Personas (fixed seeds, so a run is repeatable):
 *   perfect     right every time: every unit mastered, the end screen, an empty review queue (must pass)
 *   wrong       wrong every time: the feedback explains each miss, the review queue fills (must pass)
 *   strong      a learner who is right 90 % of the time (must finish)
 *   average     75 %, the bot's default learner (must finish)
 *   struggling  55 % (must finish within the step bound)
 * `ok` is true when every persona passed its own checks and no run logged a console error.
 */

export interface Persona {
  id: string
  mode: 'perfect' | 'wrong' | 'random'
  seed: number
  accuracy?: number
  /** `wrong` mode: rounds per open unit. */
  rounds?: number
}

export const PERSONAS: readonly Persona[] = [
  { id: 'perfect', mode: 'perfect', seed: 1 },
  { id: 'wrong', mode: 'wrong', seed: 2, rounds: 2 },
  { id: 'strong', mode: 'random', seed: 3, accuracy: 0.9 },
  { id: 'average', mode: 'random', seed: 4, accuracy: 0.75 },
  { id: 'struggling', mode: 'random', seed: 5, accuracy: 0.55 }
]

/** What the bot prints with `--json` (the fields the runner reads). */
export interface BotSummary {
  mode: string
  seed: number
  steps: number
  correct: number
  wrong: number
  screens: string[]
  finished: boolean
  consoleErrors: number
  maxSteps: number
  checks?: { whys: number; explanations: number; answers: number }
  ok: boolean
  failures: string[]
}

export interface PersonaRun {
  persona: string
  mode: string
  /** The bot's exit code (0 passed, 1 a check failed, 2 bad usage, 3 no Chromium). */
  code: number
  ok: boolean
  summary: BotSummary | null
  failures: string[]
}

export interface PlaytestResult {
  /** Every persona passed and nothing logged a console error. */
  ok: boolean
  runs: PersonaRun[]
  /** Every failure of every run, with its persona in front. */
  failures: string[]
  durationMs: number
}

export interface PlaytestOptions {
  /** Which personas to run: ids from `PERSONAS` or persona objects. Default: all five. */
  personas?: (string | Persona)[]
  /** `scripts/play.mjs`. Default: found relative to this code (`EDU_PLAY_SCRIPT` overrides). */
  playScript?: string
  /** The Node executable. Default `process.execPath`. */
  node?: string
  /** Per persona. Default 5 minutes. */
  timeoutMs?: number
  /** Personas running at the same time. Default 2 (each is a Chromium). */
  concurrency?: number
  signal?: AbortSignal
  env?: NodeJS.ProcessEnv
}

/** The bot cannot launch Chromium: the message says how to install it. */
export class ChromiumMissingError extends Error {
  constructor(detail = '') {
    super(`the autoplay bot cannot launch Chromium${detail ? ` (${detail})` : ''}: install it with "yarn playwright install chromium"`)
    this.name = 'ChromiumMissingError'
  }
}

/** `scripts/play.mjs`: `EDU_PLAY_SCRIPT`, else the first `scripts/play.mjs` found walking up from `start`. */
export function findPlayScript(env: NodeJS.ProcessEnv = process.env, start: string = __dirname): string {
  if (env.EDU_PLAY_SCRIPT) return path.resolve(env.EDU_PLAY_SCRIPT)
  let dir = start
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'scripts', 'play.mjs')
    if (existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return path.resolve(process.cwd(), 'scripts', 'play.mjs')
}

const argsOf = (p: Persona): string[] => ['--mode', p.mode, '--seed', String(p.seed), ...(p.accuracy !== undefined ? ['--accuracy', String(p.accuracy)] : []), ...(p.rounds !== undefined ? ['--rounds', String(p.rounds)] : [])]

function playOne(buildDir: string, p: Persona, o: Required<Pick<PlaytestOptions, 'playScript' | 'node' | 'timeoutMs'>> & { env: NodeJS.ProcessEnv; signal?: AbortSignal }): Promise<PersonaRun> {
  return new Promise((resolve) => {
    const run = (code: number, summary: BotSummary | null, extra: string[] = []): void => {
      const failures = [...(summary?.failures ?? []), ...extra]
      const errors = summary?.consoleErrors ?? 0
      if (errors > 0) failures.push(`${errors} console error(s) while playing`)
      resolve({ persona: p.id, mode: p.mode, code, ok: code === 0 && !!summary?.ok && errors === 0, summary, failures })
    }
    execFile(o.node, [o.playScript, buildDir, '--json', ...argsOf(p)], { maxBuffer: 16 * 1024 * 1024, timeout: o.timeoutMs, env: o.env, signal: o.signal }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : 1) : 0
      let summary: BotSummary | null = null
      try {
        summary = JSON.parse(stdout) as BotSummary
      } catch {
        /* no JSON: the bot did not get that far */
      }
      if (code === 3) return resolve({ persona: p.id, mode: p.mode, code, ok: false, summary, failures: [`cannot launch Chromium: ${stderr.split('\n')[0] ?? ''}`.trim()] })
      if (!summary) return run(code, null, [`the bot printed no result (exit ${code}): ${(stderr || stdout).slice(0, 300).trim()}`])
      run(code, summary)
    })
  })
}

/**
 * Plays `buildDir` (a folder made by `edu_build`) with the personas. Throws `ChromiumMissingError` when the bot cannot launch Chromium (exit 3).
 * A persona that fails is in the result (`ok: false`), it does not throw.
 */
export async function runPlaytest(buildDir: string, opts: PlaytestOptions = {}): Promise<PlaytestResult> {
  const started = Date.now()
  const env = { ...(opts.env ?? process.env) }
  if ((process.versions as { electron?: string }).electron) env.ELECTRON_RUN_AS_NODE = '1'
  const picked = (opts.personas ?? [...PERSONAS]).map((p) => (typeof p === 'string' ? PERSONAS.find((x) => x.id === p) : p))
  const unknown = (opts.personas ?? []).filter((p, i) => !picked[i]).map(String)
  if (unknown.length) throw new Error(`unknown persona(s): ${unknown.join(', ')} (known: ${PERSONAS.map((p) => p.id).join(', ')})`)
  const personas = picked as Persona[]
  const playScript = opts.playScript ?? findPlayScript(env)
  if (!existsSync(playScript)) throw new Error(`the autoplay bot script is not there: ${playScript}`)
  const shared = { playScript, node: opts.node ?? process.execPath, timeoutMs: opts.timeoutMs ?? 300_000, env, signal: opts.signal }
  const runs: PersonaRun[] = new Array<PersonaRun>(personas.length)
  let next = 0
  const worker = async (): Promise<void> => {
    for (let i = next++; i < personas.length; i = next++) runs[i] = await playOne(buildDir, personas[i]!, shared)
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 2, personas.length)) }, worker))
  const missing = runs.find((r) => r.code === 3)
  if (missing) throw new ChromiumMissingError(missing.failures[0]?.replace(/^cannot launch Chromium:\s*/, ''))
  const failures = runs.flatMap((r) => r.failures.map((f) => `${r.persona}: ${f}`))
  return { ok: runs.every((r) => r.ok), runs, failures, durationMs: Date.now() - started }
}

/** The runs as the text the playtester reads: one block per persona. */
export function playtestDigest(result: PlaytestResult): string {
  return result.runs
    .map((r) => {
      const s = r.summary
      if (!s) return `### ${r.persona}\nThe bot gave no result: ${r.failures.join('; ')}`
      return [
        `### ${r.persona} (${r.mode}${r.mode === 'random' ? `, seed ${s.seed}` : ''}): ${r.ok ? 'passed' : 'FAILED'}`,
        `steps ${s.steps} of at most ${s.maxSteps}, right ${s.correct}, wrong ${s.wrong}, finished: ${s.finished ? 'yes' : 'no'}, console errors ${s.consoleErrors}`,
        `screens seen: ${s.screens.join(', ')}`,
        ...(r.failures.length ? [`failures: ${r.failures.join('; ')}`] : [])
      ].join('\n')
    })
    .join('\n\n')
}
