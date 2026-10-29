import { z } from 'zod'
import { langSchema } from '../../shared/media'
import type { EduService } from '../edu/service'
import type { Tool, ToolDef } from './tools'

/**
 * The course tools (EGS-03): create, read, edit, add items, set text, import, validate, build and lint. They work on the files of the data
 * folder through `svc.courses` (the same code as the CLI). Writes are atomic and a change that makes the course structurally invalid
 * (schema, unknown ids, duplicate ids) is refused and nothing is written; texts still to write show up as `pending`.
 */

const slug = z.string().describe('The course slug (see edu_list_courses)')
const textPatch = z
  .record(
    langSchema,
    z.object({
      strings: z.record(z.string(), z.string()).optional().describe('key -> text'),
      accepted: z.record(z.string(), z.array(z.string().min(1)).min(1)).optional().describe('key -> accepted answers of a typed gap or word (first = canonical)')
    })
  )
  .optional()
  .describe('Texts to set in the same write: { "<lang>": { strings: {key: text}, accepted: {key: [answers]} } }')
const jsonObject = z.record(z.string(), z.unknown())

export function courseTools(svc: EduService, def: ToolDef): Tool[] {
  return [
    def(
      'edu_create_course',
      'Create a course: courses/<slug>/course/pack.json with one unit (u1) and one objective (u1-o1), and a text catalog per language. The course title is the string "course.title" of each catalog. Then add units, objectives and items.',
      z.object({
        slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'lower-case letters, digits and -').describe('Folder name and course id, for example solar-system'),
        title: z.string().min(1).describe('The course title (written into every edition; translate it with edu_text_set)'),
        languages: z.array(langSchema).min(1).describe('The editions (UI languages), for example ["en", "hr"]'),
        sourceLang: langSchema.describe('The language the course is written in; one of languages'),
        subject: z.string().min(1).describe('What the course teaches'),
        audience: z.string().min(1).describe('Who it is for'),
        targetLang: langSchema.optional().describe('A language course: the language that is taught. Its catalog holds the taught phrases and their accepted answers'),
        cefr: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).optional()
      }),
      (a) => svc.courses.create(a)
    ),
    def(
      'edu_get_course',
      'Read a course: the pack (units, objectives with their prerequisite graph, items, shells, assets, fact base), counts per item kind and the build state. text: true adds every text catalog, lang adds one.',
      z.object({ slug, text: z.boolean().optional().describe('Include all text catalogs'), lang: z.string().optional().describe('Include only this language\'s catalog') }),
      (a) => svc.courses.get(a.slug, { text: a.text, lang: a.lang })
    ),
    def(
      'edu_course_edit',
      'Change the pack with a JSON merge patch (RFC 7396: objects merge, null deletes a key, an array REPLACES the whole array, so send the full units / objectives / factbase list). Editable fields: sourceLang, languages, targetLang, subject, audience, cefr, matching, units, objectives, shells, assets, cues, encyclopedia, factbase, extensions. Items have their own tools. Pass `text` to write the strings the change needs in the same call. A result with a schema or reference problem (unknown unit, duplicate id ...) is refused and nothing is written; missing texts are listed as pending.',
      z.object({ slug, patch: jsonObject.describe('The merge patch, for example {"units": [...], "shells": {"enabled": ["quiz-arena"]}}'), text: textPatch }),
      (a) => svc.courses.edit(a.slug, a.patch, a.text)
    ),
    def(
      'edu_item_add',
      'Add an item (any kind: mcq, true-false, multi-select, cloze, typed, match-pairs, order, sort-groups, hotspot, listening, flashcard, crossword, word-search; the guide has each shape). The item is parsed by its kind\'s schema (defaults filled) and refused when it does not fit or points to an unknown objective, asset or option. Every text is a key: pass `text` to write the strings (and accepted answers) in the same call. Ask each fact in two or more forms and give every wrong choice a `why`.',
      z.object({ slug, item: jsonObject.describe('The full item: id, kind, objective, prompt, explanation, and the kind\'s fields'), text: textPatch }),
      (a) => svc.courses.itemAdd(a.slug, a.item, a.text)
    ),
    def(
      'edu_item_update',
      'Change an item with a JSON merge patch (arrays replace whole arrays). The id cannot change. `text` sets strings in the same call.',
      z.object({ slug, id: z.string().describe('The item id'), patch: jsonObject, text: textPatch }),
      (a) => svc.courses.itemUpdate(a.slug, a.id, a.patch, a.text)
    ),
    def('edu_item_remove', 'Remove an item by id (its texts stay in the catalogs).', z.object({ slug, id: z.string().describe('The item id') }), (a) => svc.courses.itemRemove(a.slug, a.id)),
    def(
      'edu_text_set',
      'Set strings and accepted answers in one language catalog (course/text/<lang>.json), and optionally remove keys. The language must be an edition or the target language of the course. Every visible string of a course is a key into the catalog; a typed answer needs an `accepted` list per language.',
      z.object({
        slug,
        lang: langSchema,
        strings: z.record(z.string(), z.string()).optional(),
        accepted: z.record(z.string(), z.array(z.string().min(1)).min(1)).optional(),
        remove: z.array(z.string()).optional().describe('Keys to delete (string and accepted list)')
      }),
      (a) => svc.courses.textSet(a.slug, a.lang, { strings: a.strings, accepted: a.accepted, remove: a.remove })
    ),
    def(
      'edu_import_course',
      'Copy a course folder from disk into the data folder (courses/<slug>/course). The folder holds course/pack.json (or is the course/ folder itself: pack.json, text/, assets/). The slug defaults to the pack\'s. Refuses to replace an existing course unless overwrite is true. Returns the validation result.',
      z.object({ folder: z.string().describe('Path of the course folder on the machine that runs Edu Studio'), slug: z.string().optional(), overwrite: z.boolean().optional() }),
      (a) => svc.courses.importCourse(a.folder, { slug: a.slug, overwrite: a.overwrite })
    ),
    def('edu_validate', 'Validate a course: schema, references, text keys in every edition, puzzles, asset files. The pedagogy checks are edu_lint.', z.object({ slug }), (a) => svc.courses.validate(a.slug)),
    def(
      'edu_build',
      'Build a course into courses/<slug>/build/: index.html, player.js, player.css, game-data.json, game-data.js and the assets. The folder works over file:// (open index.html). A course with validation problems is not built; force: true builds anyway (for a test of the lint). Needs the player bundle (yarn build:player).',
      z.object({ slug, force: z.boolean().optional() }),
      (a) => svc.courses.build(a.slug, { force: a.force })
    ),
    def(
      'edu_lint',
      'Lint the built game (game-data.json and its assets): answer keys, accepted answers, distractors, two forms per objective, assets, text keys, prerequisite cycles, unreachable units, placeholders. errors > 0 means it fails; warnings are shown only. Builds first when there is no build; rebuild: true builds again first. `stale: true` in the result means a course file changed after the build.',
      z.object({ slug, rebuild: z.boolean().optional() }),
      (a) => svc.courses.lint(a.slug, { rebuild: a.rebuild })
    )
  ]
}
