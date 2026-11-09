# EGS-65 Audio panel on a TV remote

From the HUB-28 discoveries (hub `.claude/tickets/HUB-28-edu-mobile-music/discoveries.md`). Pairs with creative-hub-web WEB-05.

- `src/player/kit/audio-menu.ts`: while the panel is open its capture-phase key listener (a) closes the panel on Escape and on the remote's Back (`BrowserBack`, `GoBack`, keyCode 4, 461, 10009) with `preventDefault` + `stopPropagation`, (b) moves the focus with Up/Down through the sliders and buttons (Left/Right too, except on a slider, where they change the value), (c) lets OK (Enter) toggle the "Reduce audio" checkbox. Before, the listener swallowed the arrow keys so the remote could not leave the first slider, and Back was not handled.
- The hub bridge (creative-hub-web WEB-05) sees `[data-testid="audio-panel"]` in the page and does not leave the game on Back, so the player closes the panel first.

Test: `tests/audio-shells.e2e.test.ts`, the panel part of each shell's case: Down moves to the next control, Right on a slider changes the value and keeps the focus, Back (a `BrowserBack` keydown) closes the panel and puts the focus on the speaker button. Not tried on a real TV.
