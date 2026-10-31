import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateCourse } from '../src/shared/edu/validate'
import type { CoursePack, TextCatalog } from '../src/shared/course'
import type { LiveQuestion } from '../src/shared/live'
import { loadCourseFolder } from '../src/engine/edu/course-io'

/** Shared by the live quiz tests (EGS-21). */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const LIVE_OUT = process.env.EDU_TEST_LIVE_OUT ? path.resolve(ROOT, process.env.EDU_TEST_LIVE_OUT) : path.join(ROOT, 'out', 'live')

export async function loadFixture(name: string): Promise<{ pack: CoursePack; catalogs: Record<string, TextCatalog> }> {
  const loaded = await loadCourseFolder(path.join(ROOT, 'tests', 'fixtures', 'courses', name))
  const r = validateCourse(loaded.pack, loaded.catalogs)
  if (!r.pack || !r.catalogs) throw new Error(`fixture ${name} does not validate: ${JSON.stringify(r.problems)}`)
  return { pack: r.pack, catalogs: r.catalogs }
}

/** A hand-made mcq with the options a and b; `answer` is the right one. */
export function fakeQuestion(id: string, answer = 'a'): LiveQuestion {
  return {
    itemId: `item-${id}`,
    unitId: 'u1',
    kind: 'mcq',
    prompt: `Prompt ${id}`,
    options: [
      { id: 'a', text: 'Option A' },
      { id: 'b', text: 'Option B' }
    ],
    multi: false,
    explanation: `Because ${id}`,
    correctIds: [answer],
    correctText: '',
    grade: (p) => {
      const o = (p as { option?: unknown } | null)?.option
      if (o !== 'a' && o !== 'b') return null
      return { correct: o === answer, picked: [o] }
    }
  }
}

/** A clock the test moves by hand. */
export function fakeClock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = start
  return { now: () => t, advance: (ms) => void (t += ms) }
}

/** A reader of a Server-Sent Events response: `next()` resolves with the next event (name and parsed data). */
export class SseReader {
  private buf = ''
  private readonly queue: { event: string; data: unknown }[] = []
  private waiters: ((e: { event: string; data: unknown }) => void)[] = []
  readonly controller = new AbortController()
  status = 0
  ended = false

  static async open(url: string): Promise<SseReader> {
    const r = new SseReader()
    const res = await fetch(url, { signal: r.controller.signal, headers: { Accept: 'text/event-stream' } })
    r.status = res.status
    if (res.status !== 200 || !res.body) {
      await res.body?.cancel()
      r.ended = true
      return r
    }
    void r.pump(res.body.getReader())
    return r
  }

  private async pump(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    const dec = new TextDecoder()
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        this.buf += dec.decode(value, { stream: true })
        let i: number
        while ((i = this.buf.indexOf('\n\n')) >= 0) {
          const block = this.buf.slice(0, i)
          this.buf = this.buf.slice(i + 2)
          let event = 'message'
          let data = ''
          for (const line of block.split('\n')) {
            if (line.startsWith('event: ')) event = line.slice(7)
            else if (line.startsWith('data: ')) data += line.slice(6)
          }
          if (data) this.push({ event, data: JSON.parse(data) })
        }
      }
    } catch {
      // aborted
    }
    this.ended = true
    for (const w of this.waiters) w({ event: 'end', data: null })
    this.waiters = []
  }

  private push(e: { event: string; data: unknown }): void {
    const w = this.waiters.shift()
    if (w) w(e)
    else this.queue.push(e)
  }

  next(timeoutMs = 5000): Promise<{ event: string; data: unknown }> {
    const q = this.queue.shift()
    if (q) return Promise.resolve(q)
    if (this.ended) return Promise.resolve({ event: 'end', data: null })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no event within the timeout')), timeoutMs)
      this.waiters.push((e) => {
        clearTimeout(timer)
        resolve(e)
      })
    })
  }

  /** Reads events until one is named `event` (earlier ones are dropped). */
  async until(event: string, timeoutMs = 5000): Promise<{ event: string; data: unknown }> {
    for (;;) {
      const e = await this.next(timeoutMs)
      if (e.event === event || e.event === 'end') return e
    }
  }

  close(): void {
    this.controller.abort()
  }
}
