import { describe, expect, it } from 'vitest'
import { mcpSnippets } from '../src/renderer/lib/mcp'
import { eduStore } from '../src/renderer/store/store'

describe('MCP settings state', () => {
  it('keeps the last mcp.status the engine sent', () => {
    expect(eduStore.getState().mcp).toBeNull()
    eduStore.getState().applyEvents([{ type: 'mcp.status', enabled: true, listening: true, url: 'http://127.0.0.1:7463/mcp', error: '', port: 7463, tokenSet: false }])
    expect(eduStore.getState().mcp).toMatchObject({ listening: true, port: 7463 })
    eduStore.getState().applyEvents([{ type: 'mcp.status', enabled: true, listening: false, url: null, error: 'Port 7463 is already in use.', port: 7463, tokenSet: true }])
    expect(eduStore.getState().mcp).toMatchObject({ listening: false, error: 'Port 7463 is already in use.', tokenSet: true })
  })

  it('builds the snippets', () => {
    const s = mcpSnippets('http://127.0.0.1:7463/mcp', false)
    expect(s.http).toBe('claude mcp add --transport http edu-studio http://127.0.0.1:7463/mcp')
    expect(mcpSnippets('http://127.0.0.1:7500/mcp', true).http).toMatch(/--header "Authorization: Bearer <token>"$/)
    expect(s.stdio).toMatch(/engine -- mcp$/)
    expect(s.headless).toMatch(/--mcp-only/)
  })
})
