import type { TextCatalog } from '../../shared/course'

/**
 * A shell's own words (`src/player/shells/<id>/strings.ts`): an English table and a Croatian one, keys namespaced by the shell
 * (`maze.door`, `rpg.attack` ...). As with the player's words (`i18n.ts`), a course overrides any string with the catalog key
 * `ui.<key>`, and an edition without a table falls back to English. `{name}` placeholders are filled from `vars`.
 */
export type ShellStrings<K extends string = string> = { en: Record<K, string>; hr?: Partial<Record<K, string>>; [lang: string]: Partial<Record<K, string>> | undefined }

export type ShellUi<K extends string = string> = (key: K, vars?: Record<string, string | number>) => string

export function makeShellUi<K extends string>(tables: ShellStrings<K>, lang: string, catalog?: Pick<TextCatalog, 'strings'>): ShellUi<K> {
  const table = tables[lang] ?? tables[lang.split('-')[0] ?? ''] ?? {}
  return (key, vars) => {
    let s: string = catalog?.strings[`ui.${key}`] ?? (table as Partial<Record<K, string>>)[key] ?? tables.en[key] ?? key
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v))
    return s
  }
}
