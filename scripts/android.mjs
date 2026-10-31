#!/usr/bin/env node
/**
 * Wraps a built course into an Android (Capacitor) project folder (EGS-19). Same code as the MCP tool edu_android_prepare, no engine needed.
 *
 *   node scripts/android.mjs <slug | course folder> [--data <dir>] [--app-id org.example.app] [--sync]
 *
 * <slug> is looked up in the data folder (--data, else EDU_DATA, else ~/EduGames); a path to a course folder works too. The course must be
 * built (yarn engine -- build <slug>). --sync also runs npm install and npx cap add/sync android in the generated folder.
 */
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const val = (n) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : undefined)
const words = args.filter((a, i) => !a.startsWith('--') && !['--data', '--app-id'].includes(args[i - 1]))
if (words.length !== 1) {
  console.error('usage: node scripts/android.mjs <slug | course folder> [--data <dir>] [--app-id org.example.app] [--sync]')
  process.exit(2)
}
const target = words[0]
const dataDir = path.resolve(val('data') ?? process.env.EDU_DATA ?? path.join(os.homedir(), 'EduGames'))
const isPath = target.includes('/') || target.includes(path.sep)
const courseDir = isPath ? path.resolve(target) : path.join(dataDir, 'courses', target)

const { tsImport } = await import('tsx/esm/api')
const { prepareAndroid } = await tsImport('../src/engine/android/generate.ts', import.meta.url)
const { syncAndroid } = await tsImport('../src/engine/android/sync.ts', import.meta.url)
try {
  const r = await prepareAndroid(courseDir, { slug: isPath ? undefined : target, appId: val('app-id') })
  console.log(`${r.slug}: Android project in ${r.dir} (appId ${r.appId}, ${r.wwwFiles} files in www/, icon: ${r.icon})`)
  if (args.includes('--sync')) {
    const steps = await syncAndroid(r.dir)
    for (const s of steps) console.log(`${s.ok ? 'ok  ' : 'FAIL'} ${s.step}\n${s.tail}`)
    if (steps.some((s) => !s.ok)) process.exit(1)
  } else console.log(`next: cd ${r.dir} and follow README.md`)
} catch (e) {
  console.error(`error: ${e.message}`)
  process.exit(1)
}
