import path from 'node:path'
import { z } from 'zod'
import { LANGUAGE_SCRIPTS, registerLanguages, resetLanguages } from '../../shared/languages'
import { langSchema } from '../../shared/media'
import { readMd } from '../store/atomic'

/** One entry of `languages:` in `config/languages.md`: a new language, or a built-in one with other values. */
const languageEntrySchema = z.object({
  code: langSchema,
  name: z.string().min(1),
  native: z.string().optional(),
  rtl: z.boolean().optional(),
  script: z.enum(LANGUAGE_SCRIPTS).optional(),
  ui: z.record(z.string(), z.string()).optional(),
  /** A font file with the glyphs of the language: an absolute path, or a file name in `<data>/fonts/`. */
  font: z.string().min(1).optional(),
  fontBold: z.string().min(1).optional()
})
const languagesConfigSchema = z.object({ languages: z.array(languageEntrySchema).default([]) })

/**
 * Reads `config/languages.md` and registers its languages on top of the built-in table (a bad file is logged and
 * ignored, so the built-in table stays). Called at engine start and before a language is validated.
 */
export async function loadLanguageConfig(dataDir: string, log?: (message: string) => void): Promise<void> {
  resetLanguages()
  let data: unknown
  try {
    data = (await readMd(path.join(dataDir, 'config', 'languages.md'))).data
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log?.(`config/languages.md could not be read (${(err as Error).message}); using the built-in languages`)
    return
  }
  const parsed = languagesConfigSchema.safeParse(data)
  if (!parsed.success) {
    log?.(`config/languages.md is not valid (${parsed.error.issues[0]?.path.join('.')}: ${parsed.error.issues[0]?.message}); using the built-in languages`)
    return
  }
  registerLanguages(parsed.data.languages)
}
