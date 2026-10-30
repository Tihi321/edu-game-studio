# The encyclopedia explorer (`encyclopedia`): section for `docs/player.md`

Theme `parchment` (parchment and brass, EB Garamond, oxblood rubrics). You browse a printed book: an index of articles in chapters (the units), cross-links in the text, a timeline, a map, and scavenger hunts that send you back into the articles to find the answers. Pages turn (the theme's `edu-enter-page` on the page content; the index tabs stay put), a drop cap opens every article, and the clue of a hunt is a slip of paper pinned with a brass pin on every page. No images beyond the course's own: the title book and the seal are drawn in CSS; `prefers-reduced-motion` turns every animation off.

## Screens (`getState().screen`) and test ids

Every world screen has the tabs (`nav-index`, `nav-timeline` and `nav-map` only when the course has events / an image, `nav-codex`, `nav-hunts`, and `menu` for the title page). While a hunt is on, the pinned clue is on all of them: `clue-bar` (`data-step`), `clue` (the riddle), `clue-retry` (a missed step coming back), `clue-drop` ("Put the hunt aside").

| Screen | What it is | Test ids |
|---|---|---|
| `title` | the kit's title with a closed book as art | kit ids (`start` reads "Open the book" / "Continue reading", `course-title`, `shell-picker` ...) |
| `explore` | the home: masthead (the course title, h1), status line, search, the plate (the first image), the index in chapters. A locked chapter's articles stay readable: reading is free, the hunts are gated | `explore-title` (h1), `status` with `status-found`, `status-stars`, `status-read`, `search` (input; Enter opens the first hit), `search-status` (live), `search-results`, `result-<articleId>`, `plate`, `chapter-<unitId>` (`data-locked`), `chapter-locked-<unitId>`, `chapter-other` (articles of no unit), `article-<articleId>` (`data-read`) |
| `article` | one article as a spread: the text page (running head, title h1, the collect seal when this page answers the pinned clue, the body with cross-links) and the plate page (figure with its alt as caption, the audio slot when the article has an audio asset, "See also", the sources) | `article` (`data-article`), `article-title` (h1), `article-body`, `article-figure`, `article-audio` (only with an audio asset), `link-<articleId>` (first mention of another article's title in the body: longest title first, whole words, case-insensitive), `related`, `related-<articleId>`, `citations`, `citation-<factId>`, `citation-link-<factId>` (opens in a new tab, `rel="noopener noreferrer"`), `back` (the screen you came from: the index, the timeline, the map, the codex, another article), `collect-<stepId>` |
| `timeline` | events on a ruler true to scale in a box that scrolls inside itself (cards above and below with leader lines); the focus moves between cards with the arrow keys, Home and End; the detail line follows the focus | `timeline-title` (h1), `timeline`, `event-<eventId>` (`data-year`, `data-article`, `data-lane`), `event-detail` (`data-event`) |
| `map` | the image with brass rings at the pins (x / y in image pixels, drawn as percentages; the map keeps a width at which the two nearest pins stay a tap apart and scrolls inside its box on a phone); the arrow keys move between pins; the same places as a list under it | `map-title` (h1), `map`, `place-<placeId>` (`aria-label` = the name; the name shows on hover and focus), `places`, `place-link-<placeId>` |
| `codex` | the collectibles of the hunts: name, the fact it taught (the item's did-you-know, else its explanation), a link to the article; the ones not found yet are "?" | `codex-title` (h1), `codex-count` (`data-found`, `data-total`), `codex-empty`, `codex-<stepId>` (`data-found`), `codex-link-<stepId>` |
| `hunts` | one card per hunt under its chapter (stars per unit), the grand hunt, the result of the hunt just played | `hunts-title` (h1), `hunt-result` (`data-stars`, `data-collected`, `data-total`, `data-final`) with `hunt-result-stars`, `hunt-chapter-<unitId>`, `hunt-stars-<unitId>`, `hunt-<huntId>` (`data-locked`, `data-stars`, `disabled` while locked), `hunt-locked-<huntId>`, `hunt-chapter-final`, `hunt-final`, `hunt-stars-final`, `hunt-locked-final`, `finish` (once the grand hunt has a star) |
| `item`, `feedback` | the kit's `ask()`, context `hunt`; the hud is the hunt, the clue number and one brass pip per collectible (the pip fills when it is collected) | kit ids, `hunt-hud`, `leave` ("Back to the article"), `feedback-effect` ("Collected: ... It is in your codex." / "Not collected yet. Read the article again: the clue comes back.") |
| `end` | the kit's end screen after `finish`, plus the count of collectibles and articles read | kit ids, `end-collected` |

## The hunt loop (the question is about the article you found)

1. A hunt (one per unit, authored or automatic) pins its first clue (the riddle) on every page.
2. Browse, search or follow links. On the target article the seal `collect-<stepId>` appears ("This page answers your clue").
3. Collect asks the step's item (`ask()`, context `hunt`; `leave` goes back to the article). Right: the collectible joins the codex, the next clue is pinned and you land on the article you just read. Wrong: the feedback explains, the step stays open and comes back as a retry (the shared run logic: a miss returns after 2-4 other questions, at most twice more; `clue-retry` marks it and the seal says "Back again. Read this page more closely."). A hunt always ends: after the retries it is over with fewer stars and can be hunted again; nothing is a dead end.
4. When the run is over, `recordUnit` gives the stars from the first-try accuracy (1 from 50 %, 2 from 70 %, 3 from 90 %); 2+ stars master the unit and open the hunts of the units that require it (`hunt-result` says which). The best run counts.
5. The grand hunt (`hunt-final`) opens when every unit is mastered and mixes the first and the last step of every unit's hunts (a boss run); 1+ star offers `finish` -> `end`.

## `view` (JSON-safe, on every world screen)

`{ found: [stepId], read: [articleId], counts: { found, total, stars, maxStars, read, articles }, hunt: null | { id, final, step, article, item, retry, answered, size, collected: [stepId] } }`, plus per screen: `explore` `query`; `article` `article`; `timeline` `event`; `hunts` `result` (`{ huntId, final, stars, accuracy, collected, total, unlocked }` or null); `item` / `feedback` `step`, `article`. The found steps and the articles read are saved in `progress.shells.encyclopedia.data` (ids the course no longer has are dropped on load).

## Debug helpers (`EduEngine.debug.shell`, read-only)

- `hunts()`: `[{ id, unit, open, stars, steps: [{ id, article, item }] }]`; `finalHunt()`: `{ open, steps }`.
- `target()`: the pinned step or null: `{ hunt, final, step, article, item, retry, clue, term, via }`; `term` is a short query that finds the article by its title, `via` is `{ from, testid }` (the article to open and the `link-<id>` / `related-<id>` to press to reach the target by a link) or null.
- `searchTerm(id)`, `links(id)` (`{ links, related }`), `articles()`, `timeline()`, `places()`, `codex()` (`[{ id, found }]`), `queue()` (the review queue).

## Rules of the shell

- Every challenge is an `ask()` with the kit's explanatory feedback; picking, retries and stars are the shared run logic (`startRun` / `next` / `record` / `recordUnit`).
- Cross-links are computed from the article titles of the edition being read (so the Croatian edition links "Beč", not "Vienna"); search ignores case and accents and finds titles first, then body sentences.
- Reading is free (a locked chapter's articles open), the hunts are gated by mastery; the question IS the page you found (the lint warns when a step's right answer is not in its article).
- Colours only from the parchment theme's `--edu-*` slots; focus ring 3 px (`--edu-focus`); every control is a `<button>` / `<input>` / `<a>`; 44 px targets (inline cross-links in running text excepted); no horizontal scroll from 360 px (the timeline and the map scroll inside their own box); no text under 13 px; no external URL except the sources a course cites (opened in a new tab).

## The course section `pack.shells.config.encyclopedia` (all of it optional)

```jsonc
{
  "timeline": [{ "id": "t-voyager", "year": 1977, "label": "enc.t.voyager", "text": "enc.t.voyager.text", "article": "art-giants" }],  // year < 0 is BC, no year 0
  "map": { "asset": "img-solar-system", "width": 800, "height": 300, "places": [{ "id": "p-sun", "x": 60, "y": 150, "label": "enc.p.sun", "article": "art-sun" }] },
  "hunts": [{ "id": "h-sun", "unit": "u-sun-planets", "title": "enc.h.sun.title", "intro": "enc.h.sun.intro",
              "steps": [{ "id": "s-sun-star", "clue": "enc.h.sun.s-sun-star.clue", "article": "art-sun", "item": "q-sun-mcq", "collectible": "enc.h.sun.s-sun-star.name" }] }]
}
```

Every text value is a catalog key (so Book Translator translates it); step ids are unique across all hunts. A part that is missing falls back to the automatic layout (or is hidden): without `hunts`, one hunt per unit whose steps are the unit's articles (at most 6; a unit without articles gets one built from each objective and its facts), each asking an item of the objective that cites a fact the article cites ("Find the article about ..."); without `timeline`, the dated entries of `order` items with `timeline: true`, linked to the article that names them; without `map`, the first image asset with no pins (the `map` tab is hidden when the course has no image). Courses play without the section (`requiresSection: false`).

## Lint codes (`src/shared/shells/encyclopedia.ts`)

Validator: `UNKNOWN_UNIT` (a hunt's unit), `DUPLICATE_ID` (hunts, events, places, steps), `UNKNOWN_ASSET` (the map's asset), `MISSING_TEXT` (a catalog key without a string, checked per edition).
Lint errors: `ENC_HUNT_TARGET_MISSING`, `ENC_HUNT_ITEM_MISSING`, `ENC_HUNT_ITEM_DUPLICATE` (two steps of a hunt ask the same item: the second could never come up), `ENC_UNIT_NO_HUNT` (a unit no hunt covers could never be mastered), `ENC_HUNT_EMPTY`, `ENC_TIMELINE_ARTICLE_MISSING`, `ENC_MAP_ARTICLE_MISSING`, `ENC_MAP_PLACE_OUTSIDE`, `ENC_MAP_NO_IMAGE`.
Warnings: `ENC_ANSWER_NOT_IN_ARTICLE` (the right answer of a step's item, by option text, canonical typed answer, cloze gaps, flashcard back or hotspot label, is not in the target article in some edition; words are matched by stem, so Croatian inflection passes; true / false, multi-select and ordering kinds are skipped), `ENC_HUNT_ITEM_OTHER_UNIT`.
The automatic layout is linted too.

## The bot driver (`scripts/bot/encyclopedia.mjs`)

- `perfect`: every unit's hunt in prerequisite order to 3 stars, then the grand hunt and `finish` -> `end`. Per clue it reads the pinned clue, reaches the target article by search + a click on the result, by the index, by search + Enter, or by a cross-link / "See also" (in turn), presses `collect-<step>` and answers right. It also searches for nonsense (no results, `search-status` says so), reads a locked chapter's article, checks every article page once (title, body, `link-*` for every mention, `related-*`, `citation-*`, the figure, no audio slot without audio, new-tab citation links), uses Home / End / the arrow keys on the timeline and the arrow keys on the map, opens an event and a place (and one place from the list), and counts the codex (empty at the start, every collectible after the unit hunts). The page content must animate with `edu-enter-page`.
- `wrong`: every answer wrong (`--rounds N` plays each open hunt N times; runs with `prefers-reduced-motion: reduce`, and checks that nothing animates). The clue stays pinned, the target article and its `collect-<step>` are always there, a missed clue comes back (more answers than steps), the codex stays empty, the review queue fills, the hunt ends with 0 stars and can be played again, the other chapters and the grand hunt stay locked, `finish` never shows.
- `random`: a seeded learner (`--accuracy`) hunts until every unit is mastered (2+ stars), then the grand hunt until it earns a star, within `maxSteps = ceil(6 * (steps of all hunts + 2 * units) * factor) + 20` (reduced motion, like `wrong`).
- `--keyboard`, `--axe`, `--shots` and `--viewport` work as in every shell. The summary adds `encyclopedia: { hunts, steps, search, searchEnter, index, crossLinks, related, articlesChecked, events, places, collectibles, locked, reducedMotion }`.
