import type { LessonContent, QuizQuestion, QuizResult, Track } from '../shared/types'

const grade = (q: QuizQuestion, choice: unknown): QuizResult => ({ correct: choice === q.answer, answer: q.answer, explain: q.explain })

export function gradePredict(lesson: LessonContent, qid: string, choice: unknown): QuizResult | null {
  const q = lesson.predict.find((x) => x.id === qid)
  return q && Number.isInteger(choice) ? grade(q, choice) : null
}

export interface ExamGrade { score: number; total: number; results: Record<string, QuizResult>; byDomain: Record<string, { correct: number; total: number }> }

/** Grade a whole track exam. Unanswered or invalid answers count as wrong. */
export function gradeExam(track: Track, answers: Record<string, unknown>): ExamGrade | null {
  if (!track.exam?.length) return null
  const results: Record<string, QuizResult> = {}
  const byDomain: ExamGrade['byDomain'] = {}
  let score = 0
  for (const q of track.exam) {
    const r = grade(q, answers[q.id])
    results[q.id] = r
    if (r.correct) score++
    const d = q.tag ?? 'General'
    byDomain[d] ??= { correct: 0, total: 0 }
    byDomain[d].total++
    if (r.correct) byDomain[d].correct++
  }
  return { score, total: track.exam.length, results, byDomain }
}
