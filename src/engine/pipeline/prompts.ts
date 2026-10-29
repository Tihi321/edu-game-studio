import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parseMd } from '../../shared/md'
import type { ChatMessage } from '../models/types'
import type { JobContext } from '../queue/scheduler'

/** Replaces `{{name}}` with the value. A name without a value becomes an empty string. */
export function render(template: string, vars: Record<string, string | number | undefined | null>): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_m, k: string) => {
    const v = vars[k]
    return v === undefined || v === null ? '' : String(v)
  })
}

export interface LoadedPrompt {
  /** The file as it is on disk (hashed into prompt_version). */
  raw: string
  /** The user message template: the file's text after the frontmatter. */
  body: string
}

export async function loadPrompt(dataDir: string, role: string, task: string): Promise<LoadedPrompt> {
  const file = path.join(dataDir, 'prompts', role, `${task}.md`)
  let raw: string
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch {
    throw new Error(`prompt template missing: prompts/${role}/${task}.md`)
  }
  return { raw, body: parseMd(raw, file).body.trim() }
}

export async function loadRules(dataDir: string): Promise<LoadedPrompt> {
  const file = path.join(dataDir, 'prompts', '_rules.md')
  try {
    const raw = await fs.readFile(file, 'utf8')
    return { raw, body: parseMd(raw, file).body.trim() }
  } catch {
    return { raw: '', body: 'Follow the task exactly. Do not invent story facts that are not in the book. Answer in the requested format only.' }
  }
}

/** Adds a block of extra instructions to the end of the user message. */
export function appendToPrompt(messages: ChatMessage[], text: string): void {
  const last = messages[messages.length - 1]
  if (!text || !last) return
  if (typeof last.content === 'string') last.content += `\n\n${text}`
  else last.content = [...last.content, { type: 'text', text: `\n\n${text}` }]
}

/**
 * Builds the two messages for a task: the system message is the shared rules plus the agent's persona,
 * the user message is the rendered template. Tells the scheduler which template text was used.
 */
export async function buildMessages(
  dataDir: string,
  ctx: JobContext,
  role: string,
  task: string,
  vars: Record<string, string | number | undefined | null>
): Promise<{ messages: ChatMessage[]; version: string }> {
  const [prompt, rules] = await Promise.all([loadPrompt(dataDir, role, task), loadRules(dataDir)])
  const version = ctx.usedTemplate(rules.raw + '\n' + prompt.raw)
  const system = `${rules.body}\n\n## Your persona\n${ctx.agent.persona.trim()}`
  return {
    version,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: render(prompt.body, vars) }
    ]
  }
}
