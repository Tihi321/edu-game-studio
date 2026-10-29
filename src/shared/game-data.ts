import type { CoursePack, TextCatalog } from './course'

/**
 * The contract between the build (engine side, `src/engine/edu/build.ts`) and the browser player (`src/player/`).
 *
 * A built game is one folder that works over `file://`:
 *
 * ```
 * index.html        renderIndexHtml(): loads player.css, game-data.js, player.js
 * player.css        the player bundle's styles (out/player/player.css)
 * player.js         the player bundle, one IIFE (out/player/player.js)
 * game-data.json    GameData, for tools (lint, the autoplay bot)
 * game-data.js      `window.EDU_GAME_DATA = <GameData>;` so the player needs no fetch over file://
 * assets/<file>     every asset of the pack, at GameData.assets[id]
 * ```
 *
 * All editions are in one build; the player has a language picker.
 */

export const GAME_DATA_FORMAT = 'edu-game'
export const GAME_DATA_VERSION = 1
/** The global the player reads `GameData` from. */
export const GAME_DATA_GLOBAL = 'EDU_GAME_DATA'
/** The element the player mounts into. */
export const PLAYER_ROOT_ID = 'edu-root'
/** The shell the player starts when the pack does not name one. */
export const DEFAULT_SHELL = 'quiz-arena'

export interface GameData {
  format: typeof GAME_DATA_FORMAT
  version: typeof GAME_DATA_VERSION
  /** The course slug (folder name under `courses/`). */
  slug: string
  /** ISO time of the build. */
  builtAt: string
  /** The Edu Studio version that built it. */
  engine: string
  /** The course pack, as validated. */
  pack: CoursePack
  /** Every text catalog the pack uses, by language: each edition plus the target-language catalog of a language course. */
  catalogs: Record<string, TextCatalog>
  /** The edition the player opens in when the browser language matches none. */
  defaultLang: string
  /** Asset id -> URL relative to index.html (`assets/<file>`). */
  assets: Record<string, string>
  /** The shell to start (`pack.shells.enabled[0]`, else DEFAULT_SHELL). */
  shell: string
}

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The `index.html` of a built game. `title` is the course title in the default edition. */
export function renderIndexHtml(opts: { title: string; lang: string }): string {
  return `<!doctype html>
<html lang="${escapeHtml(opts.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(opts.title)}</title>
<link rel="stylesheet" href="player.css">
</head>
<body>
<div id="${PLAYER_ROOT_ID}"></div>
<noscript>This game needs JavaScript.</noscript>
<script src="game-data.js"></script>
<script src="player.js"></script>
</body>
</html>
`
}

/** The text of `game-data.js`. `</` is escaped so a string in the data can never close the script. */
export function renderGameDataJs(data: GameData): string {
  return `window.${GAME_DATA_GLOBAL} = ${JSON.stringify(data).replace(/<\//g, '<\\/')};\n`
}
