import { z } from 'zod'
import type { EduService } from '../edu/service'
import type { Tool, ToolDef } from './tools'

/**
 * The media tools (EGS-15): the assets of a course (images now; the music and the voice of EGS-16 and EGS-17 use the same manifest, `course/assets.json`).
 * They write the manifest and then re-link the pack (`pack.assets`, the alt texts, `article.asset`, `item.asset`, `shells.config[*].art`), so a
 * course that was built before picks the change up with the next `edu_build`. Generation and planning are jobs in the queue (they take time and a
 * model): the tools return the job id, `edu_wait {slug}` waits for it.
 */

const slug = z.string().describe('The course slug (see edu_list_courses)')
const id = z.string().describe('The asset id, for example img-article-a-u1-1 (edu_asset_list shows them)')

export function mediaTools(svc: EduService, def: ToolDef): Tool[] {
  const relinked = async (s: string) => {
    const r = await svc.media.relink(s)
    return r ? { packLinked: true, assets: r.assets, links: r.links, next: 'edu_build {slug} makes the game with the change' } : { packLinked: false, note: 'the course has no pack yet: the next assemble links the assets' }
  }
  const one = async (s: string, assetId: string) => (await svc.media.list(s)).find((a) => a.id === assetId)

  return [
    def(
      'edu_asset_list',
      'The assets of a course (its images): for each the id, kind, what it illustrates (`target`), the selected version and how many versions there are, the file, whether only a PLACEHOLDER stands in (a real image could not be made: `placeholderReason`; `edu_lint` warns PLACEHOLDER_ASSET until it is replaced), the art-critic\'s review (`approved`, `pending`, `rejected` with its note), the prompt, the provider and the warnings of the version (for example Pixel Studio was down, so the built-in pixelate ran). `summary` counts the images, those made, the placeholders and the rejected ones. Asset ids come from what they illustrate: img-article-<articleId>, img-item-<itemId>, img-<shell>-<slot> (img-quiz-arena-bg-u1, img-rpg-hero ...).',
      z.object({ slug, kind: z.string().optional().describe('Only this kind: background, illustration, sprite, tileset') }),
      async (a) => ({ assets: await svc.media.list(a.slug, { kind: a.kind }), summary: await svc.media.summary(a.slug), settings: (await svc.media.settings(a.slug)).art })
    ),
    def(
      'edu_asset_plan',
      'Plan the pictures of a course (also a hand-made one): the art-director (a model job) decides which pictures the course needs: one for every encyclopedia article, the art of each shell (quiz arena backdrops per unit and for the boss, castle rooms, plates, RPG tiles and sprites), pictures of items where they help, and the picture of every hotspot item that has none (its regions are drawn faintly over it by code). The plan is written to pipeline/art.json and merged into the asset manifest (stable ids: a rerun keeps the versions already made; prompts set by hand and locked assets keep theirs). Returns the job id; edu_wait {slug}, then edu_asset_generate. `fallback: true` makes the plan from the course text now, with no model, and returns it. Nothing is generated here.',
      z.object({ slug, fallback: z.boolean().optional().describe('Plan from the course text with no model, at once') }),
      async (a) => {
        if (!(await svc.courseExists(a.slug))) throw new Error(`no course "${a.slug}"`)
        const media = await svc.media.settings(a.slug)
        if (!media.art.enabled) throw new Error('media.art.enabled is false for this course (edu_media_settings sets it)')
        if (a.fallback) {
          const r = await svc.media.planFromText(a.slug, await svc.media.artSourceFromPack(a.slug), media)
          return { planned: r.plan.entries.length, added: r.added, kept: r.kept, source: r.plan.source, ...(await relinked(a.slug)), plan: r.plan.entries.map((e) => ({ id: e.id, kind: e.kind, target: e.target, alt: e.alt })) }
        }
        const job = await svc.media.queue(a.slug, 'asset_plan', 'art-director', {}, 'plan the pictures')
        return { jobs: [job], next: 'edu_wait {slug} until the plan is done, then edu_asset_generate {slug}' }
      }
    ),
    def(
      'edu_asset_generate',
      'Make the images of a course: queues one job that makes every picture that has no file yet (`ids` for some, `kind` for one kind, `force` to make them again even when they have a version; locked and hand-made pictures are never touched). The providers: ComfyUI for pictures (ComfyUI is started first when config/autostart.md allows it), Pixel Studio for the pixel art of RPG tiles and sprites (the built-in pixelate when it is down, with a warning on the asset), Google Flow ONLY when the course sets media.art.provider: flow. A provider that is down does not fail the job: the asset gets a placeholder card and the report says why. Afterwards the pack is re-linked. Returns the job id; edu_wait {slug} waits, edu_asset_list shows the result.',
      z.object({ slug, ids: z.array(z.string()).optional().describe('Only these asset ids'), force: z.boolean().optional().describe('Make them again even when they have a version'), kind: z.string().optional().describe('Only this kind') }),
      async (a) => {
        if (!(await svc.courseExists(a.slug))) throw new Error(`no course "${a.slug}"`)
        if (!(await svc.media.settings(a.slug)).art.enabled) throw new Error('media.art.enabled is false for this course (edu_media_settings sets it)')
        if ((await svc.media.loadManifest(a.slug)).assets.length === 0) throw new Error('the course has no planned assets: edu_asset_plan {slug} first')
        const job = await svc.media.queue(a.slug, 'asset_generate', 'art-director', { ...(a.ids ? { ids: a.ids } : {}), ...(a.force ? { force: true } : {}), ...(a.kind ? { kind: a.kind } : {}) }, 'make the pictures')
        return { jobs: [job], next: 'edu_wait {slug}, then edu_asset_list {slug}' }
      }
    ),
    def(
      'edu_asset_set',
      'Change how one asset is made: `prompt` (the whole prompt: a prompt set by hand is kept when the art plan runs again), `negative` (what the picture must not have), `provider` (`comfy` or `flow`: this asset only; Flow makes the image only when you ask for it here or in the course settings). Then edu_asset_generate {ids: [id], force: true} makes it again.',
      z.object({ slug, id, prompt: z.string().min(1).optional(), negative: z.string().optional(), provider: z.enum(['comfy', 'flow']).optional() }),
      async (a) => {
        if (a.prompt === undefined && a.negative === undefined && a.provider === undefined) throw new Error('give prompt, negative or provider')
        await svc.media.setAsset(a.slug, a.id, { prompt: a.prompt, negative: a.negative, provider: a.provider })
        return { asset: await one(a.slug, a.id), next: 'edu_asset_generate {slug, ids: [id], force: true} makes the picture again' }
      }
    ),
    def(
      'edu_asset_select',
      'Make an earlier version of an asset the one the course uses (versions are never deleted: v1, v2 ...). The pack is re-linked.',
      z.object({ slug, id, version: z.number().int().positive().describe('The version number') }),
      async (a) => {
        await svc.media.selectVersion(a.slug, a.id, a.version)
        return { asset: await one(a.slug, a.id), ...(await relinked(a.slug)) }
      }
    ),
    def(
      'edu_asset_replace',
      'Use a file you made yourself as the asset (a png, jpg, webp, gif, avif or svg for an image; the file is copied as it is to assets/<id>/custom.<ext>). The asset becomes source: custom and locked, so the pipeline never makes it again, and a placeholder it had is removed. The pack is re-linked.',
      z.object({ slug, id, file: z.string().describe('The path of the file, on the machine that runs Edu Studio') }),
      async (a) => {
        await svc.media.replaceFile(a.slug, a.id, a.file)
        return { asset: await one(a.slug, a.id), ...(await relinked(a.slug)) }
      }
    ),
    def(
      'edu_asset_lock',
      'Lock or unlock an asset: a locked asset is never made again by a run or by edu_asset_generate (also not with force).',
      z.object({ slug, id, locked: z.boolean() }),
      async (a) => {
        await svc.media.setLocked(a.slug, a.id, a.locked)
        return { asset: await one(a.slug, a.id) }
      }
    ),
    def(
      'edu_media_settings',
      'Read, or change, the media settings of a course (course.md `media`: art, music, voice, sound; every field optional, a missing block gives the defaults). `set` is a JSON merge patch, for example {"art": {"provider": "flow"}} (Google Flow makes the images: free, but only used when you ask), {"art": {"enabled": false}} (no pictures), {"art": {"review": false}} (no art-critic), {"art": {"style": "pixel", "palette": "db32"}}. Defaults: art provider comfy, art enabled, the art-critic on (it needs a model with vision), RPG tiles and sprites through Pixel Studio.',
      z.object({ slug, set: z.record(z.string(), z.unknown()).optional().describe('A merge patch of the media block') }),
      async (a) => {
        if (a.set) {
          const r = await svc.media.setSettings(a.slug, a.set)
          return { media: r.media, stored: r.stored, next: 'edu_run_pipeline {slug, restart: true, from: "art"} (or edu_asset_plan / edu_asset_generate) makes the pictures with the new settings' }
        }
        if (!(await svc.courseExists(a.slug))) throw new Error(`no course "${a.slug}"`)
        return { media: await svc.media.settings(a.slug) }
      }
    )
  ]
}
