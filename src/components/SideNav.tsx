import { useState } from 'react'
import { BookOpen, Check, ChevronDown, ChevronRight, GraduationCap, Info, Timer } from 'lucide-react'
import { LESSONS, lessonById, modulesOf, shortTitle } from '@shared/lessons'
import { TRACKS } from '@shared/tracks'
import { effectiveHonesty, useCapabilities } from '@/lib/capabilities'
import { isDone, kindOf, useProgress } from '@/lib/progress'
import { readLocal, writeLocal } from '@/lib/store'
import { useCurrentStep } from '@/lib/step'
import { ServiceTile, serviceForTrack } from '@/lib/services'
import { HonestyBadge } from './Honesty'

export function SideNav({ activeId, examTrack, page }: { activeId?: string; examTrack?: string; page: string }) {
  const progress = useProgress()
  const caps = useCapabilities()
  const step = useCurrentStep()
  const activeTrack = activeId ? lessonById(activeId)?.trackId : examTrack
  const [prefs, setPrefs] = useState<Record<string, boolean>>(() => readLocal('nav-open', {}))
  const n = LESSONS.filter((l) => isDone(progress, l.id)).length
  const isOpen = (id: string) => id === activeTrack || (prefs[id] ?? (id === 'dynamodb' || id === 'messaging'))
  const toggle = (id: string) => setPrefs((c) => { const v = { ...c, [id]: !(c[id] ?? (id === 'dynamodb' || id === 'messaging')) }; writeLocal('nav-open', v); return v })
  return (
    <aside className="sidenav" aria-label="Tracks and modules">
      <nav>
        <a className="navitem top" href="#/" aria-current={page === 'trail' ? 'page' : undefined}><BookOpen size={16} />All tracks</a>
        <a className="navitem top" href="#/exam-mode" aria-current={page === 'exammode' ? 'page' : undefined}><Timer size={16} />Exam mode</a>
        <div className="navhead">Tracks</div>
        <ul className="navtracks">
          {TRACKS.map((t) => {
            const mods = modulesOf(t.id)
            const done = mods.filter((m) => isDone(progress, m.id)).length
            // the track you are in stays open; the others follow the saved preference (the two deep tracks start open)
            const open = isOpen(t.id)
            return (
              <li key={t.id} className="ntrack">
                <button className="thead" aria-expanded={open} aria-controls={`nt-${t.id}`} onClick={() => toggle(t.id)}>
                  {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <ServiceTile svc={serviceForTrack(t.id)} size={20} />
                  <span className="tn">{t.n === '★' ? '' : `${t.n} `}{t.title}</span>
                  <span className="tc">{done}/{mods.length}</span>
                </button>
                {open && (
                  <ol id={`nt-${t.id}`} className="nmods">
                    {mods.map((m) => (
                      <li key={m.id}>
                        <a className="navitem" href={`#/lesson/${m.id}`} aria-current={activeId === m.id ? 'page' : undefined}>
                          <span className="lnum">{m.n}</span>
                          <span className="navtext"><span className="navtitle">{shortTitle(m)}</span></span>
                          {m.honesty !== 'live' || effectiveHonesty(m, caps.report) !== 'live' ? <HonestyBadge honesty={effectiveHonesty(m, caps.report)} compact /> : null}
                          {isDone(progress, m.id) ? <Check className="navdone" size={15} strokeWidth={2.6} aria-label={kindOf(progress, m.id) === 'manual' ? 'Marked as done by you' : 'Verified'} /> : null}
                        </a>
                        {activeId === m.id && (
                          <ol className="nsteps" aria-label="Steps in this module">
                            {m.steps.map((s, i) => (
                              <li key={s.id}><a href={`#/lesson/${m.id}`} className={step?.lesson === m.id && step.step === s.id ? 'cur' : ''} aria-current={step?.lesson === m.id && step.step === s.id ? 'step' : undefined}
                                onClick={(e) => { e.preventDefault(); document.getElementById(`step-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}><span>{i + 1}</span>{s.title.replace(/^Break it: /, '')}</a></li>
                            ))}
                          </ol>
                        )}
                      </li>
                    ))}
                    {t.exam && (
                      <li><a className="navitem" href={`#/exam/${t.id}`} aria-current={examTrack === t.id ? 'page' : undefined}><span className="lnum"><GraduationCap size={12} /></span><span className="navtext"><span className="navtitle">Track exam</span></span><span className="count">{t.exam.length} Qs</span></a></li>
                    )}
                  </ol>
                )}
              </li>
            )
          })}
        </ul>
        <div className="navhead">Resources</div>
        <a className="navitem top" href="#/about" aria-current={page === 'about' ? 'page' : undefined}><Info size={16} />About Cloud Dojo</a>
      </nav>
      <div className="navfoot">
        <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={LESSONS.length} aria-valuenow={n} aria-label="Modules completed"><i style={{ width: `${(n / LESSONS.length) * 100}%` }} /></div>
        <span>{n} of {LESSONS.length} modules completed</span>
        <p>Independent project. Runs on AWS Emulator v1.0.341 in Docker, in memory, no AWS account.</p>
      </div>
    </aside>
  )
}
