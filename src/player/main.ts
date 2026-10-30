// the design system: tokens, the chalkboard theme (Kalam + Atkinson, inlined by Vite) and motion; then the page, the widgets, the screens.
// Each shell imports its own theme (src/design/themes/<id>.css) from its module, so player.css carries every look the bundle can play.
import '../design/tokens.css'
import '../design/themes/chalkboard.css'
import '../design/motion.css'
import './style/base.css'
import './style/items.css'
import './style/arena.css'
import './kit/kit.css'
import { createEngine } from './engine'
import { BUILTIN_RENDERERS } from './items'
import { encyclopediaShell } from './shells/encyclopedia'
import { mindmazeShell } from './shells/mindmaze'
import { quizArenaShell } from './shells/quiz-arena'
import { rpgShell } from './shells/rpg'

/**
 * The entry of the browser bundle (`out/player/player.js`, one IIFE). Creates `window.EduEngine`, registers the built-in item renderers
 * and the game shells on it, and starts the game once the page is ready. Another shell or item kind loaded before or after this
 * script registers itself the same way (`EduEngine.registerShell`, `EduEngine.registerItemKind`).
 */
const engine = createEngine()
for (const r of BUILTIN_RENDERERS) engine.registerItemKind(r.kind, r)
engine.registerShell(quizArenaShell.id, quizArenaShell)
engine.registerShell(encyclopediaShell.id, encyclopediaShell)
engine.registerShell(mindmazeShell.id, mindmazeShell)
engine.registerShell(rpgShell.id, rpgShell)
window.EduEngine = engine

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => engine.start())
else engine.start()
