import { useState } from 'react'
import { Lightbulb } from 'lucide-react'
import type { LessonContent, QuizResult } from '@shared/types'
import { api } from '@/lib/api'
import { refreshProgress, useProgress } from '@/lib/progress'
import { QuestionView } from './Quiz'

/** Predict, then run: answer before touching the terminal. The run shows the truth. */
export function PredictCard({ lesson }: { lesson: LessonContent }) {
  const progress = useProgress()
  const [picked, setPicked] = useState<Record<string, number>>({})
  const [results, setResults] = useState<Record<string, QuizResult>>({})
  const [busy, setBusy] = useState<string | null>(null)
  if (!lesson.predict.length) return null
  const answered = lesson.predict.filter((q) => results[q.id]).length
  const before = progress?.modules[lesson.id]?.predict ?? {}
  async function lock(qid: string) {
    setBusy(qid)
    try { const r = await api.predict(lesson.id, qid, picked[qid]); setResults((x) => ({ ...x, [qid]: r })); void refreshProgress() } finally { setBusy(null) }
  }
  return (
    <section className="container predict" aria-label="Predict, then run">
      <header>
        <h2><Lightbulb size={16} />Predict, then run</h2>
        <span className="count">{answered === lesson.predict.length ? 'All answered. Now run it and compare.' : `${answered} of ${lesson.predict.length} answered`}</span>
      </header>
      <div className="pad">
        <p className="qintro">Commit to an answer before you run anything. The terminal will show what really happens.</p>
        {lesson.predict.map((q, i) => (
          <div key={q.id} className="qwrap">
            <QuestionView q={q} n={i + 1} picked={picked[q.id]} onPick={(c) => setPicked((x) => ({ ...x, [q.id]: c }))} result={results[q.id]} locked={Boolean(results[q.id])} />
            {!results[q.id] && (
              <div className="qact">
                <button className="btn sm primary" disabled={picked[q.id] === undefined || busy === q.id} onClick={() => void lock(q.id)}>{busy === q.id ? 'Checking…' : 'Lock in my prediction'}</button>
                {before[q.id] && <span className="count">Answered correctly before</span>}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
