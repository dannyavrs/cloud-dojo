import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { LESSONS } from '../shared/lessons'
import { TRACKS } from '../shared/tracks'
import { attemptId, drawExam, parseAttemptId, poolOf, studyTarget, type PoolQuestion } from '../shared/exam-mode'
import type { QuizQuestion, Track } from '../shared/types'
import { examModeInfo, gradeExamMode, startExamMode } from '../server/exam-mode'
import { Progress } from '../server/progress'

const mkq = (id: string, tag: string, answer = 1): QuizQuestion => ({ id, tag, prompt: `Question ${id} about buckets and queues`, options: ['a', 'b', 'c', 'd'], answer, explain: `because ${id}` })
const T = (id: string, qs: QuizQuestion[]): Track => ({ id, n: '9', title: id, blurb: '', tile: id, exams: [], exam: qs })
const FAKE: Track[] = [
  T('t1', [...['SAA:Secure', 'SAA:Resilient', 'SAA:Performant', 'SAA:Cost'].flatMap((d, i) => [0, 1, 2, 3, 4, 5].map((n) => mkq(`a${i}${n}`, d)))]),
  T('t2', [...['SAA:Secure', 'DVA:Dev', 'DVA:Sec'].flatMap((d, i) => [0, 1, 2, 3, 4].map((n) => mkq(`b${i}${n}`, d)))]),
  T('t3', []),
]
const dom = (xs: PoolQuestion[]) => { const m: Record<string, number> = {}; for (const x of xs) m[x.q.tag ?? '?'] = (m[x.q.tag ?? '?'] ?? 0) + 1; return m }

describe('question drawing', () => {
  const pool = poolOf(FAKE)
  test('refs are track-qualified and unique', () => {
    expect(new Set(pool.map((p) => p.ref)).size).toBe(pool.length)
    expect(pool[0].ref).toBe(`t1/${pool[0].q.id}`)
  })
  test('same seed gives the same draw, a different seed a different order', () => {
    const a = drawExam(pool, 'MIXED', 20, 1).map((p) => p.ref)
    expect(drawExam(pool, 'MIXED', 20, 1).map((p) => p.ref)).toEqual(a)
    expect(drawExam(pool, 'MIXED', 20, 2).map((p) => p.ref)).not.toEqual(a)
  })
  test('domains are balanced: a draw of N over D domains gives each floor or ceil(N/D)', () => {
    for (const seed of [1, 7, 99]) {
      const d = dom(drawExam(pool, 'SAA', 12, seed))
      expect(Object.keys(d).sort()).toEqual(['SAA:Cost', 'SAA:Performant', 'SAA:Resilient', 'SAA:Secure'])
      for (const n of Object.values(d)) expect(n).toBe(3)
    }
    const m = dom(drawExam(pool, 'MIXED', 14, 5))
    expect(Math.max(...Object.values(m)) - Math.min(...Object.values(m))).toBeLessThanOrEqual(1)
  })
  test('a family only draws its own domains, and draws spread across tracks', () => {
    const d = drawExam(pool, 'DVA', 10, 3)
    expect(d.every((p) => p.q.tag!.startsWith('DVA:'))).toBe(true)
    const sec = drawExam(pool, 'SAA', 8, 3).filter((p) => p.q.tag === 'SAA:Secure')
    expect(new Set(sec.map((p) => p.trackId)).size).toBe(2) // Secure exists in both tracks: both appear
  })
  test('counts are capped by what exists and never repeat a question', () => {
    const all = drawExam(pool, 'MIXED', 65, 4)
    expect(all.length).toBe(pool.length)
    expect(new Set(all.map((p) => p.ref)).size).toBe(all.length)
    expect(drawExam(pool, 'DVA', 65, 4).length).toBe(10)
    expect(drawExam(pool, 'MIXED', 0, 4)).toEqual([])
  })
  test('works against the real track exams, whatever their size today', () => {
    const real = poolOf(TRACKS)
    for (const family of ['SAA', 'DVA', 'MIXED'] as const) {
      const d = drawExam(real, family, 40, 11)
      expect(d.length).toBeLessThanOrEqual(40)
      expect(new Set(d.map((p) => p.ref)).size).toBe(d.length)
    }
  })
  test('attempt ids round trip and reject junk', () => {
    const spec = { family: 'SAA' as const, count: 20, seed: 123456, startedAt: 1_760_000_000_000, pace: 90 }
    expect(parseAttemptId(attemptId(spec))).toEqual(spec)
    for (const bad of ['', 'x', 'SAA.0.1.1760000000000.90', 'ZZZ.20.1.1760000000000.90', 5, null]) expect(parseAttemptId(bad)).toBeNull()
  })
  test('study target prefers a module in the same track that carries the domain tag', () => {
    const real = TRACKS.find((t) => t.exam?.length && LESSONS.some((l) => l.trackId === t.id))!
    const q = real.exam![0]
    const s = studyTarget(real.id, q)!
    expect(LESSONS.find((l) => l.id === s.moduleId)!.trackId).toBe(real.id)
    expect(studyTarget(real.id, q)).toEqual(s)
    expect(studyTarget('nope', q)).toBeNull()
  })
})

