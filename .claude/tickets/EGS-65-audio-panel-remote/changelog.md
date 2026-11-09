# EGS-65 changelog

- `src/player/kit/audio-menu.ts`: Back keys close the panel; Up/Down/Left/Right move the focus (Left/Right change a slider's value on a slider); Enter toggles the checkbox.
- `tests/audio-shells.e2e.test.ts`: the panel part of each shell's case drives the slider with Right/Left, moves on with Down and closes with a `BrowserBack` key (fails without the change).
