import type { ItemRenderer } from '../types'
import { mcqRenderer, multiSelectRenderer, trueFalseRenderer } from './choice'
import { conjugationRenderer } from './conjugation'
import { crosswordRenderer } from './crossword'
import { flashcardRenderer } from './flashcard'
import { hotspotRenderer } from './hotspot'
import { listeningRenderer } from './listening'
import { matchPairsRenderer } from './pairs'
import { orderRenderer } from './order'
import { sortGroupsRenderer } from './sort'
import { clozeRenderer, typedRenderer } from './text'
import { wordSearchRenderer } from './wordsearch'

/** The renderers of the 14 built-in item kinds. `main.ts` registers them with `EduEngine.registerItemKind`. */
export const BUILTIN_RENDERERS: ItemRenderer[] = [
  mcqRenderer,
  trueFalseRenderer,
  multiSelectRenderer,
  clozeRenderer,
  typedRenderer,
  matchPairsRenderer,
  orderRenderer,
  sortGroupsRenderer,
  hotspotRenderer,
  listeningRenderer,
  flashcardRenderer,
  crosswordRenderer,
  wordSearchRenderer,
  conjugationRenderer
]
