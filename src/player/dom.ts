/** A tiny DOM builder: no framework, no innerHTML (every string goes in as text). */

type Attrs = Record<string, string | number | boolean | null | undefined | ((e: Event) => void)>
export type Child = Node | string | number | null | undefined | false | Child[]

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, '').toLowerCase(), v)
    else if (k === 'class') el.className = String(v)
    else if (k === 'testid') el.setAttribute('data-testid', String(v))
    else if (k === 'text') el.textContent = String(v)
    else el.setAttribute(k, v === true ? '' : String(v))
  }
  append(el, children)
  return el
}

export function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue
    if (Array.isArray(c)) append(el, c)
    else el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c)
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild)
}

/** A `<button type="button">` with a test id. */
export function button(testid: string, label: Child, onClick: (e: MouseEvent) => void, attrs: Attrs = {}): HTMLButtonElement {
  return h('button', { type: 'button', testid, ...attrs, onclick: onClick as (e: Event) => void }, label)
}

/** Moves a number key (1-9) to a zero-based index, or -1 when the key is not a plain digit. */
export function digitIndex(e: KeyboardEvent): number {
  if (e.ctrlKey || e.metaKey || e.altKey) return -1
  return /^[1-9]$/.test(e.key) ? Number(e.key) - 1 : -1
}

/** True when the event target is a place the user types in (number keys must not be taken there). */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}

/** Plays a CSS animation class once, then removes it. */
export function pulse(el: Element, cls: string, ms = 700): void {
  el.classList.remove(cls)
  void (el as HTMLElement).offsetWidth
  el.classList.add(cls)
  window.setTimeout(() => el.classList.remove(cls), ms)
}

export const SVG_NS = 'http://www.w3.org/2000/svg'
export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number | undefined> = {}, ...children: Node[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) el.setAttribute(k === 'testid' ? 'data-testid' : k, String(v))
  for (const c of children) el.appendChild(c)
  return el
}
