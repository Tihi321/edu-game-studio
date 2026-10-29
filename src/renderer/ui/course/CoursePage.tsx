import { useEffect, type CSSProperties } from 'react'
import { loadCourse } from '../../api'
import { courseTheme, courseTitle, langName, mainShell } from '../../lib/course'
import { useEdu } from '../../store/hooks'
import { COURSE_TABS, eduStore, type CourseTab } from '../../store/store'
import { ErrorBox, Loading, TabPanel, Tabs } from '../common'
import { AssetsTab } from './AssetsTab'
import { BriefTab } from './BriefTab'
import { BuildTab } from './BuildTab'
import { CurriculumTab } from './CurriculumTab'
import { EditionsTab } from './EditionsTab'
import { EncyclopediaTab } from './EncyclopediaTab'
import { GameTab } from './GameTab'
import { ItemsTab } from './ItemsTab'
import { PlaytestTab } from './PlaytestTab'
import { VoiceTab } from './VoiceTab'

/** One course: its title and look, and the tabs of the work: Brief, Curriculum, Encyclopedia, Items, Game, Assets, Voice, Editions, Build, Playtest. */
export function CoursePage({ slug }: { slug: string }) {
  const doc = useEdu((s) => s.docs[slug])
  const tab = useEdu((s) => s.courseTab)
  // a fresh read every time the course is opened (it may have changed on disk through MCP)
  useEffect(() => {
    loadCourse(slug)
  }, [slug])
  const data = doc?.data
  const back = (
    <button className="back" onClick={() => eduStore.getState().setPage('courses')} data-testid="course-back">
      Library
    </button>
  )
  if (!data) {
    return (
      <div className="page-body" data-testid="page-course">
        <nav aria-label="Breadcrumb">{back}</nav>
        <h1>{slug}</h1>
        {doc?.error ? <ErrorBox title="This course could not be read" message={doc.error} onRetry={() => loadCourse(slug)} testId="course-error" /> : <Loading label="Reading the course files" testId="course-loading" />}
      </div>
    )
  }
  const theme = courseTheme(data.pack)
  const title = courseTitle(data)
  return (
    <div className="page-body" data-testid="page-course" data-course={slug}>
      <nav aria-label="Breadcrumb">{back}</nav>
      <header className="course-head" style={{ '--cv-bg': theme.swatch.bg, '--cv-accent': theme.swatch.accent } as CSSProperties}>
        <div>
          <h1 data-testid="course-title">{title}</h1>
          <p className="course-meta" data-testid="course-meta">
            {data.pack.languages.map((l) => langName(l)).join(', ')}
            {data.pack.targetLang ? `, teaches ${langName(data.pack.targetLang)}` : ''}
            {data.pack.cefr ? `, level ${data.pack.cefr}` : ''}
            {`, ${mainShell(data.pack)} game`}
          </p>
        </div>
        <div className="theme-strip" data-testid="course-theme" title={`${theme.label}: ${theme.description}`}>
          <span className="swatches" aria-hidden="true">
            {Object.values(theme.swatch).map((c) => (
              <i key={c} style={{ background: c }} />
            ))}
          </span>
          <span>{theme.label}</span>
        </div>
      </header>
      {doc?.error && <ErrorBox title="The course could not be refreshed" message={doc.error} onRetry={() => loadCourse(slug)} testId="course-refresh-error" />}
      <Tabs tabs={COURSE_TABS} value={tab} onChange={(id: CourseTab) => eduStore.getState().setCourseTab(id)} prefix="course" label={`${title}, sections`} />
      <TabPanel prefix="course" active={tab}>
        {tab === 'brief' && <BriefTab slug={slug} data={data} />}
        {tab === 'curriculum' && <CurriculumTab slug={slug} data={data} />}
        {tab === 'encyclopedia' && <EncyclopediaTab slug={slug} data={data} />}
        {tab === 'items' && <ItemsTab slug={slug} data={data} doc={doc} />}
        {tab === 'game' && <GameTab slug={slug} data={data} />}
        {tab === 'assets' && <AssetsTab slug={slug} data={data} />}
        {tab === 'voice' && <VoiceTab slug={slug} data={data} />}
        {tab === 'editions' && <EditionsTab data={data} />}
        {tab === 'build' && <BuildTab slug={slug} data={data} doc={doc} />}
        {tab === 'playtest' && <PlaytestTab slug={slug} data={data} />}
      </TabPanel>
    </div>
  )
}
