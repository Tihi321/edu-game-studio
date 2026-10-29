import type { CourseLoadedView } from '../../../shared/protocol'
import { courseAssetUrl } from '../../api'
import { resolverFor } from '../../lib/course'
import { Empty, Pill } from '../common'

/** Images and audio of a course: a preview, the alt text (or description), the file and who uses it. */
export function AssetsTab({ slug, data }: { slug: string; data: CourseLoadedView }) {
  const { pack } = data
  const text = resolverFor(data)
  if (pack.assets.length === 0) {
    return (
      <Empty title="No assets yet" testId="assets-empty">
        <p>
          Assets are the pictures and sounds of a course: a map for a hotspot item, a clip for a listening item, art for an article. The art, music and voice tickets (EGS-15 to EGS-17) make them with ComfyUI, Pixel Studio, Chiptune Studio and Flow. Until then add a file to <code>course/assets/</code> and list it in <code>assets</code> of the pack.
        </p>
      </Empty>
    )
  }
  const usedBy = (id: string): string[] => [
    ...pack.items.filter((i) => i.asset === id || (i as unknown as { backAsset?: string }).backAsset === id).map((i) => `item ${i.id}`),
    ...pack.encyclopedia.articles.filter((a) => a.asset === id).map((a) => `article ${a.id}`),
    ...pack.cues.filter((c) => c.asset === id).map((c) => `cue ${c.id} (${c.on})`)
  ]
  return (
    <div className="tab-body" data-testid="tab-assets">
      <h2 className="sr-only">Assets of this course</h2>
      <ul className="assets" data-testid="asset-list">
        {pack.assets.map((a) => {
          const url = courseAssetUrl(slug, a.file)
          const uses = usedBy(a.id)
          return (
            <li key={a.id} className="asset" data-testid={`asset-${a.id}`}>
              <div className="asset-media">
                {a.kind === 'image' ? (
                  <img src={url} alt={text.t(a.alt)} loading="lazy" />
                ) : (
                  <audio controls preload="none" src={url} aria-label={text.t(a.alt)} data-testid={`asset-audio-${a.id}`} />
                )}
              </div>
              <div className="asset-info">
                <h3>
                  {a.id} <Pill tone="dim">{a.kind}</Pill>
                </h3>
                <p>{text.t(a.alt)}</p>
                <p className="dim">
                  <code>{a.file}</code>
                </p>
                <p className="dim">{uses.length > 0 ? `Used by ${uses.join(', ')}.` : 'Not used by any item, article or cue.'}</p>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
