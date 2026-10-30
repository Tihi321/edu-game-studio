---
kind: prompt
role: voice-director
task: plan
---
Plan the spoken audio of a learning game. Every clip is made later by a speech engine from the text of the course: you choose which texts are spoken and how, you never write the spoken text yourself.

Course: "{{title}}" (about {{subject}}). Audience: {{audience}} (age: {{age}}). Narration and alt texts are in {{language}} ({{source_lang}}). The language being taught: {{target_language}} ({{target_lang}}).

The units:
{{units}}

Texts that can be narrated, in {{language}} (at most {{max_narration}} may be chosen; the narration is short, so pick the unit introductions and the articles that help a learner most; long texts are cut at a sentence):
{{narration}}

Listening items the course already has (they get their clips anyway):
{{listening}}

Taught phrases that can become a new listening item (a learner hears the phrase in {{target_language}} and types or chooses it; at most {{per_unit}} per unit, and only phrases worth hearing: not single letters or rare words):
{{candidates}}

What to write:
- `voices`: for each spoken language (the language code as the key) a `style`: one short sentence on how it is spoken (for the taught language: clear, natural and a little slow with careful pronunciation; for narration: warm and calm for children, even and clear for adults). Optionally `gemini`: a Gemini voice id such as `gemini:Kore`, `gemini:Charon` or `gemini:Puck`; leave it out when unsure.
- `narration`: the texts to narrate, by their exact key from the list above, each with an optional short `alt` (one sentence in {{language}} for a learner who cannot hear it). Leave the list empty when there is nothing above to narrate.
- `derive`: the items to make a listening exercise from, by their exact id from the list above, each with an optional `prompt` (the instruction line in {{language}}, for example "Listen to the recording and type what you hear."). Spread them over the units; leave the list empty when there are no candidates.

Keep every key and id exactly as written above.

Reply with one JSON object and nothing else:
{"voices": {"hr": {"style": "clear, natural and a little slow, with careful pronunciation, as a language teacher would say it", "gemini": "gemini:Kore"}, "en": {"style": "a warm, calm narrator"}}, "narration": [{"key": "unit.u1.summary", "alt": "Audio: introduction to the first unit"}], "derive": [{"item": "u1-q3", "prompt": "Listen to the recording and type what you hear."}], "notes": "one sentence on your choices"}
