import { execFile } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'

/**
 * whisper.cpp for speaking practice (EGS-18). Nothing is installed or downloaded here: the binary and a ggml model come from the environment.
 *   EDU_WHISPER_DIR    a folder with `whisper-cli(.exe)` (also searched: bin/, build/bin/, build/bin/Release/) and, usually, a `models/` folder
 *   EDU_WHISPER_MODEL  a ggml model file, absolute or relative to EDU_WHISPER_DIR (and its models/); default: the first `ggml-*.bin` found
 *   EDU_WHISPER_CLI    an explicit path of the cli, instead of looking in the folder
 * A cli ending in `.js` or `.mjs` is run with node (the tests use a fake one).
 */

export interface WhisperSetup {
  cli: string
  model: string
}

export type WhisperLookup = { ok: true; setup: WhisperSetup } | { ok: false; reason: string }

const CLI_NAMES = process.platform === 'win32' ? ['whisper-cli.exe', 'whisper-cli'] : ['whisper-cli']
const CLI_SUBDIRS = ['', 'bin', path.join('build', 'bin'), path.join('build', 'bin', 'Release')]

const isFile = (p: string): boolean => {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

function findCli(dir: string): string | undefined {
  for (const sub of CLI_SUBDIRS) for (const name of CLI_NAMES) if (isFile(path.join(dir, sub, name))) return path.join(dir, sub, name)
  return undefined
}

function findModel(dir: string | undefined, wanted: string | undefined): string | undefined {
  if (wanted) {
    const candidates = path.isAbsolute(wanted) ? [wanted] : dir ? [path.resolve(dir, wanted), path.resolve(dir, 'models', wanted)] : []
    return candidates.find(isFile)
  }
  if (!dir) return undefined
  for (const d of [path.join(dir, 'models'), dir]) {
    try {
      const f = readdirSync(d)
        .filter((n) => /^ggml-.*\.bin$/i.test(n))
        .sort()[0]
      if (f) return path.join(d, f)
    } catch {
      // no such folder
    }
  }
  return undefined
}

/** Is whisper configured (an env var names the folder, the cli or the model)? */
export function whisperConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!(env.EDU_WHISPER_DIR || env.EDU_WHISPER_MODEL || env.EDU_WHISPER_CLI)
}

export function findWhisper(env: NodeJS.ProcessEnv = process.env): WhisperLookup {
  const dir = env.EDU_WHISPER_DIR || undefined
  const explicit = env.EDU_WHISPER_CLI || undefined
  const cli = explicit ? (isFile(explicit) ? explicit : undefined) : dir ? findCli(dir) : undefined
  if (!cli) return { ok: false, reason: explicit || dir ? 'whisper-cli was not found (check EDU_WHISPER_DIR / EDU_WHISPER_CLI)' : 'EDU_WHISPER_DIR is not set' }
  const model = findModel(dir, env.EDU_WHISPER_MODEL || undefined)
  if (!model) return { ok: false, reason: 'no ggml model was found (set EDU_WHISPER_MODEL, or put ggml-*.bin in EDU_WHISPER_DIR/models)' }
  return { ok: true, setup: { cli, model } }
}

/** The text of whisper-cli's stdout: timestamps and sound tags like [BLANK_AUDIO] or (music) removed, lines joined. */
export function parseWhisperText(stdout: string): string {
  return stdout
    .split(/\r?\n/)
    .map((l) =>
      l
        .replace(/^\s*\[[0-9:.]+\s*-->\s*[0-9:.]+\]\s*/, '')
        .replace(/\[[A-Z_ ]+\]/g, '')
        .replace(/\*[^*]*\*/g, '')
        .replace(/\((?:music|silence|noise|applause|laughter)[^)]*\)/gi, '')
        .trim()
    )
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** `hr`, `hr-HR`, `HR` -> `hr`; anything else -> `auto`. */
export function whisperLang(lang: string | undefined): string {
  const m = /^([a-z]{2,3})(?:[-_][A-Za-z0-9]+)?$/i.exec(lang ?? '')
  return m ? (m[1] as string).toLowerCase() : 'auto'
}

export function transcribeFile(setup: WhisperSetup, wavPath: string, lang: string | undefined, opts: { timeoutMs?: number } = {}): Promise<string> {
  const args = ['-nt', '-l', whisperLang(lang), '-f', wavPath, '-m', setup.model]
  const script = /\.m?js$/i.test(setup.cli)
  const file = script ? process.execPath : setup.cli
  return new Promise((resolve, reject) => {
    execFile(file, script ? [setup.cli, ...args] : args, { timeout: opts.timeoutMs ?? 60_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const killed = (err as { killed?: boolean }).killed
        return reject(new Error(killed ? 'whisper timed out' : `whisper failed: ${(stderr || err.message).toString().slice(0, 300)}`))
      }
      resolve(parseWhisperText(stdout))
    })
  })
}
