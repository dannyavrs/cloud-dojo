import { Check, X } from 'lucide-react'
import type { QuizQuestion, QuizResult } from '@shared/types'
import { Inline } from './Inline'

/** One multiple-choice question. Grading happens on the server, locally, with no model. */
export function QuestionView({ q, n, picked, onPick, result, locked, tag }: { q: QuizQuestion; n: number; picked?: number; onPick: (i: number) => void; result?: QuizResult; locked?: boolean; tag?: boolean }) {
  return (
    <fieldset className={`q ${result ? (result.correct ? 'right' : 'wrong') : ''}`} aria-describedby={result ? `${q.id}-why` : undefined}>
      <legend>
        <span className="qn">{n}</span>
        <span className="qtext"><Inline text={q.prompt} /></span>
        {tag && q.tag && <span className="chip mono">{q.tag}</span>}
      </legend>
      {q.code && <pre className="qcode">{q.code}</pre>}
      <div className="opts" role="radiogroup">
        {q.options.map((o, i) => {
          const isAnswer = result && i === result.answer
          const isWrongPick = result && picked === i && !result.correct
          return (
            <label key={i} className={`opt${picked === i ? ' sel' : ''}${isAnswer ? ' ans' : ''}${isWrongPick ? ' bad' : ''}`}>
              <input type="radio" name={q.id} checked={picked === i} disabled={locked} onChange={() => onPick(i)} />
              <span className="mark" aria-hidden="true">{isAnswer ? <Check size={12} strokeWidth={3} /> : isWrongPick ? <X size={12} strokeWidth={3} /> : null}</span>
              <span className="otext"><Inline text={o} /></span>
              {isAnswer && <span className="ostate">Correct answer</span>}
              {isWrongPick && <span className="ostate">Your answer</span>}
            </label>
          )
        })}
      </div>
      {result && <p id={`${q.id}-why`} className="why"><b>{result.correct ? 'Correct. ' : 'Not quite. '}</b><Inline text={result.explain} /></p>}
    </fieldset>
  )
}
