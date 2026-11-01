import { readFile, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadMcpConfig } from '../src/engine/mcp/config'
import { McpController } from '../src/engine/mcp/controller'
import { acquireEngineLock } from '../src/engine/store/lock'
import type { EngineEvent } from '../src/shared/protocol'
import { makeEduEnv } from './edu-helpers'
import type { EduEnv } from './edu-helpers'

let env: EduEnv | undefined
afterEach(async () => {
  await env?.cleanup()
  env = undefined
})

const cfgFile = () => path.join(env!.dir, 'config', 'mcp.md')
const lockFile = () => path.join(env!.dir, 'engine.lock')
const writeCfg = (enabled: boolean, port: number, token = '') => writeFile(cfgFile(), `---\nkind: mcp\nenabled: ${enabled}\nport: ${port}\ntoken: "${token}"\n---\n# MCP\n`)
const statuses = () => env!.events.filter((e): e is Extract<EngineEvent, { type: 'mcp.status' }> => e.type === 'mcp.status')

describe('config/mcp.md', () => {
  it('is seeded with 7463 and no token, and the environment overrides the port and the token', async () => {
    env = await makeEduEnv()
    expect(await readFile(cfgFile(), 'utf8')).toMatch(/port: 7463/)
    expect(await loadMcpConfig(env.dir, {})).toEqual({ enabled: true, port: 7463, token: '' })
    expect(await loadMcpConfig(env.dir, { EDU_MCP_PORT: '7600', EDU_MCP_TOKEN: 'abc' })).toEqual({ enabled: true, port: 7600, token: 'abc' })
    expect(await loadMcpConfig(env.dir, { EDU_MCP_PORT: 'nope' })).toMatchObject({ port: 7463 })
    await writeFile(cfgFile(), 'broken: [')
    expect(await loadMcpConfig(env.dir, {})).toEqual({ enabled: true, port: 7463, token: '' })
    await rm(cfgFile())
    expect(await loadMcpConfig(env.dir, {})).toMatchObject({ enabled: true, port: 7463 })
  })
})

describe('MCP controller', () => {
  it('starts from the config, reloads when it changes and tells the lock where it listens', async () => {
    env = await makeEduEnv()
    await writeCfg(true, 0)
    const lock = await acquireEngineLock(env.dir)
    const mcp = new McpController({ dataDir: env.dir, svc: env.engine.edu, control: env.engine.mcpControl(), emit: (e) => env!.events.push(e), lock, env: {} })
    const first = await mcp.start()
    expect(first).toMatchObject({ enabled: true, listening: true, error: '', tokenSet: false })
    expect(first.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    expect(JSON.parse(await readFile(lockFile(), 'utf8'))).toMatchObject({ mcpUrl: first.url })

    // unchanged file: nothing restarts, the same url stays
    expect((await mcp.reload()).url).toBe(first.url)
    // a token appears: restarted with it
    await writeCfg(true, 0, 'tok')
    const withToken = await mcp.reload()
    expect(withToken).toMatchObject({ listening: true, tokenSet: true })
    // switched off: nothing listens, the lock has no url
    await writeCfg(false, 0, 'tok')
    expect(await mcp.reload()).toMatchObject({ enabled: false, listening: false, url: null })
    expect((JSON.parse(await readFile(lockFile(), 'utf8')) as { mcpUrl: string | null }).mcpUrl).toBeNull()
    // saved from Settings: the file is written (the token stays when none is given) and the server follows
    expect(await mcp.save({ enabled: true, port: 0 })).toMatchObject({ enabled: true, listening: true, tokenSet: true })
    expect(await readFile(cfgFile(), 'utf8')).toMatch(/token: tok/)
    expect((await mcp.save({ enabled: true, port: 0, token: '' })).tokenSet).toBe(false)
    expect(JSON.stringify(statuses())).not.toContain('"token"') // the token itself is never sent to the app
    await mcp.stop()
    expect(mcp.status().listening).toBe(false)
    await lock.release()

    // a failed bind is reported in the status, and the next reload tries again
    const blocker = net.createServer()
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', () => r()))
    const port = (blocker.address() as net.AddressInfo).port
    await writeCfg(true, port)
    const busy = new McpController({ dataDir: env.dir, svc: env.engine.edu, control: env.engine.mcpControl(), emit: () => undefined, env: {} })
    expect(await busy.start()).toMatchObject({ listening: false, error: `Port ${port} is already in use.` })
    await new Promise((r) => blocker.close(r))
    expect(await busy.reload()).toMatchObject({ listening: true, error: '' })
    await busy.stop()
  })
})
