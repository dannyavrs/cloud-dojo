import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, Clock, Flag, RotateCcw } from 'lucide-react'
import { DEFAULT_PACE, DOMAIN_NAME, FAMILIES, FAMILY_DOMAINS, LENGTHS, PACES } from '@shared/exam-mode'
import type { ExamAttempt, ExamFamily, ExamModeInfo, ExamModeQuestion, ExamModeResult, ExamModeStart } from '@shared/types'
import { api } from '@/lib/api'
import { refreshProgress, useProgress } from '@/lib/progress'
import { useLocal } from '@/lib/store'
import { QuestionView } from '@/components/Quiz'
import { Readiness } from '@/components/Readiness'

interface Run { start: ExamModeStart; answers: Record<string, number>; flags: string[]; cur: number }

const clock = (s: number) => { const t = Math.max(0, Math.round(s)); const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60); const x = t % 60; return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(x).padStart(2, '0')}` }
const pct = (a: ExamAttempt) => Math.round((100 * a.score) / Math.max(1, a.total))
const paceLabel = (p: number) => (p === 0 ? 'Untimed' : `${p / 60} min per question`)
const when = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

export function ExamModePage() {
  const [run, setRun] = useLocal<Run | null>('exam-run', null)
  const [result, setResult] = useState<{ res: ExamModeResult; questions: ExamModeQuestion[] } | null>(null)
  if (result) return <Results res={result.res} questions={result.questions} onAgain={() => setResult(null)} />
  if (run) return <Runner run={run} setRun={setRun} onDone={(res) => { setResult({ res, questions: run.start.questions }); setRun(null); void refreshProgress(); document.querySelector('.main')?.scrollTo({ top: 0 }) }} onQuit={() => setRun(null)} />
  return <Picker onStart={(start) => setRun({ start, answers: {}, flags: [], cur: 0 })} />
}

function Picker({ onStart }: { onStart: (s: ExamModeStart) => void }) {
  const [info, setInfo] = useState<ExamModeInfo | null>(null)
  const [family, setFamily] = useLocal<ExamFamily>('exam-family', 'MIXED')
  const [length, setLength] = useLocal<number>('exam-length', 40)
  const [pace, setPace] = useLocal<number>('exam-pace', DEFAULT_PACE)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { api.examModeInfo().then(setInfo).catch((e: Error) => setErr(e.message)) }, [])
  const avail = info?.available[family] ?? 0
  const lengths = useMemo(() => {
    const l = LENGTHS.filter((n) => n < avail)
    return [...l, avail].filter((n, i, a) => n > 0 && a.indexOf(n) === i)
  }, [avail])
  const count = Math.min(length, avail) || avail
  const chosen = lengths.includes(count) ? count : lengths.at(-1) ?? 0
  async function start() {
    setBusy(true); setErr(null)
    try { onStart(await api.examModeStart(family, chosen, pace)) } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  return (
    <div className="page exampick">
      <a className="link back" href="#/"><ArrowLeft size={14} />All tracks</a>
      <div className="pagehead">
        <div>
          <h1>Exam mode</h1>
          <p>A practice exam drawn from every track exam, spread evenly across domains and tracks. Graded here on this machine against fixed answer keys, with no model involved. The answer key stays on the server until you submit.</p>
        </div>
      </div>
      <section className="container" aria-label="Exam setup">
        <header><h2>Set up your exam</h2></header>
        <div className="pad setup">
          <fieldset className="field">
            <legend>Exam</legend>
            <div className="cards" role="radiogroup">
              {FAMILIES.map((f) => (
                <label key={f.id} className={`choice${family === f.id ? ' on' : ''}`}>
                  <input type="radio" name="family" checked={family === f.id} onChange={() => setFamily(f.id)} />
                  <b>{f.label}</b>
                  <span>{f.blurb}</span>
                  <span className="count">{info ? `${info.available[f.id]} questions available` : '…'}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="field">
            <legend>Length</legend>
            <div className="seg2" role="radiogroup">
              {lengths.map((n) => (
                <label key={n} className={chosen === n ? 'on' : ''}><input type="radio" name="length" checked={chosen === n} onChange={() => setLength(n)} />{n === avail && !LENGTHS.includes(n) ? `All ${n}` : `${n} questions`}</label>
              ))}
            </div>
          </fieldset>
          <fieldset className="field">
            <legend>Timer</legend>
            <div className="seg2" role="radiogroup">
              {PACES.map((p) => (
                <label key={p} className={pace === p ? 'on' : ''}><input type="radio" name="pace" checked={pace === p} onChange={() => setPace(p)} />{paceLabel(p)}</label>
              ))}
            </div>
            <span className="count">{pace ? `${clock(pace * chosen)} in total for ${chosen} questions` : 'No countdown. Take the time you need.'}</span>
          </fieldset>
          {err && <p className="errline" role="alert">{err}</p>}
          <div className="startrow">
            <button className="btn primary" disabled={busy || !chosen} onClick={() => void start()}>{busy ? 'Drawing questions…' : `Start ${chosen || ''} question exam`}<ArrowRight size={14} /></button>
            {info && !avail && <span className="count">No exam questions in this family yet.</span>}
          </div>
        </div>
      </section>
      {info && info.recent.length > 0 && (
        <section className="container" aria-label="Recent attempts">
          <header><h2>Recent attempts</h2></header>
          <ul className="attempts">
            {info.recent.map((a) => (
              <li key={a.id}><span className="chip mono">{a.family}</span><span className="grow">{when(a.submittedAt)}, {a.total} questions{a.durationSec ? `, ${clock(a.elapsedSec)} of ${clock(a.durationSec)}` : ''}</span><b className="dnum">{a.score}/{a.total}</b><span className="dnum">{pct(a)}%</span></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function Runner({ run, setRun, onDone, onQuit }: { run: Run; setRun: (f: (r: Run | null) => Run | null) => void; onDone: (r: ExamModeResult) => void; onQuit: () => void }) {
  const { start, answers, flags, cur } = run
  const qs = start.questions
  const q = qs[Math.min(cur, qs.length - 1)]
  const [now, setNow] = useState(() => Date.now())
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const submitted = useRef(false)
  const timed = start.durationSec > 0
  const remaining = timed ? start.durationSec - (now - start.startedAt) / 1000 : Infinity
  const answered = qs.filter((x) => answers[x.ref] !== undefined).length
  const unanswered = qs.length - answered
  useEffect(() => { if (!timed) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [timed])
  async function submit() {
    if (submitted.current) return
    submitted.current = true; setBusy(true); setErr(null)
    try { onDone(await api.examModeSubmit(start.id, answers)) } catch (e) { submitted.current = false; setBusy(false); setErr(e instanceof Error ? e.message : String(e)) }
  }
  useEffect(() => { if (!timed || remaining > 0) return; const t = setTimeout(() => void submit(), 0); return () => clearTimeout(t) })
  // Announce only a few milestones, never every second.
  const mark = [1800, 900, 600, 300, 60].find((t) => remaining <= t && remaining > 0)
  const announce = mark ? (mark >= 120 ? `${mark / 60} minutes remaining` : 'One minute remaining') : remaining <= 0 && timed ? 'Time is up. Submitting.' : ''
  const set = (f: (r: Run) => Run) => setRun((r) => (r ? f(r) : r))
  const tone = !timed ? '' : remaining <= 60 ? 'bad' : remaining <= 300 ? 'warn' : ''
  const go = (i: number) => set((r) => ({ ...r, cur: Math.max(0, Math.min(qs.length - 1, i)) }))
  return (
    <div className="page examrun">
      <div className="runbar container" role="region" aria-label="Exam progress">
        <div className="runinfo"><b>{FAMILIES.find((f) => f.id === start.family)?.label}</b><span className="count">{answered} of {qs.length} answered{flags.length ? `, ${flags.length} flagged` : ''}</span></div>
        <span className="grow" />
        {timed ? <span className={`timer ${tone}`}><Clock size={15} aria-hidden="true" /><span className="sr">Time left </span>{clock(remaining)}</span> : <span className="count">Untimed</span>}
        <span className="sr" aria-live="polite">{announce}</span>
        <button className="btn" onClick={() => { if (window.confirm('Leave this exam? Your answers will be discarded.')) onQuit() }}>Quit</button>
        <button className="btn primary" disabled={busy} onClick={() => (unanswered ? setConfirm(true) : void submit())}>{busy ? 'Grading…' : 'Submit exam'}</button>
      </div>
      {confirm && (
        <div className="container warnbox" role="alertdialog" aria-labelledby="warn-t">
          <p id="warn-t"><b>{unanswered} {unanswered === 1 ? 'question is' : 'questions are'} unanswered.</b>{flags.length ? ` ${flags.length} flagged for review.` : ''} Unanswered questions count as wrong.</p>
          <button className="btn" onClick={() => setConfirm(false)}>Keep working</button>
          <button className="btn primary" disabled={busy} onClick={() => void submit()}>Submit anyway</button>
        </div>
      )}
      {err && <p className="errline" role="alert">{err} <button className="btn sm" onClick={() => void submit()}>Try again</button></p>}
      <div className="runbody">
        <div className="container qwrap pad runq">
          <QuestionView key={q.ref} q={{ id: q.ref, prompt: q.prompt, code: q.code, options: q.options, answer: -1, explain: '' }} n={cur + 1} picked={answers[q.ref]} onPick={(c) => set((r) => ({ ...r, answers: { ...r.answers, [q.ref]: c } }))} />
          <div className="qnav">
            <button className="btn" disabled={cur === 0} onClick={() => go(cur - 1)}><ArrowLeft size={14} />Previous</button>
            <button className={`btn flagbtn${flags.includes(q.ref) ? ' on' : ''}`} aria-pressed={flags.includes(q.ref)} onClick={() => set((r) => ({ ...r, flags: r.flags.includes(q.ref) ? r.flags.filter((x) => x !== q.ref) : [...r.flags, q.ref] }))}><Flag size={14} />{flags.includes(q.ref) ? 'Flagged for review' : 'Flag for review'}</button>
            <span className="grow" />
            <button className="btn" disabled={cur === qs.length - 1} onClick={() => go(cur + 1)}>Next<ArrowRight size={14} /></button>
          </div>
        </div>
        <nav className="container navigator" aria-label="Question navigator">
          <header><h2>Questions</h2></header>
          <ol>
            {qs.map((x, i) => (
              <li key={x.ref}><button className={`${i === cur ? 'cur ' : ''}${answers[x.ref] !== undefined ? 'ans ' : ''}${flags.includes(x.ref) ? 'flag' : ''}`} aria-current={i === cur ? 'step' : undefined} aria-label={`Question ${i + 1}, ${answers[x.ref] !== undefined ? 'answered' : 'unanswered'}${flags.includes(x.ref) ? ', flagged' : ''}`} onClick={() => go(i)}>{i + 1}{flags.includes(x.ref) && <Flag size={9} aria-hidden="true" />}</button></li>
            ))}
          </ol>
          <p className="count legendline"><i className="k ans" />Answered <i className="k" />Open <i className="k flag" />Flagged</p>
        </nav>
      </div>
    </div>
  )
}

function Results({ res, questions, onAgain }: { res: ExamModeResult; questions: ExamModeQuestion[]; onAgain: () => void }) {
  const progress = useProgress()
  const a = res.attempt
  const byRef = new Map(questions.map((q) => [q.ref, q]))
  const groups = (['SAA', 'DVA'] as const).filter((g) => a.family === 'MIXED' || a.family === g)
  const p = pct(a)
  return (
    <div className="page examresult">
      <a className="link back" href="#/"><ArrowLeft size={14} />All tracks</a>
      <section className="container result" aria-live="polite" aria-label="Exam result">
        <header><h2>Your result</h2><span className="chip mono">{a.family}</span><span className="grow" /><button className="btn sm" onClick={onAgain}><RotateCcw size={13} />New exam</button></header>
        <div className="pad scorerow">
          <div className="bigscore"><b>{p}%</b><span>{a.score} of {a.total} correct</span></div>
          <ul className="facts">
            <li><span>Answered</span><b>{res.answered} of {a.total}</b></li>
            <li><span>Time</span><b>{clock(a.elapsedSec)}{a.durationSec ? ` of ${clock(a.durationSec)}` : ''}</b></li>
            <li><span>To review</span><b>{res.review.length}</b></li>
          </ul>
          <p className="note2">{p >= 72 ? 'Above' : 'Below'} the 72% mark. The real exams score on a scaled 100 to 1000 scale with 720 to pass, so treat this as a rough guide, not a prediction.</p>
        </div>
      </section>
      <section className="container" aria-label="This attempt by domain">
        <header><h2>This attempt, by domain</h2></header>
        <div className="rgrid pad0">
          {groups.map((g) => (
            <div key={g}>
              <h3>{g === 'SAA' ? 'Solutions Architect Associate' : 'Developer Associate'}</h3>
              <ul>
                {FAMILY_DOMAINS[g].map((d) => {
                  const v = a.byDomain[`${g}:${d}`]
                  return (
                    <li key={d}>
                      <span className="dname">{DOMAIN_NAME[d]}</span>
                      <span className="meter" role="img" aria-label={v ? `${v.correct} of ${v.total} correct` : 'no questions drawn'}><i style={{ width: v ? `${(v.correct / v.total) * 100}%` : 0 }} /></span>
                      <span className="dnum">{v ? `${v.correct}/${v.total}` : 'none'}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </section>
      {progress && <Readiness rows={progress.readiness} title="Overall readiness after this attempt" />}
      <section aria-label="Review" className="review">
        <h2 className="h2">{res.review.length ? `Review: ${res.review.length} to revisit` : 'Nothing to review'}</h2>
        {!res.review.length && <p className="note2">A clean sweep. Try a longer exam or the other family.</p>}
        {res.review.map((r) => {
          const q = byRef.get(r.ref)
          if (!q) return null
          const n = questions.indexOf(q) + 1
          return (
            <div key={r.ref} className="container qwrap pad">
              <QuestionView q={{ id: r.ref, prompt: q.prompt, code: q.code, options: q.options, answer: r.answer, explain: r.explain, tag: q.tag }} n={n} tag picked={r.picked ?? undefined} onPick={() => undefined} result={{ correct: false, answer: r.answer, explain: r.explain }} locked />
              <div className="qact">
                {r.picked === null && <span className="count">You left this unanswered.</span>}
                <span className="grow" />
                {r.study && <a className="btn sm" href={`#/lesson/${r.study.moduleId}`}><BookOpen size={13} />Study this: {r.study.label}</a>}
              </div>
            </div>
          )
        })}
      </section>
    </div>
  )
}
