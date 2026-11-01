# EGS-51 reader markup

Bug (HUB-22 live check, deutsch-b2-smoke): the reader and article bodies showed literal `## ` heading markers and `[n]` citation markers.

Fix: `readMarkup` in `src/player/gloss.ts` reads `## ` lines as headings (`h3.enc-subhead`) and `[n]` as `sup.enc-cite` runs before glossing; glossify skips cite runs, so glossary terms still match the prose. Used by the reader, the article page and the item passage panel.

Test: `readMarkup` in tests/player-reader-logic.test.ts; bot-encyclopedia e2e still passes.
