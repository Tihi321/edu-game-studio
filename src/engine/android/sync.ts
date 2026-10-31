import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

/** The optional toolchain step of `edu_android_prepare {sync: true}`: npm install, then `cap add android` (once) or `cap sync android`. */

export interface SyncStep {
  step: string
  ok: boolean
  /** The last lines of stdout and stderr. */
  tail: string
}

const tail = (s: string, n = 25): string => s.trimEnd().split(/\r?\n/).slice(-n).join('\n')

function run(file: string, args: string[], cwd: string, timeoutMs: number): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    // npm and npx are .cmd files on Windows: they need a shell there (the arguments are fixed, never user input)
    execFile(file, args, { cwd, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, shell: process.platform === 'win32', windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: `${stdout}\n${stderr}${err && !stdout && !stderr ? String(err.message) : ''}` })
    })
  })
}

export async function syncAndroid(dir: string, opts: { timeoutMs?: number } = {}): Promise<SyncStep[]> {
  const timeoutMs = opts.timeoutMs ?? 20 * 60_000
  const steps: SyncStep[] = []
  const go = async (step: string, file: string, args: string[]): Promise<boolean> => {
    const r = await run(file, args, dir, timeoutMs)
    steps.push({ step, ok: r.ok, tail: tail(r.out) })
    return r.ok
  }
  if (!(await go('npm install', 'npm', ['install', '--no-audit', '--no-fund']))) return steps
  const native = await fs.stat(path.join(dir, 'android')).then((s) => s.isDirectory(), () => false)
  await go(native ? 'npx cap sync android' : 'npx cap add android', 'npx', native ? ['cap', 'sync', 'android'] : ['cap', 'add', 'android'])
  return steps
}
