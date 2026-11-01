---
kind: languages
languages: []
---
# Languages

The languages a course can be in. The built-in table has 37 (the ones Book Translator knows, plus a few more); run `edu_languages` to see them. Player menu strings exist for Croatian and German (`src/shared/ui-strings.ts`, `src/player/i18n.ts`); the other languages keep the English menus until the player runtime (EGS-03) extends the table. Add a language here, or change a built-in one, by listing it under `languages:` in the frontmatter above. An entry for a built-in code is merged into the built-in one (only the fields you give change).

Each entry:

- `code`: the language code, lowercase, such as `pt-br`. It is the file name of the course text (`course/text/pt-br.json`).
- `name`: the English name.
- `native`: the name in the language itself, shown in the game's language picker. Default: `name`.
- `rtl`: `true` for a right-to-left language (the player mirrors its layout for it).
- `script`: `latin`, `cyrillic`, `greek`, `arabic`, `hebrew`, `devanagari`, `han`, `kana`, `hangul`, `thai` or `other`. The build checks that the theme's text font has glyphs for it and picks a font when it has not (see `font`). Default: `other`.
- `ui`: the player's menu strings in that language (`Start: Iniciar`). A built-in language may have a table already, so `ui` here only overrides single strings: it is merged key by key into the built-in table. A language with no `ui` keeps English menus. The built-in tables were written by a language model, not by native speakers: fix a string here when you see a bad one.
- `font`, `fontBold`: a font file with the glyphs of the language, used for its text when the theme font lacks them. An absolute path, or a file name in the `fonts` folder of the data folder (`<data>/fonts/`). A `.ttc` collection works.

An added language is not detected automatically: give its code when you create a course or add an edition.

Example, Brazilian Portuguese with a few menu strings:

```yaml
languages:
  - code: pt-br
    name: Brazilian Portuguese
    native: Português (Brasil)
    script: latin
    ui:
      Start: Iniciar
      Next: Seguinte
      Check: Verificar
      Quit: Sair
```

Changes are read when the engine starts and when a language is checked.

Text-to-speech coverage is not a language property: the local ComfyUI engines report the languages they read, with their readiness, in `edu_voice_status` (a later ticket).
