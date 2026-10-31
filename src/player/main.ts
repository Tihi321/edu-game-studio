// the design system: tokens, the chalkboard theme (Kalam + Atkinson, inlined by Vite) and motion; then the page, the widgets, the screens.
// Each shell imports its own theme (src/design/themes/<id>.css) from its module, so player.css carries every look the bundle can play.
import { installAndroidBack } from './android-back'
import '../design/tokens.css'
import '../design/themes/chalkboard.css'
import '../design/motion.css'
import './style/base.css'
import './style/items.css'
import './style/arena.css'
import './kit/kit.css'
import { createEngine } from './engine'
import { BUILTIN_RENDERERS } from './items'
import { detectiveShell } from './shells/detective'
import { encyclopediaShell } from './shells/encyclopedia'
import { mindmazeShell } from './shells/mindmaze'
import { quizArenaShell } from './shells/quiz-arena'
import { roleplayShell } from './shells/roleplay'
import { rpgShell } from './shells/rpg'

/**
 * The entry of the browser bundle (`out/player/player.js`, one IIFE). Creates `window.EduEngine`, registers the built-in item renderers
 * and the game shells on it, and starts the game once the page is ready. Another shell or item kind loaded before or after this
 * script registers itself the same way (`EduEngine.registerShell`, `EduEngine.registerItemKind`).
 */
// A picture or a sound that fails to load is a console error, so the autoplay bot (and anyone with the console open) sees it (EGS-15). A `load`
// failure does not bubble, so this listens in the capture phase on the document.
document.addEventListener(
  'error',
  (e) => {
    const t = e.target
    if (t instanceof HTMLImageElement || t instanceof HTMLMediaElement || t instanceof SVGImageElement) console.error(`media failed to load: ${(t as HTMLImageElement).currentSrc || t.getAttribute('src') || t.getAttribute('href') || '(no source)'}`)
  },
  true
)

const engine = createEngine()
for (const r of BUILTIN_RENDERERS) engine.registerItemKind(r.kind, r)
engine.registerShell(quizArenaShell.id, quizArenaShell)
engine.registerShell(encyclopediaShell.id, encyclopediaShell)
engine.registerShell(mindmazeShell.id, mindmazeShell)
engine.registerShell(rpgShell.id, rpgShell)
engine.registerShell(roleplayShell.id, roleplayShell)
engine.registerShell(detectiveShell.id, detectiveShell)
window.EduEngine = engine
installAndroidBack()

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => engine.start())
else engine.start()
