import { button, h } from '../../dom'
import type { ActiveHunt, EncApp, HuntResult } from './app'
import { roman } from './view-explore'

/** The clue pinned on every page while a hunt is on: the riddle, where the learner is in the hunt, and a way to put the hunt aside. */
export function clueBar(app: EncApp): HTMLElement | null {
  const p = app.pinned()
  const ah = app.hunt
  if (!p || !ah) return null
  const s = app.s
  return h(
    'div',
    { class: `enc-clue${p.retry ? ' is-retry' : ''}`, role: 'group', 'aria-label': s.s('enc.clue.bar', { title: ah.final ? s.s('enc.hunt.final') : app.huntTitle(ah.hunt) }), testid: 'clue-bar', 'data-step': p.step.id },
    h('span', { class: 'enc-clue-pin', 'aria-hidden': 'true' }),
    h(
      'div',
      { class: 'enc-clue-main' },
      h('span', { class: 'enc-clue-label' }, `${ah.final ? s.s('enc.hunt.final') : app.huntTitle(ah.hunt)} · ${s.s('enc.clue.label', { n: p.n, total: p.total })}`),
      h('p', { class: 'enc-clue-text', testid: 'clue' }, app.stepClue(p.step)),
      p.retry ? h('span', { class: 'tag tag-retry enc-clue-retry', testid: 'clue-retry' }, s.s('enc.clue.retry')) : null
    ),
    button('clue-drop', s.s('enc.clue.drop'), () => app.dropHunt(), { class: 'btn btn-small btn-ghost enc-clue-drop' })
  )
}

/** The strip above a question: the hunt, the clue, and the collectibles of the hunt as brass pips. */
export function hudBar(app: EncApp, ah: ActiveHunt, idx: number): HTMLElement {
  const s = app.s
  return h(
    'div',
    { class: 'enc-hud', testid: 'hunt-hud' },
    h('span', { class: 'enc-hud-title' }, s.s('enc.hud', { title: ah.final ? s.s('enc.hunt.final') : app.huntTitle(ah.hunt) })),
    h('span', { class: 'enc-hud-step' }, s.s('enc.clue.label', { n: idx, total: ah.steps.length })),
    h(
      'span',
      { class: 'enc-hud-pips', role: 'img', 'aria-label': s.s('enc.hunt.found', { found: ah.collected.length, n: ah.steps.length }) },
      ah.steps.map((st) => h('span', { class: `enc-hud-pip${ah.collected.includes(st.id) ? ' is-found' : ''}`, 'aria-hidden': 'true' }))
    )
  )
}

/** The codex: a plate per collectible of the course, the found ones with what they taught, the others as a "?". */
export function codexBody(app: EncApp): HTMLElement {
  const s = app.s
  const c = app.statusCounts()
  const groups = app.model.hunts
    .map((hunt) => ({ hunt, steps: app.stepsOf(hunt) }))
    .filter((g) => g.steps.length > 0)
    .map((g) =>
      h(
        'section',
        { class: 'enc-codex-group', 'data-unit': g.hunt.unit },
        h('h2', {}, s.unitTitle(g.hunt.unit)),
        h(
          'ul',
          { class: 'enc-codex-grid' },
          g.steps.map((st) => {
            const found = app.found(st)
            return found
              ? h(
                  'li',
                  { class: 'enc-specimen is-found', testid: `codex-${st.id}`, 'data-found': 'true' },
                  h('span', { class: 'enc-medal', 'aria-hidden': 'true' }, '✦'),
                  h('h3', { class: 'enc-specimen-name' }, app.collectibleName(st)),
                  h('p', { class: 'enc-specimen-taught' }, h('span', { class: 'enc-specimen-taught-label' }, `${s.s('enc.codex.taught')}: `), app.taught(st)),
                  button(`codex-link-${st.id}`, s.s('enc.codex.read', { title: app.articleTitle(st.article) }), () => app.article(st.article, () => app.codex()), { class: 'btn btn-small enc-specimen-link' })
                )
              : h('li', { class: 'enc-specimen is-unknown', testid: `codex-${st.id}`, 'data-found': 'false' }, h('span', { class: 'enc-medal', 'aria-hidden': 'true' }, '?'), h('p', { class: 'enc-specimen-name' }, s.s('enc.codex.unknown')))
          })
        )
      )
    )
  return h(
    'div',
    { class: 'enc-codex' },
    h('h1', { class: 'screen-title enc-part-title', tabindex: '-1', testid: 'codex-title' }, s.s('enc.codex.title')),
    h('p', { class: 'enc-part-intro' }, s.s('enc.codex.intro')),
    h('p', { class: 'enc-codex-count', testid: 'codex-count', 'data-found': String(c.found), 'data-total': String(c.total) }, s.s('enc.codex.count', { found: c.found, total: c.total })),
    c.found === 0 ? h('p', { class: 'enc-codex-empty', testid: 'codex-empty' }, s.s('enc.codex.empty')) : null,
    groups
  )
}

