import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { lessonById, LESSONS } from '../shared/lessons'
import { TRACKS, trackById } from '../shared/tracks'
import type { CapabilityReport, CheckResult, EmulatorStatus, ProgressView, QuizResult, ResourceMap, RunRecord } from '../shared/types'
import { makeClients, type Clients } from './clients'
import { EmulatorManager } from './emulator'
import { buildMap } from './inventory'
import { loadCapabilities, runProbe } from './capabilities'
import { writeModuleFile, type WriteResult } from './files'
import { listFiles, workdirFor, writeStarterFiles, type Ctx, type ProbeRecord } from './lesson-kit'
import { DATA_DIR } from './paths'
import { Progress } from './progress'
import { sanitizeProbe, type ProbeInput } from './probe'
import { gradeExam, gradePredict, type ExamGrade } from './quiz'
import { serverLesson } from './lessons'
import { solution } from './lessons/capstone'
import { runAws, type RunResult } from './runner'

export class Dojo {
  emu = new EmulatorManager()
  currentLesson: string | null = null
  starting = false
  probing = false
  capabilities: CapabilityReport | null = loadCapabilities()
  progress: Progress
  private clients?: { gen: number; c: Clients }
  private histories = new Map<string, RunResult[]>()
  private probeLogs = new Map<string, ProbeRecord[]>()
  private startChain: Promise<unknown> = Promise.resolve()
  private mapCache?: { at: number; p: Promise<ResourceMap> }
  private solutionStep = 0

  private tutorInfo: () => EmulatorStatus['tutor']
  constructor(tutorInfo: () => EmulatorStatus['tutor'], dataDir = DATA_DIR) {
    this.tutorInfo = tutorInfo
    this.progress = new Progress(path.join(dataDir, 'progress.json'))
  }

  get c(): Clients {
    const info = this.emu.info
    if (!info) throw new Error('emulator not ready')
    if (!this.clients || this.clients.gen !== this.emu.generation) {
      this.clients?.c.destroy()
      this.clients = { gen: this.emu.generation, c: makeClients(info) }
    }
    return this.clients.c
  }

  status(): EmulatorStatus {
    return { ...this.emu.status, currentLesson: this.currentLesson, starting: this.starting, probing: this.probing, tutor: this.tutorInfo() }
  }

  history(id: string) { return this.histories.get(id) ?? [] }

  ctx(lessonId: string): Ctx {
    const info = this.emu.info!
    const ca = readFileSync(info.caPath, 'utf8')
    return {
      c: this.c, emu: info, workdir: workdirFor(lessonId), history: this.history(lessonId), lessonId, probes: this.probeLogs.get(lessonId) ?? [],
      httpGet: async (url, init) => {
        // only ever talk to the emulator's own origin
        if (new URL(url).origin !== new URL(info.endpoint).origin) throw new Error('Only the emulator address can be called from here.')
        const r = await fetch(url, { method: init?.method ?? 'GET', body: init?.body, headers: init?.headers, tls: { ca }, signal: AbortSignal.timeout(20000) })
        return { status: r.status, body: (await r.text()).slice(0, 8000), headers: Object.fromEntries([...r.headers].slice(0, 30)) }
      },
    }
  }

  /** Fresh emulator + starter files + fixture. Serialized: only one start at a time. */
  startLesson(id: string, opts: { fresh?: boolean } = {}): Promise<{ ms: number; files: string[] }> {
    const run = async () => {
      const l = serverLesson(id)
      if (!l) throw new Error('unknown lesson')
      this.starting = true
      const t0 = Date.now()
      try {
        await this.emu.ensureReady()
        await this.probeIfNeeded()
        if (this.currentLesson !== id || opts.fresh) {
          await this.emu.restart()
          this.currentLesson = null
          this.mapCache = undefined
          this.solutionStep = 0
          this.histories.set(id, [])
          this.probeLogs.set(id, [])
          writeStarterFiles(workdirFor(id), l)
          await l.fixture?.(this.ctx(id))
          this.currentLesson = id
        }
      } finally {
        this.starting = false
      }
      return { ms: Date.now() - t0, files: listFiles(workdirFor(id)) }
    }
    const p = this.startChain.then(run, run)
    this.startChain = p.catch(() => undefined)
    return p
  }

  /** Once per emulator image: find out what it enforces. The probe dirties the emulator, so it restarts afterwards. */
  private async probeIfNeeded() {
    if (this.capabilities || !this.emu.info) return
    this.probing = true
    try {
      this.capabilities = await runProbe(this.c, this.emu.info)
      await this.emu.restart()
      this.currentLesson = null
      this.mapCache = undefined
    } catch (e) {
      console.error('[dojo] capability probe failed:', e instanceof Error ? e.message : e)
    } finally { this.probing = false }
  }

