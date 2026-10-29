---
kind: prompt
role: composer
task: plan
---
Plan the music and the sound effects of a learning game. Each sound is made later by a music generator from what you write, and plays in the game under the questions.

Course: "{{title}}" (about {{subject}}). Audience: {{audience}} (age: {{age}}). Write every alt text in {{language}}.
Look of the game: {{style}}. The shells of the game: {{shells}}.

The units:
{{units}}

The areas that need music (every one is REQUIRED; the word in brackets is who makes the music by default):
{{areas}}

The events that need a sound effect (sound effects are made by {{sfx_engine}}):
{{events}}

What to write:
- `music`: one line for each area. A line is `{"area", "mood", "prompt", "alt", "seconds", ...}`. Several units may share one track when they have the same mood: put the first unit's area (`unit-u1`) in `area` and the other units' ids in `units` (`["u2"]`); every area is covered exactly once.
- `mood`: one of {{moods}}. The synth moods (dreamwave, synthwave, darkwave, outrun) only when the topic or audience is 80s, neon, retro or sci-fi; every other course keeps to the calm moods. Music for a lesson is calm, instrumental, with no vocals and no sudden loud part: it loops, and learners hear it for a long time.
- `prompt`: one line of 15 to 30 words for a text-to-music model: start with "calm instrumental", name the instruments (soft piano, strings, harp, music box, light guitar, flute ...), a slow tempo and the feeling. Do not name a living artist or a copyrighted song.
- `alt`: one short sentence for a learner who cannot hear it: what the sound is and where it plays, in {{language}}.
- `seconds`: the length, from {{min_seconds}} to {{max_seconds}} (the track repeats, so 60 to 100 is plenty).
- For Chiptune Studio (a chip-music composer) the line may also give `chip` (one of {{chips}}; the course chose: {{chip}}; if it chose one, use it), `bpm` (slow: 55 to 100), `key` (a note name such as C, F, G, D, A, Eb; neighbouring tracks in different keys) and `bars` (4/4, a multiple of 4, 8 to 48, about seconds x bpm / 240). Leave them out when unsure: the engine picks.
- `sfx`: one line for each event: `{"event", "sound", "alt"}`. `sound` is one of the names Chiptune Studio knows: {{sounds}}. Pick the one that fits: a coin or a chime for a right answer, a soft cancel for a wrong one, magic or powerup for a combo, powerup for a finished unit, alert for the boss.

Keep the area names and the event names exactly as they are written above.

Reply with one JSON object and nothing else:
{"music": [{"area": "menu", "mood": "peaceful", "prompt": "calm instrumental, warm soft piano and strings, slow tempo, welcoming", "alt": "Warm piano music on the title screen", "seconds": 90, "chip": "snes", "bpm": 72, "key": "C", "bars": 28}, {"area": "unit-u1", "units": ["u2"], "mood": "calm", "prompt": "calm instrumental, light harp and flute, steady and gentle", "alt": "Gentle harp music during a round", "seconds": 90}], "sfx": [{"event": "correct", "sound": "coin", "alt": "A bright coin sound for a right answer"}], "notes": "one sentence on the sound you chose"}
