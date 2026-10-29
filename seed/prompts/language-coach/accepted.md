---
kind: prompt
role: language-coach
task: accepted
---
Widen the accepted answers of the typed questions of a language course, so a learner who is right is never marked wrong.

Course: "{{title}}". The instructions are in {{language}}; the language that is taught is {{target_language}} (CEFR {{cefr}}).

The typed answers. Each has a `ref` and the canonical answer the writer gave (always first in `accepted`), with the question for context:
{{items}}

For each ref give the other answers that are just as right, in the language of the answer:
- Real synonyms and common variants of the same meaning at this level ("Bok" and "Bok!" are one answer, but "Zdravo" may be a second greeting).
- The form with and without an optional polite word, article or pronoun that speakers drop ("Zovem se Ana" and "Ana").
- Spellings with and without a final full stop or exclamation mark are NOT needed: capitals, accents and one typo are handled by the game.
- Only answers a learner at the level could give and that really answer the question. Never add a wrong answer, a different meaning, or a word that is one of the wrong choices of a word bank.
Give the canonical answer too, as the first entry, exactly as it was written. A ref with no good alternative still gets its canonical answer alone.

Reply with one JSON object and nothing else:
{"answers": [{"ref": "<item id>" or "<item id>.<gap id>", "accepted": ["canonical answer", "variant", "variant"]}]}
