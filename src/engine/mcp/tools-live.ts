import { randomInt } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { validateCourse } from '../../shared/edu/validate'
import { selectQuestions } from '../../shared/live'
import { defaultLangOf, buildDirOf, GAME_DATA_FILE } from '../edu/build'
import { loadCourseFolder } from '../edu/course-io'
import { assertSlug, coursesDir } from '../edu/paths'
import type { EduService } from '../edu/service'
import { findLiveClient } from '../live/client-files'
import { startLiveServer, type LiveHandle } from '../live/server'
import type { Tool, ToolDef } from './tools'

/**
 * The live quiz tools (EGS-21): start a room for a built course, look at the rooms, stop one. The room runs inside the engine (one small http
 * server per room); players and the teacher use the URLs the start tool returns. See docs/live-quiz.md.
 */

const rooms = new WeakMap<EduService, Map<string, LiveHandle>>()
const roomsOf = (svc: EduService): Map<string, LiveHandle> => {
  let m = rooms.get(svc)
  if (!m) rooms.set(svc, (m = new Map()))
  return m
}

const LAN_WARNING = 'LAN mode is on: anyone on the same network who has the address and the join code can join this quiz. Share the code only with your class and stop the room (edu_live_stop) when you are done.'

function summary(h: LiveHandle, withHost: boolean): Record<string, unknown> {
  const v = h.room.hostView()
  return {
    roomId: h.roomId,
    code: h.code,
    phase: v.phase,
    port: h.port,
    lan: h.lan,
    playerUrls: h.playerUrls,
    ...(withHost ? { hostUrl: h.hostUrl } : {}),
    players: v.roster.length,
    connected: v.connected,
    questionIndex: v.questionIndex,
    questionCount: v.questionCount,
    answered: v.answered,
    ...(h.closedReason ? { closedReason: h.closedReason } : {})
  }
}

export function liveTools(svc: EduService, def: ToolDef): Tool[] {
  const open = roomsOf(svc)
  const find = (roomId: string): LiveHandle => {
    const h = open.get(roomId)
    if (!h) throw new Error(`no live room "${roomId}" (edu_live_status lists the rooms)`)
    return h
  }
  return [
    def(
      'edu_live_start',
      'Start a Kahoot-style LIVE QUIZ for a built course. The room runs in the engine; players open a URL, enter the join code and a nickname, and answer the same questions at once (points depend on speed and correctness; leaderboard between questions, podium at the end, the explanation after each question). Questions are the course items of kind mcq, true-false, multi-select and typed, balanced over the units. Returns {roomId, code, hostUrl, playerUrls, port}: give the teacher hostUrl (a page with Start, Next, End question, Kick and Close buttons; it is secret, anyone with it controls the room) and the players one of playerUrls plus the code. By default the room listens on 127.0.0.1 only; lan: true listens on the whole network, so anyone on it can join. The room closes after 2 hours or 10 minutes without a connection. The course must be built (edu_build).',
      z.object({
        slug: z.string().describe('The course slug (see edu_list_courses)'),
        questions: z.number().int().min(1).max(50).optional().describe('How many questions (default 10; fewer when the course has fewer usable items)'),
        secondsPerQuestion: z.number().int().min(5).max(120).optional().describe('Seconds to answer each question (default 20)'),
        lan: z.boolean().optional().describe('Listen on the local network, not only on this machine (default false). Anyone on the network can then join.'),
        lang: z.string().optional().describe('The edition (language) of the course the quiz is in (default: the course default)')
      }),
      async (a) => {
        const slug = assertSlug(a.slug)
        const root = path.join(coursesDir(svc.dataDir), slug)
        if (!(await fs.stat(path.join(root, 'course', 'pack.json')).then(() => true, () => false))) throw new Error(`no course "${slug}"`)
        if (!(await fs.stat(path.join(buildDirOf(root), GAME_DATA_FILE)).then(() => true, () => false))) throw new Error(`the course "${slug}" is not built: run edu_build {slug} first`)
        const loaded = await loadCourseFolder(root)
        const checked = validateCourse(loaded.pack, loaded.catalogs)
        if (!checked.pack || !checked.catalogs) throw new Error(`the course "${slug}" has problems (edu_validate {slug}); fix them first`)
        const pack = checked.pack
        const lang = a.lang ?? defaultLangOf(pack)
        if (!pack.languages.includes(lang)) throw new Error(`the course has no "${lang}" edition (editions: ${pack.languages.join(', ')})`)
        const want = a.questions ?? 10
        const questions = selectQuestions(pack, checked.catalogs, lang, { count: want, seed: randomInt(0, 2 ** 31) })
        if (questions.length === 0) throw new Error('the course has no mcq, true-false, multi-select or typed items that exist in this edition')
        const client = findLiveClient()
        const h = await startLiveServer({
          questions,
          secondsPerQuestion: a.secondsPerQuestion ?? 20,
          lang,
          title: pack.subject,
          ...(a.lan ? { lan: true } : {}),
          client,
          onClosed: () => void 0
        })
        open.set(h.roomId, h)
        const notes = [
          questions.length < want ? `only ${questions.length} usable questions exist (asked for ${want})` : undefined,
          h.lan ? LAN_WARNING : 'The room listens on 127.0.0.1 only: only this machine can join. Use lan: true for phones.',
          h.lan && h.playerUrls.every((u) => u.includes('127.0.0.1')) ? 'No network address was found: the room is up, but check this machine\'s network connection.' : undefined
        ].filter((n): n is string => n !== undefined)
        return { ...summary(h, true), course: slug, lang, questions: questions.length, secondsPerQuestion: a.secondsPerQuestion ?? 20, notes }
      }
    ),
    def(
      'edu_live_status',
      'The live quiz rooms: with roomId, one room (phase, players, how many answered, the join code, the player URLs); without, all rooms of this engine, closed ones included until the engine restarts. The host URL is not repeated here: it was returned by edu_live_start.',
      z.object({ roomId: z.string().optional() }),
      async (a) => {
        if (a.roomId) return summary(find(a.roomId), false)
        return { rooms: [...open.values()].map((h) => summary(h, false)) }
      }
    ),
    def(
      'edu_live_stop',
      'Stop a live quiz room: players see that the quiz is over and the server shuts down. The final scores are returned.',
      z.object({ roomId: z.string() }),
      async (a) => {
        const h = find(a.roomId)
        const v = h.room.hostView()
        const scores = h.room.standings().map((r) => ({ rank: r.rank, nickname: r.nickname, score: r.score }))
        await h.close('stopped by edu_live_stop')
        return { stopped: true, roomId: h.roomId, phase: h.room.phase, players: v.roster.length, scores }
      }
    )
  ]
}
