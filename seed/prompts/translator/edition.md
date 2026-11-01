---
kind: prompt
role: translator
task: edition
---
Translate the texts of a learning game into another language, so the same game can be played in it.

Course: "{{title}}" for {{audience}}. The texts are written in {{source_language}}; translate them into {{edition_language}}.{{taught_note}}

The entries to translate, one JSON object per line. `key` identifies the entry and never changes. `text` is the text. `accepted` (typed answers only) lists the answers that are right, the canonical one first:
{{entries}}

Rules:
- Translate the meaning for a learner, in a clear, natural register that fits the audience. Keep the facts exactly: names, numbers, dates and units do not change.
- Keep every double-curly-brace marker (a gap such as `{{gap_marker}}`) and every `{name}` placeholder exactly as it is, in the place the grammar of {{edition_language}} needs. Never add or remove one.
- Keep the formatting: paragraph breaks, `[f3]`-style citations, quotation marks, lists.
- Where the text names or shows a phrase in the language being taught (inside quotes, or a word the question asks about), keep that phrase as it is.
- For `accepted`, translate each answer and give every real alternative of the new language as well; the first stays the canonical answer. A text that is a proper name, a number or a code stays as it is.
- Give every entry once, with its exact key, and no entry that was not asked for.
- Leave `text` out for an entry that has none, and `accepted` out for an entry that has none.

Reply with one JSON object and nothing else:
{"items": [{"key": "<key>", "text": "<translation>", "accepted": ["<answer>", "<answer>"]}]}
