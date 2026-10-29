import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import guideText from '../../../docs/mcp-guide.md?raw'
import { callTool, toolList } from './tools'
import type { Tool } from './tools'

/**
 * The MCP server object: `initialize`, `tools/list`, `tools/call` and the guide resource, on the SDK's `Server`. `http.ts` makes one per
 * HTTP session, `stdio.ts` one for the stdio transport. The tools drive the same service as the app and the CLI, so Claude Code (or
 * any agent) can see the courses and the queue and do the model work of the jobs.
 *
 *   claude mcp add --transport http edu-studio http://127.0.0.1:7463/mcp
 *   claude mcp add edu-studio -- yarn --cwd <repo> engine -- mcp
 */

export const SERVER_INFO = { name: 'edu-studio', version: '0.0.1' }
export const GUIDE_URI = 'edu-studio://guide'
export const GUIDE = guideText

/** The short workflow every client gets in `initialize`; the full guide is the resource `edu-studio://guide`. */
export const INSTRUCTIONS = `Edu Studio turns a topic into a playable educational game: a course (objectives, articles, items with answer keys, shells) that a self-contained web player plays, learning by retrieval practice and spaced repetition. Course workflow: edu_create_course (or edu_import_course from a folder) -> edu_course_edit (units with their prerequisites, objectives, shells, fact base) -> edu_item_add / edu_item_update / edu_item_remove (13 item kinds; ask each objective in two or more forms, give every wrong choice a why; every visible string is a key into a per-language text catalog, set with the item's text argument or edu_text_set, and a typed answer needs an accepted list per language) -> edu_validate -> edu_build (courses/<slug>/build/, opens from file://) -> edu_lint (errors fail it; its codes are in the guide) -> fix and repeat. edu_get_course reads the pack back, edu_list_courses lists the courses. The content pipeline and the generators arrive in later tickets (docs/design.md, ROADMAP.md). edu_status shows the job queue (of one course, with its course summary, or of all), edu_wait waits until a course has nothing left to run, edu_languages lists the course languages, edu_studios_status / edu_comfy_status / edu_voice_status check the generators (Pixel Studio, Chiptune Studio, Flow, ComfyUI), edu_pause_all / edu_resume_all / edu_stop_now / edu_clear_queue control the queue. Do the model work yourself: a role or agent set to the model client/claude-code (config/roles.md) parks its jobs; edu_wait then returns with clientTasks, and you loop edu_get_task -> write the answer -> edu_submit_task until none (edu_client_tasks lists them, edu_release_task gives one back; the guide has the details). Long calls return job ids at once. Read the resource ${GUIDE_URI} for the full guide.`

export interface McpHost {
  tools: readonly Tool[]
  /** Text of the guide resource (default: docs/mcp-guide.md). */
  guide?: string
  /** `instructions` of initialize (default: INSTRUCTIONS). */
  instructions?: string
}

export function createMcpServer(host: McpHost): Server {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {}, resources: {} }, instructions: host.instructions ?? INSTRUCTIONS })
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: toolList(host.tools) }))
  // each call is its own async handler, so a long `wait` never holds back the other calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => callTool(host.tools, request.params.name, request.params.arguments))
  server.setRequestHandler(ListResourcesRequestSchema, () => ({ resources: [{ uri: GUIDE_URI, name: 'Edu Studio guide', description: 'The workflow and the tools.', mimeType: 'text/markdown' }] }))
  server.setRequestHandler(ReadResourceRequestSchema, (request) => {
    if (request.params.uri !== GUIDE_URI) throw new Error(`Unknown resource ${request.params.uri}`)
    return { contents: [{ uri: GUIDE_URI, mimeType: 'text/markdown', text: host.guide ?? GUIDE }] }
  })
  return server
}
