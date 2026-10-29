import { useState } from 'react'
import type { CourseLoadedView } from '../../../shared/protocol'
import { courseAssetUrl } from '../../api'
import { resolverFor } from '../../lib/course'
import { Empty } from '../common'

/** The encyclopedia articles: a list and a reader with the sources each article cites and the articles it links to. */
export function EncyclopediaTab({ slug, data }: { slug: string; data: CourseLoadedView }) {
  const { pack } = data
  const text = resolverFor(data)
  const articles = pack.encyclopedia.articles
  const [picked, setPicked] = useState<string | null>(articles[0]?.id ?? null)
  if (articles.length === 0) {
    return (
      <Empty title="No encyclopedia articles yet" testId="articles-empty">
        <p>
          An article explains a unit in running text, with the sources it cites, and the encyclopedia shell lets the learner browse them. Articles are part of the course edit: <code>edu_course_edit</code> with <code>{'{"encyclopedia": {"articles": [...]}}'}</code>, or the subject-expert role once the content roles arrive (EGS-07).
        </p>
      </Empty>
    )
  }
  const article = articles.find((a) => a.id === picked) ?? articles[0]
  if (!article) return null
  const asset = article.asset ? pack.assets.find((a) => a.id === article.asset) : undefined
  const unit = article.unit ? pack.units.find((u) => u.id === article.unit) : undefined
  const paragraphs = text.t(article.body).split(/\n{2,}/)
  return (
    <div className="split" data-testid="tab-encyclopedia">
      <nav className="article-list" aria-label="Articles">
        <ul>
          {articles.map((a) => (
            <li key={a.id}>
              <button className={a.id === article.id ? 'item-row on' : 'item-row'} aria-current={a.id === article.id ? 'true' : undefined} onClick={() => setPicked(a.id)} data-testid={`article-${a.id}`}>
                <span className="item-row-prompt">{text.t(a.title)}</span>
                <span className="item-row-meta dim">{a.citations.length} {a.citations.length === 1 ? 'source' : 'sources'}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <article className="reader" data-testid="article-reader" aria-labelledby="article-title">
        <h2 id="article-title" className="reader-title">
          {text.t(article.title)}
        </h2>
        {unit && <p className="dim">Belongs to the unit “{text.t(unit.title)}”.</p>}
        {asset && asset.kind === 'image' && (
          <figure className="reader-figure">
            <img src={courseAssetUrl(slug, asset.file)} alt={text.t(asset.alt)} data-testid="article-image" />
            <figcaption className="dim">{text.t(asset.alt)}</figcaption>
          </figure>
        )}
        {paragraphs.map((p, i) => (
          <p key={i} className="reader-text">
            {p}
          </p>
        ))}
        {article.citations.length > 0 && (
          <section aria-labelledby="article-sources">
            <h3 id="article-sources" className="sub-title">
              Sources
            </h3>
            <ul className="sources" data-testid="article-sources">
              {article.citations.map((id) => {
                const f = pack.factbase.find((x) => x.id === id)
                return (
                  <li key={id}>
                    {f?.url ? (
                      <a href={f.url} target="_blank" rel="noreferrer noopener" data-testid={`source-${id}`}>
                        {f.source}
                      </a>
                    ) : (
                      <span>{f?.source ?? id}</span>
                    )}
                    {f?.claim && <span className="dim"> {text.t(f.claim)}</span>}
                  </li>
                )
              })}
            </ul>
          </section>
        )}
        {article.related.length > 0 && (
          <section aria-labelledby="article-related">
            <h3 id="article-related" className="sub-title">
              Related articles
            </h3>
            <p className="row">
              {article.related.map((id) => {
                const r = articles.find((a) => a.id === id)
                return (
                  <button key={id} onClick={() => r && setPicked(id)} disabled={!r} data-testid={`related-${id}`}>
                    {r ? text.t(r.title) : id}
                  </button>
                )
              })}
            </p>
          </section>
        )}
      </article>
    </div>
  )
}
