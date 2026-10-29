// the design system: tokens, the chalkboard theme (Kalam + Atkinson, inlined by Vite) and motion; then the page, the widgets, the screens
import '../design/tokens.css'
import '../design/themes/chalkboard.css'
import '../design/motion.css'
import './style/base.css'
import './style/items.css'
import './style/arena.css'
import { createEngine } from './engine'
import { BUILTIN_RENDERERS } from './items'
import { quizArenaShell } from './shells/quiz-arena'

/**
 * The entry of the browser bundle (`out/player/player.js`, one IIFE). Creates `window.EduEngine`, registers the built-in item renderers
 * and the quiz-arena shell on it, and starts the game once the page is ready. Another shell or item kind loaded before or after this
 * script registers itself the same way (`EduEngine.registerShell`, `EduEngine.registerItemKind`).
 */
const engine = createEngine()
for (const r of BUILTIN_RENDERERS) engine.registerItemKind(r.kind, r)
engine.registerShell(quizArenaShell.id, quizArenaShell)
window.EduEngine = engine

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => engine.start())
else engine.start()
