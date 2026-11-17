import { ArrowRight, Check, Clock, GraduationCap, Timer } from 'lucide-react'
import { LESSONS, modulesOf, shortTitle } from '@shared/lessons'
import { TRACKS } from '@shared/tracks'
import type { Track } from '@shared/types'
import { effectiveHonesty, useCapabilities } from '@/lib/capabilities'
import { isDone, useProgress } from '@/lib/progress'
import { ServiceTile, serviceForTrack } from '@/lib/services'
import { HonestyBadge, HonestyLegend } from '@/components/Honesty'
import { Status } from '@/components/Status'
import { Readiness } from '@/components/Readiness'
import { continueTarget } from '@shared/continue'

function TrackCard({ track }: { track: Track }) {
  const progress = useProgress()
  const caps = useCapabilities()
  const mods = modulesOf(track.id)
  const done = mods.filter((m) => isDone(progress, m.id)).length
  const next = mods.find((m) => !isDone(progress, m.id)) ?? mods[0]
  const minutes = mods.reduce((n, m) => n + m.estMinutes, 0)
  const exam = progress?.tracks.find((t) => t.id === track.id)
  const started = done > 0 || mods.some((m) => (progress?.modules[m.id]?.checksPassed.length ?? 0) > 0)
  return (
    <article className="track" aria-labelledby={`t-${track.id}`}>
      <header>
        <ServiceTile svc={serviceForTrack(track.id)} size={36} />
        <div className="tname">
          <h3 id={`t-${track.id}`}><span className="lnum">{track.n}</span>{track.title}</h3>
          <p>{track.blurb}</p>
        </div>
      </header>
      <div className="trackprog">
        <div className="seg" role="img" aria-label={`${done} of ${mods.length} modules completed`}>{mods.map((m) => <i key={m.id} className={isDone(progress, m.id) ? 'on' : (progress?.modules[m.id]?.checksPassed.length ?? 0) > 0 ? 'part' : ''} />)}</div>
        <span className="count"><b>{done}</b> of {mods.length} modules</span>
        <span className="count"><Clock size={12} />{minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60 ? `${minutes % 60} min` : ''}` : `${minutes} min`}</span>
      </div>
      <ol className="mods">
        {mods.map((m) => {
          const d = isDone(progress, m.id)
          const part = (progress?.modules[m.id]?.checksPassed.length ?? 0) > 0
          return (
            <li key={m.id}>
              <a href={`#/lesson/${m.id}`}>
                <span className="lnum">{m.n}</span>
                <span className="mtitle">{shortTitle(m)}</span>
                <HonestyBadge honesty={effectiveHonesty(m, caps.report)} note={m.honestyNote} compact />
                <span className="mstate">{d ? <Status kind="pass" label="Done" /> : part ? <Status kind="progress" label="Started" /> : <span className="mmin">{m.estMinutes} min</span>}</span>
              </a>
            </li>
          )
        })}
      </ol>
      <footer>
        <ul className="tags">{track.exams.map((e) => <li key={e} className="chip mono">{e}</li>)}</ul>
        <div className="tfoot">
          {track.exam ? (
            <a className="btn sm" href={`#/exam/${track.id}`}><GraduationCap size={13} />{exam && exam.examCorrect > 0 ? `Exam ${exam.examCorrect}/${exam.examTotal}` : `Track exam (${track.exam.length})`}</a>
          ) : <span />}
          {next ? <a className="btn sm primary" href={`#/lesson/${next.id}`}>{done === mods.length ? <><Check size={13} />Review</> : started ? 'Continue' : 'Start'}<ArrowRight size={13} /></a> : <span className="count">Modules coming soon</span>}
        </div>
      </footer>
    </article>
  )
}

function ContinueCard() {
  const progress = useProgress()
  const t = continueTarget(progress?.modules, LESSONS)
  if (!t) return null
  const track = TRACKS.find((x) => x.id === t.lesson.trackId)
  return (
    <section className="container continue" aria-label="Continue where you left off">
      <div className="cwhere">
        <ServiceTile svc={serviceForTrack(t.lesson.trackId)} size={36} />
        <div>
          <h2>{t.started ? 'Continue where you left off' : 'Start here'}</h2>
          <p><span className="lnum">{t.lesson.n}</span><b>{shortTitle(t.lesson)}</b><span className="count">{track?.title}</span></p>
        </div>
      </div>
      <span className="count cchecks">{t.started ? `${t.passed} of ${t.total} checks passed` : `${t.total} checks, ${t.lesson.estMinutes} min`}</span>
      <a className="btn primary" href={`#/lesson/${t.lesson.id}`}>{t.started ? 'Continue' : 'Start'}<ArrowRight size={14} /></a>
    </section>
  )
}

function ExamModeCard() {
  const progress = useProgress()
  const last = progress?.examAttempts.at(-1)
  const best = progress?.examAttempts.reduce((n, a) => Math.max(n, Math.round((100 * a.score) / a.total)), 0)
  return (
    <section className="container exammodecard" aria-label="Exam mode">
      <div className="cwhere">
        <span className="examicon" aria-hidden="true"><Timer size={20} /></span>
        <div>
          <h2>Exam mode</h2>
          <p>A timed, mixed practice exam drawn from every track exam: SAA, DVA or both. Questions are spread across domains and tracks, and every miss links to the module to study.</p>
        </div>
      </div>
      {last && <span className="count cchecks">{progress!.examAttempts.length} taken, last {Math.round((100 * last.score) / last.total)}%, best {best}%</span>}
      <a className="btn primary" href="#/exam-mode"><GraduationCap size={14} />{last ? 'New practice exam' : 'Take a practice exam'}</a>
    </section>
  )
}

export function Trail() {
  const progress = useProgress()
  const started = (id: string) => (progress?.modules[id]?.checksPassed.length ?? 0) > 0
  const next = LESSONS.find((l) => started(l.id) && !isDone(progress, l.id)) ?? LESSONS.find((l) => !isDone(progress, l.id)) ?? LESSONS[0]
  const doneCount = LESSONS.filter((l) => isDone(progress, l.id)).length
  return (
    <div className="page trailpage">
      <div className="pagehead">
        <div>
          <h1>Tracks</h1>
          <p>Real <code>aws</code> commands and real AWS error messages, run against an emulator on this machine. Each track is a run of modules you can start anywhere: every module builds its own starting state, and ends with a checker.</p>
        </div>
        <a className="btn primary" href={`#/lesson/${next.id}`}>{doneCount || started(next.id) ? 'Continue with' : 'Start with'} {next.n}<ArrowRight size={14} /></a>
      </div>
      <ContinueCard />
      <section className="container legend" aria-label="What the badges mean">
        <header><h2>How honest is each module?</h2><a className="link" href="#/about">What the emulator enforces</a></header>
        <div className="pad"><HonestyLegend /></div>
      </section>
      <ExamModeCard />
      <div className="trackgrid">{TRACKS.map((t) => <TrackCard key={t.id} track={t} />)}</div>
      {progress && <Readiness rows={progress.readiness} />}
    </div>
  )
}
