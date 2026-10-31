/**
 * The Android back button (EGS-19). Inside a Capacitor WebView `window.Capacitor.Plugins.App` can tell the page when the system back
 * button is pressed. This does not import `@capacitor/app` (the player stays one dependency-free bundle); it uses the plugin only when it
 * is there. A back press goes one screen back through the control of the shell that is on screen (its test id is one of `BACK_TESTIDS`,
 * see docs/player.md), and when the screen has none, the app exits. In a normal browser nothing happens.
 */

/** The back/leave controls of the shells, in the order they are tried. */
export const BACK_TESTIDS = ['leave', 'back', 'battle-flee', 'to-map', 'to-office'] as const

interface AppPlugin {
  addListener?: (event: string, cb: (e?: unknown) => void) => unknown
  exitApp?: () => unknown
}

function appPlugin(win: Window): AppPlugin | undefined {
  const cap = (win as unknown as { Capacitor?: { Plugins?: { App?: AppPlugin } } }).Capacitor
  return cap?.Plugins?.App
}

/** Presses the first visible, enabled back control; true when there was one. */
export function pressBack(doc: Document = document): boolean {
  for (const id of BACK_TESTIDS) {
    const el = doc.querySelector<HTMLElement>(`[data-testid="${id}"]`)
    if (!el || (el as HTMLButtonElement).disabled || el.getAttribute('aria-hidden') === 'true') continue
    el.click()
    return true
  }
  return false
}

/** Registers the back button handler when running inside Capacitor. Returns whether it did. */
export function installAndroidBack(win: Window = window): boolean {
  const app = appPlugin(win)
  if (!app || typeof app.addListener !== 'function') return false
  try {
    void app.addListener('backButton', () => {
      if (pressBack(win.document)) return
      if (typeof app.exitApp === 'function') void app.exitApp()
    })
    return true
  } catch {
    return false
  }
}
