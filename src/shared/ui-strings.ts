/**
 * The player's menu strings in each built-in language other than English (`old` -> `new`; the keys are the strings as they appear in the
 * player, which is written in English). English has no table. Only Croatian is filled in for now: the player runtime (EGS-03) extends the
 * key set, and a language that has no table keeps the English text. `ui` of a language in `config/languages.md` overrides single strings.
 *
 * The tables were written by a language model, not by native speakers: native review is welcome.
 */
export const UI_STRINGS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  hr: {
    'Language': 'Jezik',
    'Start': 'Započni',
    'Next': 'Dalje',
    'Back': 'Natrag',
    'Check': 'Provjeri',
    'Correct!': 'Točno!',
    'Not quite': 'Nije baš',
    'Review': 'Ponavljanje',
    'Menu': 'Izbornik',
    'Main Menu': 'Glavni izbornik',
    'Score': 'Bodovi',
    'Quit': 'Izlaz'
  }
}
