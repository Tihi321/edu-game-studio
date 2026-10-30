/**
 * The bot's drivers, one per game shell (scripts/play.mjs picks one by the shell the game runs). A driver exports
 *   maxSteps({ pack, data, opts, factor }) -> number   the step bound (factor = max(1, 0.75 / accuracy)^2 in random mode, else 1)
 *   play(bot) -> Promise<void>                          plays from the title screen (already checked and shot) to the end
 * `bot` is the toolbox of play.mjs: state(), press(), pressAndWait(), answerCurrent(), answerWhileItem(), openQuestion(), shellDebug(),
 * shot(), overflowCheck(), fail(), exists(), wantRight(), the page, the options and the game data. See docs/player.md, "Autoplay bot".
 */
import * as encyclopedia from './encyclopedia.mjs'
import * as mindmaze from './mindmaze.mjs'
import * as quizArena from './quiz-arena.mjs'
import * as rpg from './rpg.mjs'

export const DRIVERS = {
  'quiz-arena': quizArena,
  encyclopedia,
  mindmaze,
  rpg
}
