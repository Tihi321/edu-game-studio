import '../../../design/themes/parchment.css'
import './encyclopedia.css'
import { makeEncyclopediaShell } from './app'

/**
 * The encyclopedia explorer (EGS-10): parchment and brass. The learner browses articles, follows cross-links, reads a timeline and a map,
 * and hunts: a clue is pinned on every page, the learner finds the article that answers it and collects the thing by answering the question
 * of the step. Screens: title, explore, article, timeline, map, codex, hunts, item, feedback, end. See docs/player.md, "Encyclopedia".
 */
export const encyclopediaShell = makeEncyclopediaShell('encyclopedia', 'parchment')