describe('exam mode start and grading', () => {
  test('the pre-submit payload has no answer key and no explanation', () => {
    const r = startExamMode(FAKE, { family: 'MIXED', count: 20, pace: 90 }, 1_760_000_000_000, 42)
    if ('error' in r) throw new Error(r.error)
    const text = JSON.stringify(r)
    expect(text).not.toContain('because')
    expect(text).not.toContain('"answer"')
    expect(text).not.toContain('"explain"')
    for (const q of r.questions) expect(Object.keys(q).sort().filter((k) => !['code', 'tag'].includes(k))).toEqual(['options', 'prompt', 'ref', 'trackId'])
    expect(r.durationSec).toBe(20 * 90)
    expect(startExamMode(FAKE, { family: 'MIXED', count: 20, pace: 0 }, 1_760_000_000_000, 42)).toMatchObject({ durationSec: 0 })
  })
  test('real tracks: nothing in the start payload equals an answer key field', () => {
    const r = startExamMode(TRACKS, { family: 'MIXED', count: 65, pace: 90 })
    if ('error' in r) throw new Error(r.error)
    expect(Object.keys(r.questions[0])).not.toContain('answer')
    expect(JSON.stringify(r)).not.toContain('"explain"')
  })
  test('rejects bad input', () => {
    expect(startExamMode(FAKE, { family: 'XYZ', count: 5 })).toHaveProperty('error')
    expect(startExamMode(FAKE, { family: 'SAA', count: -3 })).toHaveProperty('error')
    expect(startExamMode(FAKE, { family: 'SAA', count: 5, pace: 99999 })).toHaveProperty('error')
    expect(gradeExamMode(FAKE, 'junk', {})).toHaveProperty('error')
  })
  test('grades right, wrong and unanswered; wrong list carries study links; keys are stable per id', () => {
    const start = startExamMode(FAKE, { family: 'SAA', count: 8, pace: 60 }, 1_760_000_000_000, 77)
    if ('error' in start) throw new Error(start.error)
    const refs = start.questions.map((q) => q.ref)
    const answers: Record<string, number> = {}
    answers[refs[0]] = 1 // right (answer is 1)
    answers[refs[1]] = 3 // wrong
    answers[refs[2]] = 99 // invalid counts as unanswered
    // refs[3..] unanswered
    const g = gradeExamMode(FAKE, start.id, answers, 1_760_000_000_000 + 125_000)
    if ('error' in g) throw new Error(g.error)
    expect(g.attempt.score).toBe(1)
    expect(g.attempt.total).toBe(8)
    expect(g.answered).toBe(1 + 1)
    expect(g.attempt.correctRefs).toEqual([refs[0]])
    expect(g.attempt.wrongRefs.length).toBe(7)
    expect(g.review.length).toBe(7)
    expect(g.review.find((r) => r.ref === refs[1])).toMatchObject({ picked: 3, answer: 1 })
    expect(g.review.find((r) => r.ref === refs[2])!.picked).toBeNull()
    expect(g.attempt.elapsedSec).toBe(125)
    expect(g.attempt.durationSec).toBe(480)
    expect(Object.values(g.attempt.byDomain).reduce((n, v) => n + v.total, 0)).toBe(8)
    expect(Object.values(g.attempt.byDomain).reduce((n, v) => n + v.correct, 0)).toBe(1)
  })
  test('info reports counts per family without hardcoding', () => {
    const i = examModeInfo(FAKE, [])
    expect(i.available).toEqual({ SAA: 29, DVA: 10, MIXED: 39 })
    expect(i.domains.DVA['DVA:Dev']).toBe(5)
  })
})