/** The hunts: a card per hunt under its chapter, the grand hunt at the end, and the result of the hunt just finished. */
export function huntsBody(app: EncApp, result: HuntResult | null): HTMLElement {
  const s = app.s
  const units = s.units()
  const banner = result
    ? h(
        'div',
        { class: `enc-result${result.stars >= 2 ? ' is-good' : ''}`, role: 'group', 'aria-label': s.s('enc.res.title'), testid: 'hunt-result', 'data-stars': String(result.stars), 'data-final': result.final ? 'true' : 'false', 'data-collected': String(result.collected), 'data-total': String(result.total) },
        h('h2', { class: 'enc-result-title' }, s.s('enc.res.title')),
        s.stars(result.stars, 'hunt-result-stars'),
        h('p', { class: 'enc-result-text' }, app.resultText(result))
      )
    : null
  const chapters = units.flatMap((u, i) => {
    const hunts = app.model.hunts.filter((x) => x.unit === u.id)
    if (hunts.length === 0) return []
    const locked = !s.isUnlocked(u.id)
    const req = u.requires.find((r) => !s.isMastered(r))
    return [
      h(
        'section',
        { class: 'enc-hunt-chapter', 'data-unit': u.id, 'data-locked': locked ? 'true' : null, testid: `hunt-chapter-${u.id}` },
        h('div', { class: 'enc-hunt-chapter-head' }, h('h2', { class: 'enc-chapter-title' }, h('span', { class: 'enc-numeral', 'aria-hidden': 'true' }, roman(i + 1)), h('span', { class: 'enc-chapter-name' }, s.unitTitle(u.id))), s.stars(s.unitStars(u.id), `hunt-stars-${u.id}`)),
        hunts.map((hunt) => {
          const steps = app.stepsOf(hunt)
          const done = steps.filter((st) => app.found(st)).length
          const open = app.isHuntOpen(hunt)
          const intro = app.huntIntro(hunt)
          return h(
            'article',
            { class: 'enc-hunt-card', 'data-locked': open ? null : 'true' },
            h('h3', { class: 'enc-hunt-title' }, app.huntTitle(hunt)),
            intro ? h('p', { class: 'enc-hunt-intro' }, intro) : null,
            h('p', { class: 'enc-hunt-meta' }, `${s.s('enc.hunt.clues', { n: steps.length })} · ${s.s('enc.hunt.found', { found: done, n: steps.length })}`),
            steps.length === 0 ? h('p', { class: 'enc-hunt-note' }, s.s('enc.hunt.empty')) : locked ? h('p', { class: 'enc-hunt-note', testid: `hunt-locked-${hunt.id}` }, h('span', { 'aria-hidden': 'true' }, '\u{1F512} '), s.s('enc.hunt.locked', { unit: req ? s.unitTitle(req) : s.unitTitle(u.id) })) : null,
            button(`hunt-${hunt.id}`, done === steps.length && steps.length > 0 ? s.s('enc.hunt.again') : s.s('enc.hunt.start'), () => app.startHunt(hunt), {
              class: 'btn btn-primary enc-hunt-go',
              ...(open ? {} : { disabled: true }),
              'data-locked': open ? null : 'true',
              'data-stars': String(s.unitStars(u.id))
            })
          )
        })
      )
    ]
  })
  const finalOpen = app.isFinalOpen()
  const finalSteps = app.finalSteps()
  const grand =
    finalSteps.length > 0
      ? h(
          'section',
          { class: 'enc-hunt-chapter enc-grand', 'data-locked': finalOpen ? null : 'true', testid: 'hunt-chapter-final' },
          h('div', { class: 'enc-hunt-chapter-head' }, h('h2', { class: 'enc-chapter-title' }, h('span', { class: 'enc-numeral', 'aria-hidden': 'true' }, '★'), h('span', { class: 'enc-chapter-name' }, s.s('enc.hunt.final'))), s.stars(s.bossStars(), 'hunt-stars-final')),
          h(
            'article',
            { class: 'enc-hunt-card', 'data-locked': finalOpen ? null : 'true' },
            h('p', { class: 'enc-hunt-intro' }, s.s('enc.hunt.final.intro')),
            h('p', { class: 'enc-hunt-meta' }, s.s('enc.hunt.clues', { n: finalSteps.length })),
            finalOpen ? null : h('p', { class: 'enc-hunt-note', testid: 'hunt-locked-final' }, h('span', { 'aria-hidden': 'true' }, '\u{1F512} '), s.s('enc.hunt.final.locked')),
            button('hunt-final', s.bossStars() > 0 ? s.s('enc.hunt.again') : s.s('enc.hunt.start'), () => app.startFinal(), {
              class: 'btn btn-primary enc-hunt-go',
              ...(finalOpen ? {} : { disabled: true }),
              'data-locked': finalOpen ? null : 'true',
              'data-stars': String(s.bossStars())
            })
          )
        )
      : null
  return h(
    'div',
    { class: 'enc-hunts' },
    h('h1', { class: 'screen-title enc-part-title', tabindex: '-1', testid: 'hunts-title' }, s.s('enc.hunts.title')),
    h('p', { class: 'enc-part-intro' }, s.s('enc.hunts.intro')),
    banner,
    s.bossStars() >= 1 ? h('div', { class: 'actions' }, button('finish', s.s('enc.finish'), () => app.end(), { class: 'btn btn-big' })) : null,
    chapters,
    grand
  )
}
