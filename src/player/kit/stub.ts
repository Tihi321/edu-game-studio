import { h } from '../dom'
import type { RoundState } from '../round'
import type { Shell } from '../types'
import { ask } from './question'
import { endScreen, newTitleState, titleScreen } from './screens'
import { ShellSession } from './session'

/**
 * A placeholder shell on the kit (EGS-10 contract): title -> one run per unit in prerequisite order, every question through `ask()` ->
 * end. Each shell ticket replaces its stub with the real shell; the stub proves the kit and lets the bot's generic answering run.
 */
export function makeStubShell(id: string, theme: string): Shell {
  let session: ShellSession | null = null
  const shell: Shell = {
    id,
    mount(host) {
      const s = new ShellSession<string>(host, { shellId: id, theme, strings: { en: {} } })
      session = s
      const titleState = newTitleState()
      const title = (): void => {
        s.finished = false
        s.render('title', titleScreen(s, { onStart: () => unit(0) }, title, titleState))
      }
      const units = s.units()
      const unit = (n: number): void => {
        const u = units[n]
        if (!u) {
          s.finish()
          return void s.render('end', endScreen(s, { onAgain: () => unit(0), onTitle: title }))
        }
        let run: RoundState = s.startRun(s.itemsOfUnit(u.id).map((i) => i.id), { unitId: u.id })
        const step = (): void => {
          const pick = s.next(run)
          if (!pick) {
            s.recordUnit({ unitId: u.id }, s.accuracy(run))
            return unit(n + 1)
          }
          const item = s.item(pick.id)
          if (!item) return unit(n + 1)
          ask(s, {
            item,
            context: 'stub',
            retry: pick.retry,
            unitId: u.id,
            lead: h('span', {}, s.unitTitle(u.id)),
            onAnswered: (o) => {
              run = s.record(run, pick, o)
            },
            onNext: () => step()
          })
        }
        step()
      }
      s.mount()
      title()
    },
    unmount() {
      session?.unmount()
      session = null
    }
  }
  return shell
}
