import { describe, expect, it } from 'vitest'
import { UI_KEYS, UI_LANGUAGES, UI_TABLES } from '../src/player/i18n'
import { STRINGS as DET } from '../src/player/shells/detective/strings'
import { ENC_STRINGS } from '../src/player/shells/encyclopedia/strings'
import { MAZE_STRINGS } from '../src/player/shells/mindmaze/strings'
import { RP_STRINGS } from '../src/player/shells/roleplay/strings'
import { RPG_STRINGS } from '../src/player/shells/rpg/strings'

const LANGS = ['hr', 'de']

describe('player strings are complete in en, hr and de', () => {
  it('the player table and every shell table have every key in every language', () => {
    expect(UI_LANGUAGES).toEqual(expect.arrayContaining(['en', 'hr', 'de']))
    for (const lang of LANGS) {
      const missing = UI_KEYS.filter((k) => !UI_TABLES[lang]?.[k])
      expect(missing, `player table ${lang}`).toEqual([])
      expect(Object.keys(UI_TABLES[lang] ?? {}).filter((k) => !(UI_KEYS as string[]).includes(k))).toEqual([])
    }
    const shells = { detective: DET, encyclopedia: ENC_STRINGS, mindmaze: MAZE_STRINGS, roleplay: RP_STRINGS, rpg: RPG_STRINGS } as const
    for (const [id, tables] of Object.entries(shells)) {
      for (const lang of LANGS) {
        const table = (tables as Record<string, Record<string, string> | undefined>)[lang] ?? {}
        expect(Object.keys(tables.en).filter((k) => !table[k]), `shell ${id} in ${lang}`).toEqual([])
      }
    }
  })
})
