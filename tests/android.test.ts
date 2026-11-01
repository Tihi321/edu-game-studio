import { cp, readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { appIdFor, safeSegment } from '../src/engine/android/app-id'
import { prepareAndroid } from '../src/engine/android/generate'
import { buildCourse } from '../src/engine/edu/build'
import { buildTools, callTool, type Tool } from '../src/engine/mcp/tools'
import { fakeBundle, copyFixture, tmp, useTemp } from './edu-build-helpers'
import { makeEduEnv, type EduEnv } from './edu-helpers'
import { FIXTURES } from './edu-fixtures'

useTemp()

async function files(dir: string, base = dir): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...(await files(p, base)))
    else out.push(path.relative(base, p).split(path.sep).join('/'))
  }
  return out.sort()
}

async function builtCourse(): Promise<{ root: string; build: string }> {
  const { root } = await copyFixture('solar-system')
  const build = path.join(root, 'build')
  const res = await buildCourse(root, build, { playerDir: await fakeBundle() })
  expect(res.ok).toBe(true)
  return { root, build }
}

describe('the Android application id', () => {
  it('makes a valid package segment from any slug', () => {
    expect(appIdFor('solar-system')).toBe('org.edustudio.solar_system')
    expect(safeSegment('2024-history')).toBe('c2024_history') // a segment never starts with a digit
    expect(safeSegment('Rimsko Carstvo')).toBe('rimsko_carstvo')
    expect(safeSegment('Čovjek i šuma')).toBe('covjek_i_suma') // diacritics
    expect(safeSegment('---')).toBe('course') // nothing left
    expect(safeSegment('class')).toBe('class_app') // reserved word
    expect(safeSegment('new')).toBe('new_app')
    expect(safeSegment('a--b__c')).toBe('a_b_c')
  })
})

describe('prepareAndroid', () => {
  it('writes the project from the built solar-system fixture', async () => {
    const { root, build } = await builtCourse()
    const r = await prepareAndroid(root)
    const dir = path.join(root, 'android')
    expect(r.dir).toBe(dir)
    expect(r.appId).toBe('org.edustudio.solar_system')
    expect(r.icon).toBe('generated')
    for (const f of ['package.json', 'capacitor.config.json', 'scripts/gradle.mjs', 'README.md', '.gitignore', 'keystore.properties.example', 'resources/icon.png', 'resources/splash.png', 'www/index.html']) {
      expect((await stat(path.join(dir, f))).isFile(), f).toBe(true)
    }
    const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8')) as { scripts: Record<string, string>; dependencies: Record<string, string>; devDependencies: Record<string, string> }
    expect(Object.keys(pkg.scripts)).toEqual(['android:sync', 'android:apk', 'android:bundle', 'android:run'])
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['@capacitor/android', '@capacitor/core'])
    expect(pkg.devDependencies['@capacitor/cli']).toMatch(/^\^8\./)
    const cfg = JSON.parse(await readFile(path.join(dir, 'capacitor.config.json'), 'utf8')) as Record<string, string>
    expect(cfg).toEqual({ appId: 'org.edustudio.solar_system', appName: r.title, webDir: 'www' })
    expect(r.title.length).toBeGreaterThan(0)
    expect(await readFile(path.join(dir, '.gitignore'), 'utf8')).toMatch(/keystore\.properties/)
    expect(await readFile(path.join(dir, 'README.md'), 'utf8')).toMatch(/npx cap add android/)
    const icon = await sharp(path.join(dir, 'resources', 'icon.png')).metadata()
    expect([icon.width, icon.height]).toEqual([1024, 1024])
    // the gradle script knows no personal path and no keystore
    const gradle = await readFile(path.join(dir, 'scripts', 'gradle.mjs'), 'utf8')
    expect(gradle).toMatch(/JAVA_HOME/)
    expect(gradle).toMatch(/ANDROID_HOME/)
    expect(gradle).toMatch(/ANDROID_SDK_ROOT/)
    expect(gradle).not.toMatch(/Users[\\/]/)
    // www is the build (and nothing else)
    expect(await files(path.join(dir, 'www'))).toEqual(await files(build))
    expect(r.wwwFiles).toBe((await files(build)).length)
  })

  it('refuses an unbuilt course and a bad app id, writing nothing', async () => {
    const { root } = await copyFixture('solar-system')
    await expect(prepareAndroid(root)).rejects.toThrow(/not built/)
    expect(await stat(path.join(root, 'android')).catch(() => null)).toBeNull()
    const built = await builtCourse()
    await expect(prepareAndroid(built.root, { appId: 'org.example.class' })).rejects.toThrow(/reserved/)
    expect(await stat(path.join(built.root, 'android')).catch(() => null)).toBeNull()
  })
})

describe('the edu_android_prepare tool', () => {
  let env: EduEnv
  let tools: Tool[]
  let oldBundle: string | undefined
  beforeAll(async () => {
    oldBundle = process.env.EDU_PLAYER_DIR
    process.env.EDU_PLAYER_DIR = await fakeBundle()
    env = await makeEduEnv()
    tools = buildTools(env.engine.edu, { control: env.engine.mcpControl(), clientQueue: env.engine.clientQueue })
  })
  afterAll(async () => {
    if (oldBundle === undefined) delete process.env.EDU_PLAYER_DIR
    else process.env.EDU_PLAYER_DIR = oldBundle
    await env.cleanup()
  })

  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await callTool(tools, name, args)
    return { ok: !r.isError, text: r.content[0].text, data: r.structuredContent as Record<string, unknown> }
  }

  it('prepares a built course (no sync by default) and refuses a bad appId', async () => {
    await cp(path.join(FIXTURES, 'solar-system'), path.join(env.dir, 'courses', 'solar'), { recursive: true })
    expect((await call('edu_build', { slug: 'solar' })).ok).toBe(true)
    const bad = await call('edu_android_prepare', { slug: 'solar', appId: 'bad' })
    expect(bad.ok).toBe(false)
    expect(bad.text).toMatch(/invalid appId/)
    const r = await call('edu_android_prepare', { slug: 'solar' })
    expect(r.ok, r.text).toBe(true)
    expect(r.data.appId).toBe('org.edustudio.solar')
    expect(r.data.sync).toBeUndefined()
    expect((await stat(path.join(env.dir, 'courses', 'solar', 'android', 'www', 'index.html'))).isFile()).toBe(true)
    expect(await tmp()).toBeTruthy()
  })
})
