import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { CheckResult, DomainReadiness, ExamAttempt, LessonContent, ModuleProgress, ProgressView, Track } from '../shared/types'
import { refOf } from '../shared/exam-mode'
import { buildExport, mergeData, MAX_ATTEMPTS, type ExportSettings, type ImportMode, type ProgressData } from './progress-io'

type Store = ProgressData

/** Learner progress in a JSON file. It survives restarts of the server and of the emulator. */
export class Progress {
  private data: Store = { modules: {}, exams: {}, examAttempts: [] }
  private file: string
  constructor(file: string) {
    this.file = file
    try { if (existsSync(file)) this.data = { modules: {}, exams: {}, examAttempts: [], ...JSON.parse(readFileSync(file, 'utf8')) } } catch { /* start clean */ }
  }

  private save() {
    mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2))
    renameSync(tmp, this.file)
  }

  private mod(id: string): ModuleProgress {
    return (this.data.modules[id] ??= { checksPassed: [], checksTotal: 0, breakIt: false, predict: {}, seconds: 0 })
  }

  /** Called whenever the checker runs. Passed checks stick, so a state that later changes does not erase progress. */
  recordChecks(lesson: LessonContent, results: CheckResult[]) {
    const m = this.mod(lesson.id)
    let changed = m.checksTotal !== results.length
    m.checksTotal = results.length
    for (const r of results) {
      if (r.pass === true && !m.checksPassed.includes(r.id)) { m.checksPassed.push(r.id); changed = true }
    }
    if (lesson.breakItCheck && !m.breakIt && m.checksPassed.includes(lesson.breakItCheck)) { m.breakIt = true; changed = true }
    if (!lesson.breakItCheck && !m.breakIt) { m.breakIt = true; changed = true } // nothing to break in this module
    if (!m.completedAt && m.checksTotal > 0 && lesson.checks.every((c) => m.checksPassed.includes(c.id))) { m.completedAt = Date.now(); changed = true }
    if (changed) this.save()
  }

  recordPredict(moduleId: string, qid: string, correct: boolean) {
    const m = this.mod(moduleId)
    m.predict[qid] = m.predict[qid] === true ? true : correct // first correct answer sticks
    this.save()
  }

  recordExam(trackId: string, answers: Record<string, boolean>) {
    this.data.exams[trackId] = { answers, at: Date.now() }
    this.save()
  }

  recordAttempt(a: ExamAttempt) {
    this.data.examAttempts = [...this.data.examAttempts.filter((x) => x.id !== a.id), a].sort((x, y) => x.submittedAt - y.submittedAt).slice(-MAX_ATTEMPTS)
    this.save()
  }

  /** Learning progress only, built from a whitelist (see progress-io). */
  exportData(settings?: ExportSettings) { return buildExport(this.data, settings) }

  importData(incoming: ProgressData, mode: ImportMode) {
    this.data = mode === 'replace' ? { modules: incoming.modules, exams: incoming.exams, examAttempts: incoming.examAttempts } : mergeData(this.data, incoming)
    this.save()
    return { modules: Object.keys(this.data.modules).length, exams: Object.keys(this.data.exams).length, attempts: this.data.examAttempts.length }
  }

  /** Seconds the learner spent on a module. The client sends small heartbeats while the tab is visible. */
  tick(moduleId: string, seconds: number) {
    const s = Math.max(0, Math.min(60, Math.round(seconds)))
    if (!s) return
    const m = this.mod(moduleId)
    m.seconds += s
    m.lastSeen = Date.now()
    this.save()
  }

  view(lessons: LessonContent[], tracks: Track[]): ProgressView {
    const done = (id: string) => Boolean(this.data.modules[id]?.completedAt)
    // Readiness rule (no double counting): every exam question counts once, as its latest outcome across the
    // track exam (exams[track].at) and exam-mode attempts (submittedAt). Questions never answered count as not ready.
    const latest = new Map<string, { at: number; ok: boolean }>()
    for (const t of tracks) {
      const e = this.data.exams[t.id]
      if (e) for (const q of t.exam ?? []) if (q.id in e.answers) latest.set(refOf(t.id, q.id), { at: e.at, ok: e.answers[q.id] === true })
    }
    for (const a of this.data.examAttempts) {
      for (const [refs, ok] of [[a.correctRefs, true], [a.wrongRefs, false]] as const) {
        for (const ref of refs) { const cur = latest.get(ref); if (!cur || a.submittedAt >= cur.at) latest.set(ref, { at: a.submittedAt, ok }) }
      }
    }
    const isRight = (t: Track, qid: string) => latest.get(refOf(t.id, qid))?.ok === true
    const examCorrect = (t: Track) => (t.exam ?? []).filter((q) => isRight(t, q.id)).length
    const trackSummaries = tracks.map((t) => {
      const mods = lessons.filter((l) => l.trackId === t.id)
      return { id: t.id, done: mods.filter((l) => done(l.id)).length, total: mods.length, examCorrect: examCorrect(t), examTotal: t.exam?.length ?? 0 }
    })
    const domains = new Set<string>([...lessons.flatMap((l) => l.examTags), ...tracks.flatMap((t) => (t.exam ?? []).map((q) => q.tag ?? ''))].filter(Boolean))
    const readiness: DomainReadiness[] = [...domains].sort().map((domain) => {
      const mods = lessons.filter((l) => l.examTags.includes(domain))
      const qs = tracks.flatMap((t) => (t.exam ?? []).filter((q) => q.tag === domain).map((q) => ({ t, q })))
      const modulesDone = mods.filter((l) => done(l.id)).length
      const correct = qs.filter(({ t, q }) => isRight(t, q.id)).length
      const modPct = mods.length ? modulesDone / mods.length : 0
      // Half from modules completed, half from exam answers when this domain has exam questions.
      const percent = qs.length ? Math.round(50 * modPct + 50 * (correct / qs.length)) : Math.round(100 * modPct)
      return { domain, modulesDone, modulesTotal: mods.length, examCorrect: correct, examTotal: qs.length, percent }
    })
    return { modules: this.data.modules, exams: this.data.exams, tracks: trackSummaries, readiness, examAttempts: this.data.examAttempts }
  }
}
