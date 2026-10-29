import { mkdir, readFile, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { modelFor, patchCourseMeta, patchCourseModels, readCourseMeta } from '../src/engine/edu/course-meta'
import { parseMd } from '../src/shared/md'
import { makeEnv } from './helpers'
import type { TestEnv } from './helpers'
import { runInJob } from './research-helpers'

/** Two providers of two families: `loc` (family a, three models) and `oth` (family b). */
const makeModelEnv = () =>
  makeEnv({
    providers: [
      { id: 'loc', local: true, concurrency: 4, family: 'a', models: ['m1', 'm2', 'm3'] },
      { id: 'oth', local: true, concurrency: 4, family: 'b', models: ['x1'] }
    ],
    roles: { researcher: ['loc/m1'], 'item-writer': ['loc/m1'], 'fact-checker': ['loc/m1', 'oth/x1'] },
    agents: [
      { role: 'researcher', name: 'Plain' },
      { role: 'item-writer', name: 'Own', model: 'loc/m2' },
      { role: 'fact-checker', name: 'Checker' }
    ]
  })

/** The model the mock saw for the last request, after `ctx.chat` ran inside a job of `role` for `book`. */
async function modelUsed(env: TestEnv, role: string, job: { book?: string; avoid_family?: string }): Promise<string> {
  await runInJob(env, role, (ctx) => ctx.chat({ messages: [{ role: 'user', content: 'hi' }], maxTokens: 20 }), job)
  return env.mock.calls[env.mock.calls.length - 1]!.model
}

describe('the course models of course.md', () => {
  it('courseModel answers from course.md: the role, else "*", else nothing; a write through the service refreshes it', async () => {
    const env = await makeModelEnv()
    try {
      const edu = env.engine.edu
      expect(edu.courseModel('rome', 'researcher')).toBeUndefined() // no course.md
      expect(edu.courseModel('Not A Slug!', 'researcher')).toBeUndefined() // not a course slug: no throw
      await edu.setCourseModels('rome', { researcher: 'loc/m3' })
      expect(edu.courseModel('rome', 'researcher')).toBe('loc/m3')
      expect(edu.courseModel('rome', 'item-writer')).toBeUndefined()
      await edu.setCourseModels('rome', { '*': 'oth/x1' })
      expect(edu.courseModel('rome', 'item-writer')).toBe('oth/x1') // "*" applies to every role ...
      expect(edu.courseModel('rome', 'fact-checker')).toBe('oth/x1')
      expect(edu.courseModel('rome', 'researcher')).toBe('loc/m3') // ... a role's own entry wins over it
      expect(edu.courseModel('greece', 'researcher')).toBeUndefined() // another course
      await edu.setCourseModels('rome', { researcher: null, '*': null })
      expect(edu.courseModel('rome', 'researcher')).toBeUndefined()
      const meta = await readCourseMeta(env.dir, 'rome')
      expect(meta!.data).toMatchObject({ kind: 'course', models: {} })
      // running jobs are told when the models changed (and only then)
      const changed = vi.spyOn(env.engine.scheduler, 'changeModel')
      await edu.setCourseModels('rome', { researcher: 'loc/m2' })
      expect(changed).toHaveBeenCalledTimes(1)
      await edu.setCourseModels('rome', { researcher: 'loc/m2' })
      expect(changed).toHaveBeenCalledTimes(1)
      await edu.setCourseMeta('rome', { stage: 'running' })
      expect(changed).toHaveBeenCalledTimes(1)
      expect(modelFor({ '*': 'a/b', writer: 'c/d' }, 'writer')).toBe('c/d')
      expect(modelFor({ '*': 'a/b' }, 'writer')).toBe('a/b')
      expect(modelFor({}, 'writer')).toBeUndefined()
    } finally {
      await env.cleanup()
    }
  })

  it('a role with a course model uses it before the agent\'s model and the role list; a course without one is not affected', async () => {
    const env = await makeModelEnv()
    try {
      // no course model: the agent's own model (m2) before the role's list (m1); the plain agent uses the role list
      expect(await modelUsed(env, 'item-writer', { book: 'rome' })).toBe('m2')
      expect(await modelUsed(env, 'researcher', { book: 'rome' })).toBe('m1')
      await env.engine.edu.setCourseModels('rome', { 'item-writer': 'loc/m3', researcher: 'loc/m3' })
      expect(await modelUsed(env, 'item-writer', { book: 'rome' })).toBe('m3') // the course before the agent
      expect(await modelUsed(env, 'researcher', { book: 'rome' })).toBe('m3') // the course before the role list
      expect(await modelUsed(env, 'item-writer', { book: 'greece' })).toBe('m2') // another course keeps the agent's
      expect(await modelUsed(env, 'item-writer', {})).toBe('m2') // a job with no course
      // the router orders: course, agent, role list
      const order = env.engine.router.candidates('item-writer', { projectModel: env.engine.edu.courseModel('rome', 'item-writer'), agentModel: 'loc/m2' }).map((m) => m.ref)
      expect(order).toEqual(['loc/m3', 'loc/m2', 'loc/m1'])
    } finally {
      await env.cleanup()
    }
  })

  it('"*" applies to every role of the course; a reviewer job with avoid_family gets a different family first unless the course chose its model', async () => {
    const env = await makeModelEnv()
    try {
      // the role list is loc/m1 (family a) then oth/x1 (family b): a reviewer of content written by family a gets family b first
      expect(await modelUsed(env, 'fact-checker', { book: 'rome', avoid_family: 'a' })).toBe('x1')
      expect(await modelUsed(env, 'fact-checker', { book: 'rome' })).toBe('m1')
      // the course names a model for the writer role only: the reviewer is not affected
      await env.engine.edu.setCourseModels('rome', { 'item-writer': 'loc/m3' })
      expect(await modelUsed(env, 'fact-checker', { book: 'rome', avoid_family: 'a' })).toBe('x1')
      // "*" reaches the reviewer, and a model the course chose on purpose stays first, as an agent's own model does
      await env.engine.edu.setCourseModels('rome', { '*': 'loc/m3' })
      expect(await modelUsed(env, 'fact-checker', { book: 'rome', avoid_family: 'a' })).toBe('m3')
      expect(await modelUsed(env, 'researcher', { book: 'rome' })).toBe('m3')
      // the fallbacks after it still avoid the family: the list is course, then the other family, then the avoided one
      const list = env.engine.router.candidates('fact-checker', { projectModel: 'loc/m3', avoidFamily: 'a' }).map((m) => m.ref)
      expect(list).toEqual(['loc/m3', 'oth/x1', 'loc/m1'])
    } finally {
      await env.cleanup()
    }
  })

  it('a hand edit of course.md (or a write by the CLI) takes effect without a restart, and a broken file is ignored until it parses', async () => {
    const env = await makeModelEnv()
    try {
      const file = path.join(env.dir, 'courses', 'rome', 'course.md')
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, '---\nkind: course\nmodels:\n  researcher: loc/m2\n---\nMy notes.\n')
      expect(env.engine.edu.courseModel('rome', 'researcher')).toBe('loc/m2')
      await writeFile(file, '---\nkind: course\nmodels:\n  researcher: loc/m3\n---\nMy notes.\n')
      await utimes(file, new Date(Date.now() + 5000), new Date(Date.now() + 5000)) // a later modification time, whatever the file system's resolution
      expect(env.engine.edu.courseModel('rome', 'researcher')).toBe('loc/m3')
      await writeFile(file, '---\nmodels: [unclosed\n---\n')
      await utimes(file, new Date(Date.now() + 10_000), new Date(Date.now() + 10_000))
      expect(env.engine.edu.courseModel('rome', 'researcher')).toBeUndefined()
      expect(env.logs.filter((l) => /course\.md/.test(l) && /ignored/.test(l))).toHaveLength(1) // said once, not at every request
      expect(env.engine.edu.courseModel('rome', 'researcher')).toBeUndefined()
      expect(env.logs.filter((l) => /ignored/.test(l))).toHaveLength(1)
      // warm() (start) reads the course models of every course folder
      await writeFile(file, '---\nkind: course\nmodels:\n  "*": oth/x1\n---\n')
      await utimes(file, new Date(Date.now() + 15_000), new Date(Date.now() + 15_000))
      await env.engine.edu.warm()
      expect(env.engine.edu.courseModel('rome', 'anything')).toBe('oth/x1')
    } finally {
      await env.cleanup()
    }
  })
})