describe('readiness aggregation and persistence', () => {
  const tmp = () => path.join(mkdtempSync(path.join(tmpdir(), 'dojo-exam-')), 'progress.json')
  const lessons = [{ id: 'm1', trackId: 't1', examTags: ['SAA:Secure'], checks: [], n: '9.1', title: 'x' }] as never
  const secureRow = (p: Progress) => p.view(lessons, FAKE).readiness.find((r) => r.domain === 'SAA:Secure')!
  const secureQs = FAKE.flatMap((t) => (t.exam ?? []).filter((q) => q.tag === 'SAA:Secure').map((q) => ({ t, q })))

  test('attempts persist and round trip through the JSON file, old files without the field still load', () => {
    const file = tmp()
    const p = new Progress(file)
    const start = startExamMode(FAKE, { family: 'MIXED', count: 10, pace: 0 }, 1_760_000_000_000, 5)
    if ('error' in start) throw new Error(start.error)
    const g = gradeExamMode(FAKE, start.id, {}, 1_760_000_100_000)
    if ('error' in g) throw new Error(g.error)
    p.recordAttempt(g.attempt)
    p.recordAttempt(g.attempt) // same id: replaced, not duplicated
    const again = new Progress(file)
    expect(again.view(lessons, FAKE).examAttempts).toEqual([g.attempt])
    require('node:fs').writeFileSync(file, JSON.stringify({ modules: {}, exams: {} }))
    expect(new Progress(file).view(lessons, FAKE).examAttempts).toEqual([])
  })

  test('exam-mode results feed domain readiness; a question is counted once (latest outcome wins)', () => {
    const p = new Progress(tmp())
    const base = secureRow(p)
    expect(base.examTotal).toBe(secureQs.length)
    expect(base.examCorrect).toBe(0)
    // Track exam t1: every Secure question in t1 right.
    const t1 = secureQs.filter((x) => x.t.id === 't1')
    p.recordExam('t1', Object.fromEntries((FAKE[0].exam ?? []).map((q) => [q.id, t1.some((x) => x.q.id === q.id)])))
    const afterTrack = secureRow(p).examCorrect
    expect(afterTrack).toBe(t1.length)
    // Exam mode attempt covering the same t1 questions, all right: must not double count.
    const mk = (submittedAt: number, correctRefs: string[], wrongRefs: string[]) => ({ id: `SAA.1.a.${submittedAt}.0`, family: 'SAA' as const, startedAt: submittedAt - 1, submittedAt, durationSec: 0, elapsedSec: 1, score: correctRefs.length, total: correctRefs.length + wrongRefs.length, byDomain: {}, correctRefs, wrongRefs })
    const t1Refs = t1.map((x) => `t1/${x.q.id}`)
    p.recordAttempt(mk(Date.now() + 10, t1Refs, []))
    expect(secureRow(p).examCorrect).toBe(afterTrack)
    // It also covers t2 questions: those add.
    const t2Refs = secureQs.filter((x) => x.t.id === 't2').map((x) => `t2/${x.q.id}`)
    p.recordAttempt(mk(Date.now() + 20, t2Refs, []))
    expect(secureRow(p).examCorrect).toBe(secureQs.length)
    expect(secureRow(p).percent).toBe(50) // no modules done: half from exam answers
    // A later wrong answer to one t2 question lowers it again.
    p.recordAttempt(mk(Date.now() + 30, [], [t2Refs[0]]))
    expect(secureRow(p).examCorrect).toBe(secureQs.length - 1)
    // An older attempt never overrides a newer result.
    p.recordAttempt(mk(1, [], [t2Refs[1]]))
    expect(secureRow(p).examCorrect).toBe(secureQs.length - 1)
  })
})
