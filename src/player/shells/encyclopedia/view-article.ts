import { button, h, type Child } from '../../dom'
import type { EncApp } from './app'
import type { Seg } from './articles'

const host = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** A paragraph of runs of text and links (a link is a button: it opens the other article and `back` returns here). */
function paragraph(app: EncApp, id: string, segs: readonly Seg[]): HTMLElement {
  return h(
    'p',
    {},
    segs.map((seg): Child =>
      seg.link
        ? button(`link-${seg.link}`, seg.text, () => app.article(seg.link as string, () => app.article(id)), { class: 'enc-xlink' })
        : seg.text
    )
  )
}

/**
 * One article, laid out as a spread: the text page (running head, title, the collect seal when this page answers the pinned clue, the body
 * with its drop cap and cross-links) and the plate page (the picture with its caption, the audio, "See also", the sources).
 */
export function articleScreenBody(app: EncApp, id: string): HTMLElement {
  const s = app.s
  const a = app.arts.get(id)
  if (!a) return h('div', {})
  const unit = a.unit ? s.unitTitle(a.unit) : ''
  const asset = a.assetId ? s.pack.assets.find((x) => x.id === a.assetId) : undefined
  const url = asset ? s.data.assets[asset.id] : undefined
  const pinned = app.pinned()
  const collect = pinned && pinned.step.article === id ? pinned : null

  const seal = collect
    ? h(
        'div',
        { class: 'enc-collect' },
        h('span', { class: 'enc-collect-hint' }, collect.retry ? s.s('enc.clue.retry') : s.s('enc.collect.hint')),
        button(`collect-${collect.step.id}`, h('span', { class: 'enc-seal-label' }, s.s('enc.collect', { name: app.collectibleName(collect.step) })), () => app.collect(collect.step), {
          class: 'btn btn-primary btn-big enc-seal',
          'data-autofocus': ''
        })
      )
    : null

  const figure =
    asset && url && asset.kind === 'image'
      ? h('figure', { class: 'enc-figure', testid: 'article-figure' }, h('div', { class: 'enc-figure-frame' }, h('img', { src: url, alt: s.t(asset.alt) })), h('figcaption', {}, s.t(asset.alt)))
      : null

  let audio: HTMLButtonElement | null = null
  if (asset && url && asset.kind === 'audio') {
    const label = (playing: boolean): string => `${playing ? '■' : '▶'} ${s.s(playing ? 'enc.audio.stop' : 'enc.audio.play')}`
    audio = button(
      'article-audio',
      label(false),
      () => {
        if (app.audio) {
          app.stopAudio()
          if (audio) audio.textContent = label(false)
          return
        }
        try {
          const el = new Audio(url)
          app.audio = el
          el.onended = () => {
            if (app.audio === el) app.audio = null
            if (audio) audio.textContent = label(false)
          }
          void el.play().catch(() => undefined)
          if (audio) audio.textContent = label(true)
        } catch {
          app.audio = null
        }
      },
      { class: 'btn btn-small enc-audio', 'aria-describedby': 'enc-audio-desc' }
    )
  }

  const related = a.related.filter((r) => app.arts.has(r))
  const facts = new Map(s.pack.factbase.map((f) => [f.id, f]))
  const cites = a.citations.map((c) => facts.get(c)).filter((f): f is NonNullable<typeof f> => !!f)
  const segs = app.segments(id)

  return h(
    'div',
    { class: 'enc-article' },
    h('div', { class: 'enc-toolbar' }, button('back', `‹ ${s.s('enc.back')}`, () => app.back(), { class: 'btn btn-small btn-ghost' })),
    h(
      'article',
      { class: 'enc-spread', testid: 'article', 'data-article': id },
      h(
        'div',
        { class: 'enc-text' },
        h('p', { class: 'enc-runhead' }, h('span', {}, unit || s.s('enc.runhead')), h('span', { class: 'enc-runhead-sep', 'aria-hidden': 'true' }, '❦'), h('span', {}, s.courseTitle())),
        h('h1', { class: 'screen-title enc-article-title', tabindex: '-1', testid: 'article-title' }, a.title),
        h('p', { class: 'enc-rule', 'aria-hidden': 'true' }),
        seal,
        h('div', { class: 'enc-body', testid: 'article-body' }, segs.map((sg) => paragraph(app, id, sg)))
      ),
      h(
        'aside',
        { class: 'enc-plates' },
        figure,
        audio ? h('div', { class: 'enc-audio-wrap' }, audio, h('span', { class: 'sr-only', id: 'enc-audio-desc' }, asset ? s.t(asset.alt) : '')) : null,
        related.length > 0
          ? h(
              'section',
              { class: 'enc-related', testid: 'related' },
              h('h2', {}, s.s('enc.seeAlso')),
              h('ul', {}, related.map((r) => h('li', {}, button(`related-${r}`, app.articleTitle(r), () => app.article(r, () => app.article(id)), { class: 'enc-related-btn' }))))
            )
          : null,
        cites.length > 0
          ? h(
              'section',
              { class: 'enc-sources', testid: 'citations' },
              h('h2', {}, s.s('enc.sources')),
              h(
                'ul',
                {},
                cites.map((f) =>
                  h(
                    'li',
                    { testid: `citation-${f.id}` },
                    h('span', { class: 'enc-source-name' }, f.source),
                    f.claim && s.text.hasText(f.claim) ? h('span', { class: 'enc-source-claim' }, s.t(f.claim)) : null,
                    f.url ? h('a', { class: 'enc-source-link', href: f.url, target: '_blank', rel: 'noopener noreferrer', testid: `citation-link-${f.id}` }, host(f.url), h('span', { class: 'sr-only' }, ` (${s.s('enc.openSource')})`)) : null
                  )
                )
              )
            )
          : null
      )
    )
  )
}