describe('course.md helpers', () => {
  it('patching keeps the other fields, the body and the notes of your own; null removes a field; writes in a row do not lose each other', async () => {
    const env = await makeModelEnv()
    try {
      const file = path.join(env.dir, 'courses', 'rome', 'course.md')
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, '---\nkind: course\nstage: draft\nbrief:\n  topic: Ancient Rome\nmy_note: keep me\n---\n# Run log\n\nstarted\n')
      await patchCourseMeta(env.dir, 'rome', { stage: 'running', run: 2 })
      await patchCourseMeta(env.dir, 'rome', { my_note: null }, { body: (old) => old + 'next line\n' })
      const doc = parseMd(await readFile(file, 'utf8'))
      expect(doc.data).toEqual({ kind: 'course', stage: 'running', brief: { topic: 'Ancient Rome' }, run: 2 })
      expect(doc.body).toBe('# Run log\n\nstarted\nnext line\n')
      // many writes at once, each setting one role
      await Promise.all(['researcher', 'item-writer', 'fact-checker', 'explainer'].map((role) => patchCourseModels(env.dir, 'rome', { [role]: `loc/${role.length}` })))
      const models = (await readCourseMeta(env.dir, 'rome'))!.data.models
      expect(Object.keys(models).sort()).toEqual(['explainer', 'fact-checker', 'item-writer', 'researcher'])
      expect((await readCourseMeta(env.dir, 'rome'))!.data).toMatchObject({ stage: 'running', run: 2, brief: { topic: 'Ancient Rome' } })
      expect(await readCourseMeta(env.dir, 'nothing-here')).toBeNull()
      // a course.md is created when there is none
      await patchCourseMeta(env.dir, 'newcourse', { stage: 'draft' })
      expect((await readCourseMeta(env.dir, 'newcourse'))!.data).toMatchObject({ kind: 'course', stage: 'draft', models: {} })
      // the folder with a course.md is a course
      expect((await env.engine.edu.listCourses()).map((c) => c.slug)).toEqual(expect.arrayContaining(['rome', 'newcourse']))
    } finally {
      await env.cleanup()
    }
  })
})
