import { useEffect, useRef } from 'react'
import { Clock, GraduationCap } from 'lucide-react'
import { lessonById, shortTitle } from '@shared/lessons'
import { trackById } from '@shared/tracks'
import type { CapabilityReport, LessonContent } from '@shared/types'
import { effectiveHonesty } from '@/lib/capabilities'
import { setCurrentStep } from '@/lib/step'
import { ServiceTile, serviceFor } from '@/lib/services'
import { CommandBlock } from './CommandBlock'
import { HonestyBadge, HonestyState } from './Honesty'
import { Inline } from './Inline'
import { PredictCard } from './Predict'

const LEVEL: Record<string, string> = { core: 'Core', intermediate: 'Intermediate', advanced: 'Advanced' }

export function Manual({ lesson, onSend, extra, report }: { lesson: LessonContent; onSend: (c: string) => void; extra?: React.ReactNode; report: CapabilityReport | null }) {
  const svc = serviceFor(lesson.id)
  const track = trackById(lesson.trackId)
  const honesty = effectiveHonesty(lesson, report)
  const root = useRef<HTMLElement>(null)

  // scroll-spy: the step nearest the top of the manual is "the current step" in the breadcrumb and side nav
  useEffect(() => {
    const el = root.current
    if (!el) return
    const items = [...el.querySelectorAll<HTMLElement>('[data-step]')]
    const pick = () => {
      const top = el.getBoundingClientRect().top + 80
      let cur: HTMLElement | undefined
      for (const it of items) if (it.getBoundingClientRect().top <= top) cur = it
      setCurrentStep(cur ? { lesson: lesson.id, step: cur.dataset.step!, title: cur.dataset.title! } : null)
    }
    pick()
    el.addEventListener('scroll', pick, { passive: true })
    return () => { el.removeEventListener('scroll', pick); setCurrentStep(null) }
  }, [lesson.id])

  return (
    <article className="manual" aria-label="Lesson" ref={root}>
      <div className="manual-in">
        <div className="lhead">
          <ServiceTile svc={svc} size={40} />
          <div>
            <h1><span className="lnum big">{lesson.n}</span>{lesson.title}</h1>
            <p className="tag">{lesson.tagline}</p>
          </div>
        </div>
        <ul className="metarow" aria-label="Module details">
          <li><HonestyBadge honesty={honesty} note={lesson.honestyNote} /></li>
          <li className="chip">{LEVEL[lesson.level]}</li>
          <li className="chip"><Clock size={12} />{lesson.estMinutes} min</li>
          {lesson.examTags.map((t) => <li key={t} className="chip mono" title="Exam domain this module supports"><GraduationCap size={12} />{t}</li>)}
        </ul>
        {honesty !== 'live' && <HonestyState honesty={honesty} note={lesson.honestyNote} flipped={lesson.honesty !== honesty} />}
        {honesty === 'live' && lesson.honestyNote && <p className="hnote"><b>On this emulator:</b> {lesson.honestyNote}</p>}
        {lesson.prereqs.length > 0 && <p className="prereq">Worth doing first: {lesson.prereqs.map((p, i) => { const m = lessonById(p); return m ? <span key={p}>{i ? ', ' : ''}<a href={`#/lesson/${p}`}>{m.n} {shortTitle(m)}</a></span> : null })}. Not required: this module sets up everything it needs.</p>}
        {lesson.concept.map((p, i) => <p key={i}><Inline text={p} /></p>)}
        <div className="goal"><b>Goal</b><span><Inline text={lesson.goal} /></span></div>
        <PredictCard lesson={lesson} />
        {extra}
        <h2>Steps</h2>
        <ol className="steps">
          {lesson.steps.map((s) => (
            <li key={s.id} id={`step-${s.id}`} data-step={s.id} data-title={s.title} className={`step ${s.breakIt ? 'break' : ''}`}>
              <h3>{s.title}{s.breakIt && <span className="tagchip">Break it on purpose</span>}</h3>
              <p><Inline text={s.body} /></p>
              {s.code && <figure className="snippet"><figcaption className="mono">{s.code.file ?? 'snippet'}</figcaption><pre>{s.code.text}</pre></figure>}
              {s.commands?.map((c, i) => <CommandBlock key={i} command={c} onSend={onSend} />)}
            </li>
          ))}
        </ol>
        <h2>Break it, on purpose</h2>
        <div className="container pad">
          <p><b>{lesson.breakIt.title}</b></p>
          {lesson.breakIt.explain.map((p, i) => <p key={i}><Inline text={p} /></p>)}
        </div>
        <section className="container real" aria-label="Real AWS cost and differences">
          <header><h2>On real AWS: cost and differences</h2></header>
          <div className="pad">
            <h3>Cost</h3>
            <ul>{lesson.realAws.cost.map((c, i) => <li key={i}><Inline text={c} /></li>)}</ul>
            <h3>What differs from the emulator</h3>
            <ul>{lesson.realAws.differences.map((c, i) => <li key={i}><Inline text={c} /></li>)}</ul>
            <p className="asof">Prices as of {lesson.realAws.asOf}; list prices change, check the page. {lesson.realAws.sources.map((s, i) => <span key={s.url}>{i ? ' · ' : 'Sources: '}<a href={s.url} target="_blank" rel="noreferrer">{s.label}</a></span>)}</p>
            <div className="fid" title="Fidelity tests that passed against real AWS, AWS Emulator v1.0.341, single-service tests">
              {lesson.fidelity.map((f) => <span key={f.service} className="chip">{f.service}: {f.pass}/{f.total} AWS-verified tests pass ({Math.round((f.pass / f.total) * 100)}%)</span>)}
            </div>
          </div>
        </section>
        {track?.exam && <a className="examlink" href={`#/exam/${track.id}`}><GraduationCap size={16} /><span><b>{track.title} track exam</b> {track.exam.length} scenario questions across the track, tagged by exam domain</span></a>}
      </div>
    </article>
  )
}
