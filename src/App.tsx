import { useEffect, useState } from 'react'
import { ChevronRight, Menu, Moon, Settings, Sun } from 'lucide-react'
import { LESSONS, lessonById, shortTitle } from '@shared/lessons'
import { trackById } from '@shared/tracks'
import type { EmulatorStatus } from '@shared/types'
import { api } from '@/lib/api'
import { isDone, useProgress } from '@/lib/progress'
import { LLM_CHANGED, OPEN_SETTINGS } from '@/lib/llm'
import { useCurrentStep } from '@/lib/step'
import { readLocal, useLocal, writeLocal } from '@/lib/store'
import { SettingsDialog } from '@/components/SettingsDialog'
import { ProgressMenu } from '@/components/ProgressMenu'
import { SideNav } from '@/components/SideNav'
import { About } from '@/pages/About'
import { ExamPage } from '@/pages/ExamPage'
import { ExamModePage } from '@/pages/ExamModePage'
import { LessonPage } from '@/pages/LessonPage'
import { Trail } from '@/pages/Trail'
import { Footer } from '@/components/Footer'

function useRoute() {
  const [hash, setHash] = useState(() => {
    if (!location.hash && !readLocal('seen-about', false)) { writeLocal('seen-about', true); return '#/about' }
    return location.hash || '#/'
  })
  useEffect(() => { const f = () => setHash(location.hash || '#/'); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f) }, [])
  return hash
}

const PHASE_LABEL: Record<string, string> = { ready: 'Emulator running', starting: 'Emulator starting', 'building-image': 'Building image', 'docker-missing': 'Docker not running', error: 'Emulator error' }

export default function App() {
  const route = useRoute()
  const [theme, setTheme] = useLocal<'dark' | 'light'>('theme', 'dark')
  const [navOpen, setNavOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [status, setStatus] = useState<EmulatorStatus | null>(null)
  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
  useEffect(() => { setNavOpen(false) }, [route])
  useEffect(() => {
    let alive = true
    const tick = () => api.status().then((s) => alive && setStatus(s)).catch(() => alive && setStatus(null))
    void tick()
    const t = setInterval(tick, 2000)
    const open = () => setSettingsOpen(true)
    addEventListener(OPEN_SETTINGS, open)
    addEventListener(LLM_CHANGED, tick)
    return () => { alive = false; clearInterval(t); removeEventListener(OPEN_SETTINGS, open); removeEventListener(LLM_CHANGED, tick) }
  }, [])
  const progress = useProgress()
  const step = useCurrentStep()
  const m = route.match(/^#\/lesson\/([\w-]+)/)
  const lesson = m ? lessonById(m[1]) : undefined
  const em = route.match(/^#\/exam\/([\w-]+)/)
  const examTrack = em && trackById(em[1])?.exam ? trackById(em[1]) : undefined
  const page = route.startsWith('#/about') ? 'about' : route.startsWith('#/exam-mode') ? 'exammode' : lesson ? 'lesson' : examTrack ? 'exam' : 'trail'
  const phase = status?.phase ?? 'offline'
  const crumbs: { label: string; href?: string }[] = [{ label: 'Cloud Dojo', href: '#/' }]
  if (page === 'about') crumbs.push({ label: 'About Cloud Dojo' })
  else if (page === 'exammode') crumbs.push({ label: 'Tracks', href: '#/' }, { label: 'Exam mode' })
  else if (page === 'trail') crumbs.push({ label: 'Tracks' })
  else if (examTrack) crumbs.push({ label: 'Tracks', href: '#/' }, { label: examTrack.title, href: `#/lesson/${LESSONS.find((l) => l.trackId === examTrack.id)?.id}` }, { label: 'Track exam' })
  else if (lesson) {
    const tr = trackById(lesson.trackId)
    crumbs.push({ label: 'Tracks', href: '#/' }, { label: tr?.title ?? 'Track', href: `#/lesson/${LESSONS.find((l) => l.trackId === lesson.trackId)?.id}` })
    const s = step?.lesson === lesson.id ? step : null
    crumbs.push(s ? { label: `${lesson.n} ${shortTitle(lesson)}`, href: `#/lesson/${lesson.id}` } : { label: `${lesson.n} ${shortTitle(lesson)}` })
    if (s) crumbs.push({ label: s.title.replace(/^Break it: /, 'Break it: ') })
  }
  const doneCount = LESSONS.filter((l) => isDone(progress, l.id)).length

  return (
    <div className="app">
      <header className="topbar">
        <button className="iconbtn only-narrow" onClick={() => setNavOpen((o) => !o)} aria-label="Tracks menu" aria-expanded={navOpen}><Menu size={18} /></button>
        <a className="brand" href="#/"><span className="logo" aria-hidden="true"><i /><i /><i /></span><b>Cloud Dojo</b></a>
        <span className="unofficial" title="Independent project built on AWS Emulator. Not affiliated with, endorsed by, or sponsored by Amazon Web Services.">runs on the AWS emulator · independent project</span>
        <span className="grow" />
        <nav className="topnav" aria-label="Main">
          <a href="#/" aria-current={page === 'trail' || page === 'lesson' || page === 'exam' ? 'page' : undefined}>Tracks</a>
          <a href="#/exam-mode" aria-current={page === 'exammode' ? 'page' : undefined}>Exam mode</a>
          <a href="#/about" aria-current={page === 'about' ? 'page' : undefined}>About</a>
        </nav>
        <div className={`pill ${phase}`} title={status?.message ?? 'Server not reachable. Is `bun run dev` running?'} role="status">
          <i />{PHASE_LABEL[phase] ?? 'Server not reachable'}<span className="region">us-east-1</span>
        </div>
        <button className="iconbtn" onClick={() => setSettingsOpen(true)} aria-label="Tutor settings" title="Tutor settings"><Settings size={16} /></button>
        <ProgressMenu onTheme={setTheme} />
        <button className="iconbtn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
      </header>
      <div className="crumbbar">
        <nav aria-label="Breadcrumb"><ol className="crumbs">
          {crumbs.map((c, i) => (
            <li key={i}>{i > 0 && <ChevronRight size={14} aria-hidden="true" />}{c.href && i < crumbs.length - 1 ? <a href={c.href}>{c.label}</a> : <span aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{c.label}</span>}</li>
          ))}
        </ol></nav>
        <span className="grow" />
        <span className="crumbmeta">{doneCount} of {LESSONS.length} modules completed</span>
      </div>
      <div className={`body ${navOpen ? 'nav-open' : ''}`}>
        <SideNav activeId={lesson?.id} examTrack={examTrack?.id} page={page} />
        {navOpen && <button className="scrim" aria-label="Close menu" onClick={() => setNavOpen(false)} />}
        <main className={`main m-${page}`}>
          {page === 'about' && <About />}
          {page === 'trail' && <Trail />}
          {page === 'exammode' && <ExamModePage />}
          {page === 'exam' && examTrack && <ExamPage key={examTrack.id} trackId={examTrack.id} />}
          {page === 'lesson' && lesson && <LessonPage key={lesson.id} id={lesson.id} status={status} />}
        </main>
      </div>
      <Footer />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} tutor={status?.tutor} />
    </div>
  )
}