  /** Queue the probe behind any lesson start so the two never touch the emulator at once. */
  warm(): Promise<unknown> {
    const run = async () => { await this.emu.ensureReady(); await this.probeIfNeeded() }
    const p = this.startChain.then(run, run)
    this.startChain = p.catch(() => undefined)
    return p
  }

  async checks(id: string, probe: boolean): Promise<CheckResult[]> {
    const l = serverLesson(id)
    const content = lessonById(id)
    if (!l || !content) throw new Error('unknown lesson')
    if (this.emu.status.phase !== 'ready' || !this.emu.info) throw new Error('emulator not ready')
    const results = await l.check(this.ctx(id), { probe })
    this.progress.recordChecks(content, results)
    return results
  }

  progressView(): ProgressView { return this.progress.view(LESSONS, TRACKS) }

  predict(id: string, qid: string, choice: unknown): QuizResult | null {
    const l = lessonById(id)
    const r = l ? gradePredict(l, qid, choice) : null
    if (r && l) this.progress.recordPredict(l.id, qid, r.correct)
    return r
  }

  exam(trackId: string, answers: Record<string, unknown>): ExamGrade | null {
    const t = trackById(trackId)
    const g = t ? gradeExam(t, answers) : null
    if (g && t) this.progress.recordExam(t.id, Object.fromEntries(Object.entries(g.results).map(([k, v]) => [k, v.correct])))
    return g
  }

  writeFile(id: string, name: string, text: string): WriteResult {
    if (!lessonById(id)) return { ok: false, error: 'unknown lesson' }
    return writeModuleFile(workdirFor(id), serverLesson(id), name, text)
  }

  async probeHttp(id: string, input: ProbeInput) {
    const req = sanitizeProbe(input)
    if (!req.ok) return { status: 0, body: req.error, headers: {} as Record<string, string> }
    const res = await this.ctx(id).httpGet(req.url, { method: req.method, body: req.body, headers: req.headers }).catch((e) => ({ status: 0, body: e instanceof Error ? e.message : String(e), headers: {} as Record<string, string> }))
    const log = this.probeLogs.get(id) ?? []
    log.push({ url: req.url, method: req.method, status: res.status, body: res.body.slice(0, 2000), at: Date.now() })
    this.probeLogs.set(id, log.slice(-30))
    return res
  }

  async run(id: string, command: string): Promise<RunRecord> {
    if (!this.emu.info) throw new Error('emulator not ready')
    const r = await runAws(command, this.emu.info, workdirFor(id))
    if (/--log-type\s+Tail/.test(command) && r.exitCode === 0) {
      const b64 = r.stdout.match(/[A-Za-z0-9+/=]{40,}/)?.[0]
      if (b64) r.stdout += `\n— decoded LogResult (decoded by the app) —\n${Buffer.from(b64, 'base64').toString('utf8')}`
    }
    const h = this.histories.get(id) ?? []
    h.push(r)
    this.histories.set(id, h.slice(-60))
    this.mapCache = undefined
    return r
  }

  map(): Promise<ResourceMap> {
    if (!this.emu.info || this.emu.status.phase !== 'ready') return Promise.resolve({ nodes: [], edges: [], at: Date.now(), error: 'emulator not ready' })
    if (this.mapCache && Date.now() - this.mapCache.at < 1500) return this.mapCache.p
    const p = buildMap(this.c).catch((e) => ({ nodes: [], edges: [], at: Date.now(), error: String(e) }))
    this.mapCache = { at: Date.now(), p }
    return p
  }

  files(id: string) { return listFiles(workdirFor(id)) }
  readFile(id: string, name: string): { text: string; binary: boolean } | null {
    if (name !== path.basename(name)) return null
    const p = path.join(workdirFor(id), name)
    try {
      const st = statSync(p)
      if (!st.isFile()) return null
      if (name.endsWith('.zip')) return { text: `(zip archive, ${st.size} bytes: the handler file inside is the matching .mjs next to it)`, binary: true }
      return { text: readFileSync(p, 'utf8').slice(0, 20000), binary: false }
    } catch { return null }
  }

  async showMe(): Promise<{ done: boolean; step?: number; total: number; title?: string; explain?: string }> {
    if (this.currentLesson !== 'capstone') throw new Error('Open the capstone first.')
    if (this.solutionStep >= solution.length) return { done: true, total: solution.length }
    const s = solution[this.solutionStep]
    await s.run(this.ctx('capstone'))
    this.solutionStep++
    this.mapCache = undefined
    return { done: this.solutionStep >= solution.length, step: this.solutionStep, total: solution.length, title: s.title, explain: s.explain }
  }

  lessonExists(id: string) { return Boolean(lessonById(id)) }
}
