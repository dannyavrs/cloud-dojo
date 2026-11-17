import { useState } from 'react'
import { ArrowLeft, RotateCcw } from 'lucide-react'
import { modulesOf } from '@shared/lessons'
import { trackById } from '@shared/tracks'
import type { QuizResult } from '@shared/types'
import { api } from '@/lib/api'
import { refreshProgress, useProgress } from '@/lib/progress'
import { QuestionView } from '@/components/Quiz'
import { ServiceTile, serviceForTrack } from '@/lib/services'

type Graded = { score: number; total: number; results: Record<string, QuizResult>; byDomain: Record<string, { correct: number; total: number }> }

export function ExamPage({ trackId }: { trackId: string }) {
  const track = trackById(trackId)!
  const progress = useProgress()
  const [picked, setPicked] = useState<Record<string, number>>({})
  const [graded, setGraded] = useState<Graded | null>(null)
  const [busy, setBusy] = useState(false)
  const qs = track.exam ?? []
  const answered = qs.filter((q) => picked[q.id] !== undefined).length
  const mods = modulesOf(trackId)
  const prev = progress?.exams[trackId]
  async function submit() {
    setBusy(true)
    try { setGraded(await api.exam(trackId, picked)); void refreshProgress(); document.querySelector('.main')?.scrollTo({ top: 0, behavior: 'smooth' }) } finally { setBusy(false) }
  }
  return (
    <div className="page exam">
      <a className="link back" href={`#/`}><ArrowLeft size={14} />All tracks</a>
      <div className="pagehead">
        <div className="exhead">
          <ServiceTile svc={serviceForTrack(trackId)} size={40} />
          <div>
            <h1>{track.title}: track exam</h1>
            <p>{qs.length} scenario questions in the style of the AWS Solutions Architect Associate and Developer Associate exams. Graded here, on this machine, with fixed answer keys: no model is involved. Each question counts toward an exam domain.</p>
          </div>
        </div>
      </div>
      {graded && (
        <section className="container result" aria-live="polite" aria-label="Exam result">
          <header><h2>Your result</h2><span className="count">{graded.score} of {graded.total} correct</span><span className="grow" /><button className="btn sm" onClick={() => { setGraded(null); setPicked({}) }}><RotateCcw size={13} />Retake</button></header>
          <div className="pad">
            <ul className="domains">
              {Object.entries(graded.byDomain).sort().map(([d, v]) => (
                <li key={d}><span className="dname mono">{d}</span><span className="meter" role="img" aria-label={`${v.correct} of ${v.total}`}><i style={{ width: `${(v.correct / v.total) * 100}%` }} /></span><span className="dnum">{v.correct}/{v.total}</span></li>
              ))}
            </ul>
            <p className="note2">{graded.score === graded.total ? 'A clean sweep. Read the explanations anyway: the distractors are the exam.' : 'Read the explanation under each question. Wrong answers are marked on the option you picked, and the right one is always shown.'}</p>
          </div>
        </section>
      )}
      {!graded && prev && <p className="count">Last attempt: {Object.values(prev.answers).filter(Boolean).length} of {qs.length} correct.</p>}
      <div className="qlist">
        {qs.map((q, i) => (
          <div key={q.id} className="container qwrap pad">
            <QuestionView q={q} n={i + 1} tag picked={picked[q.id]} onPick={(c) => setPicked((x) => ({ ...x, [q.id]: c }))} result={graded?.results[q.id]} locked={Boolean(graded)} />
          </div>
        ))}
      </div>
      {!graded && (
        <div className="examfoot">
          <span className="count">{answered} of {qs.length} answered{answered < qs.length ? '. Unanswered questions count as wrong.' : ''}</span>
          <button className="btn primary" disabled={busy || answered === 0} onClick={() => void submit()}>{busy ? 'Grading…' : 'Submit exam'}</button>
        </div>
      )}
      <p className="count">Covers modules {mods.map((m) => m.n).join(', ')}.</p>
    </div>
  )
}
