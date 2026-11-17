import type { ExamAttempt, ExamFamily, ExamModeInfo, ExamModeQuestion, ExamModeResult, ExamModeStart, Track } from '../shared/types'
import { attemptId, availableCount, domainOf, drawExam, inFamily, parseAttemptId, poolOf, studyTarget, type PoolQuestion } from '../shared/exam-mode'

const FAMILY_IDS: ExamFamily[] = ['SAA', 'DVA', 'MIXED']

/** The only shape of a question that leaves the server before submit: no answer index, no explanation. */
export const publicQuestion = (p: PoolQuestion): ExamModeQuestion => ({ ref: p.ref, trackId: p.trackId, tag: p.q.tag, prompt: p.q.prompt, code: p.q.code, options: [...p.q.options] })

export function examModeInfo(tracks: Track[], recent: ExamAttempt[]): ExamModeInfo {
  const pool = poolOf(tracks)
  const available = Object.fromEntries(FAMILY_IDS.map((f) => [f, availableCount(pool, f)])) as Record<ExamFamily, number>
  const domains = Object.fromEntries(FAMILY_IDS.map((f) => {
    const d: Record<string, number> = {}
    for (const p of pool) if (inFamily(p, f)) d[domainOf(p.q)] = (d[domainOf(p.q)] ?? 0) + 1
    return [f, d]
  })) as ExamModeInfo['domains']
  return { available, domains, recent: recent.slice(-5).reverse() }
}

export interface StartInput { family?: unknown; count?: unknown; pace?: unknown }
export function startExamMode(tracks: Track[], input: StartInput, now = Date.now(), seed = crypto.getRandomValues(new Uint32Array(1))[0]): ExamModeStart | { error: string } {
  const family = FAMILY_IDS.find((f) => f === input.family)
  if (!family) return { error: 'unknown exam family' }
  const wanted = Number(input.count)
  const pace = Number(input.pace ?? 0)
  if (!Number.isInteger(wanted) || wanted < 1 || wanted > 200) return { error: 'bad question count' }
  if (!Number.isInteger(pace) || pace < 0 || pace > 600) return { error: 'bad pace' }
  const picked = drawExam(poolOf(tracks), family, wanted, seed)
  if (!picked.length) return { error: 'no questions available for this exam' }
  const id = attemptId({ family, count: picked.length, seed, startedAt: now, pace })
  return { id, family, startedAt: now, durationSec: pace * picked.length, questions: picked.map(publicQuestion) }
}

/**
 * Grade a finished attempt. The attempt is rebuilt from its id (same seed, same pool), so the browser never needs
 * the key and cannot choose its own question set. Unanswered or invalid answers count as wrong.
 */
export function gradeExamMode(tracks: Track[], id: unknown, answers: Record<string, unknown>, now = Date.now()): ExamModeResult | { error: string } {
  const spec = parseAttemptId(id)
  if (!spec) return { error: 'bad attempt id' }
  const picked = drawExam(poolOf(tracks), spec.family, spec.count, spec.seed)
  if (!picked.length) return { error: 'attempt no longer available' }
  const byDomain: ExamAttempt['byDomain'] = {}
  const correctRefs: string[] = []
  const wrongRefs: string[] = []
  const review: ExamModeResult['review'] = []
  let answered = 0
  for (const p of picked) {
    const a = answers[p.ref]
    const valid = Number.isInteger(a) && (a as number) >= 0 && (a as number) < p.q.options.length
    if (valid) answered++
    const ok = valid && a === p.q.answer
    const d = domainOf(p.q)
    byDomain[d] ??= { correct: 0, total: 0 }
    byDomain[d].total++
    if (ok) { byDomain[d].correct++; correctRefs.push(p.ref) } else {
      wrongRefs.push(p.ref)
      review.push({ ref: p.ref, trackId: p.trackId, tag: p.q.tag, picked: valid ? (a as number) : null, answer: p.q.answer, explain: p.q.explain, study: studyTarget(p.trackId, p.q) })
    }
  }
  const durationSec = spec.pace * picked.length
  const attempt: ExamAttempt = {
    id: id as string, family: spec.family, startedAt: spec.startedAt, submittedAt: now, durationSec,
    elapsedSec: Math.max(0, Math.round((now - spec.startedAt) / 1000)),
    score: correctRefs.length, total: picked.length, byDomain, correctRefs, wrongRefs,
  }
  return { attempt, answered, review }
}
