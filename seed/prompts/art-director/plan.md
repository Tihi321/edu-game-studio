---
kind: prompt
role: art-director
task: plan
---
Plan the pictures of a learning game. Each picture is made later by an image generator from the prompt you write, and checked by an art critic against it.

Course: "{{title}}" (about {{subject}}). Audience: {{audience}} (age: {{age}}). Write every alt text in {{language}}.
Art style: {{style}}. Every prompt you write is wrapped in these style words by the engine, so do not repeat them: {{style_words}}.

The units:
{{units}}

The encyclopedia articles (one picture for each is REQUIRED):
{{articles}}

The items a picture could go with (these are your choice; a hotspot item marked REQUIRED needs one):
{{items}}

The shells of the game and their art slots (every slot marked REQUIRED needs one picture): {{shells}}
{{slots}}

The characters of the story, if there is one (use them for heroes and non-player characters):
{{characters}}

What to write, one line of `images` for each picture:
- `for: "article"` with `id` the article id: a picture that SHOWS the fact of the article (dual coding: the learner sees what the text says). Not a decoration, not a portrait of the topic's name.
- `for: "item"` with `id` the item id (and `side: "back"` for the back of a flashcard): only where a picture helps the learner understand or remember the question. At most {{max_item_images}} of these; leave out the questions a picture would give away or not help. A hotspot item is a picture with places to point at: describe a scene with clear, separate places.
- `for: "shell"` with `shell` and `slot` exactly as listed: the backdrop or the art of that shell. A backdrop is an empty scene with nothing in the middle, so the game can show questions over it. For the `rpg` shell the tile set is a flat sheet of game tiles and the hero and the non-player characters are single standing figures, in pixel art.
- `prompt`: what to draw, in one or two plain English sentences a generator can follow: the subject, what it looks like, the setting, the mood. Say who or what is in the picture and what they do. No text, letters, numbers or labels in the picture, no brand names, nothing that frightens a young learner. Name no living artist.
- `alt`: one short sentence for a learner who cannot see the picture, in {{language}}: what it shows.
- `ratio` (optional): "4:3" (default for an article or an item), "16:9" or "1:1".

Keep the ids and the slot names exactly as they are written above. Do not plan the same picture twice.

Reply with one JSON object and nothing else:
{"images": [{"for": "article", "id": "a-u1-1", "prompt": "A Roman legionary in a red cloak and a bronze helmet marches along a stone road beside a milestone, morning light", "alt": "A Roman soldier marching along a stone road", "ratio": "4:3"}, {"for": "shell", "shell": "quiz-arena", "slot": "bg-u1", "prompt": "An empty marble forum at dawn with columns and long shadows, nobody in the middle", "alt": "An empty Roman forum at dawn"}], "notes": "one sentence on the look you chose"}
