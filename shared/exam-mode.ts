import { modulesOf, shortTitle } from './lessons'
import type { ExamFamily, QuizQuestion, Track } from './types'

/** Exam mode: a mixed practice exam drawn from every track exam. Pure and deterministic given a seed. */

export const FAMILIES: { id: ExamFamily; label: string; blurb: string }[] = [
  { id: 'SAA', label: 'Solutions Architect Associate', blurb: 'Secure, resilient, performant and cost-optimised design' },
  { id: 'DVA', label: 'Developer Associate', blurb: 'Development, security, deployment and troubleshooting' },
  { id: 'MIXED', label: 'Mixed', blurb: 'Every domain from both exams' },
]
export const DOMAIN_NAME: Record<string, string> = { Secure: 'Secure', Resilient: 'Resilient', Performant: 'Performant', Cost: 'Cost-optimised', Dev: 'Development', Sec: 'Security', Deploy: 'Deployment', Troubleshoot: 'Troubleshooting' }
export const FAMILY_DOMAINS: Record<'SAA' | 'DVA', string[]> = { SAA: ['Secure', 'Resilient', 'Performant', 'Cost'], DVA: ['Dev', 'Sec', 'Deploy', 'Troubleshoot'] }
export const LENGTHS = [20, 40, 65]
/** Seconds per question offered in the picker. 0 = untimed. */
export const PACES = [0, 60, 90, 120]
export const DEFAULT_PACE = 90

export interface PoolQuestion { ref: string; trackId: string; q: QuizQuestion }
export const refOf = (trackId: string, qid: string) => `${trackId}/${qid}`
export const domainOf = (q: QuizQuestion) => q.tag ?? 'General'

/** Every question of every track exam, in track order. Never hardcode counts: tracks are filled in over time. */
export const poolOf = (tracks: Track[]): PoolQuestion[] =>
  tracks.flatMap((t) => (t.exam ?? []).map((q) => ({ ref: refOf(t.id, q.id), trackId: t.id, q })))

export const inFamily = (p: PoolQuestion, family: ExamFamily) => family === 'MIXED' || (p.q.tag ?? '').startsWith(`${family}:`)

/** mulberry32: tiny seeded PRNG. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
function shuffled<T>(xs: T[], r: () => number): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}
const groupBy = <T,>(xs: T[], key: (x: T) => string) => {
  const m = new Map<string, T[]>()
  for (const x of xs) { const k = key(x); const l = m.get(k); if (l) l.push(x); else m.set(k, [x]) }
  return m
}

export const availableCount = (pool: PoolQuestion[], family: ExamFamily) => pool.filter((p) => inFamily(p, family)).length

/**
 * Draw `count` questions (capped by what exists) for a family.
 * Balance: round-robin over domains (so each domain gets an even share until it runs out), and inside a domain
 * round-robin over tracks. The picked set is shuffled at the end so domains do not arrive in blocks.
 * Same pool + family + count + seed always gives the same list.
 */
export function drawExam(pool: PoolQuestion[], family: ExamFamily, count: number, seed: number): PoolQuestion[] {
  const r = rng(seed)
  const eligible = pool.filter((p) => inFamily(p, family))
  const n = Math.max(0, Math.min(Math.floor(count), eligible.length))
  const byDomain = groupBy(eligible, (p) => domainOf(p.q))
  // Sort keys first so the shuffle does not depend on pool order beyond the pool itself.
  const queues = shuffled([...byDomain.keys()].sort(), r).map((d) => {
    const byTrack = groupBy(byDomain.get(d)!, (p) => p.trackId)
    const lanes = shuffled([...byTrack.keys()].sort(), r).map((t) => shuffled(byTrack.get(t)!, r))
    const out: PoolQuestion[] = []
    for (let i = 0; out.length < byDomain.get(d)!.length; i++) for (const lane of lanes) if (i < lane.length) out.push(lane[i])
    return out
  })
  const picked: PoolQuestion[] = []
  for (let i = 0; picked.length < n; i++) for (const q of queues) { if (picked.length < n && i < q.length) picked.push(q[i]) }
  return shuffled(picked, r)
}

/**
 * An attempt id carries everything needed to rebuild the attempt, so the server keeps no state between
 * "start" and "submit": family.count.seed.startedAt.secondsPerQuestion. Re-submitting the same id replaces the attempt.
 */
export interface AttemptSpec { family: ExamFamily; count: number; seed: number; startedAt: number; pace: number }
export const attemptId = (s: AttemptSpec) => [s.family, s.count, s.seed.toString(36), s.startedAt, s.pace].join('.')
export function parseAttemptId(id: unknown): AttemptSpec | null {
  if (typeof id !== 'string') return null
  const m = id.match(/^(SAA|DVA|MIXED)\.(\d{1,3})\.([0-9a-z]{1,8})\.(\d{10,14})\.(\d{1,3})$/)
  if (!m) return null
  const seed = parseInt(m[3], 36)
  const count = Number(m[2])
  const pace = Number(m[5])
  if (!Number.isFinite(seed) || count < 1 || pace > 600) return null
  return { family: m[1] as ExamFamily, count, seed, startedAt: Number(m[4]), pace }
}

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9][a-z0-9-]{3,}/g) ?? [])

/**
 * Best module to study for a missed question. Deterministic: modules of the question's own track only;
 * a module whose examTags include the question's domain wins by a wide margin, then word overlap between the
 * question text and the module title/tagline/goal, then the earliest module.
 */
export function studyTarget(trackId: string, q: QuizQuestion): { moduleId: string; label: string } | null {
  const mods = modulesOf(trackId)
  if (!mods.length) return null
  const qw = words(`${q.prompt} ${q.code ?? ''} ${q.explain}`)
  let best = mods[0]
  let bestScore = -1
  for (const m of mods) {
    let score = q.tag && m.examTags.includes(q.tag) ? 1000 : 0
    for (const w of words(`${m.title} ${m.tagline} ${m.goal}`)) if (qw.has(w)) score++
    if (score > bestScore) { best = m; bestScore = score }
  }
  return { moduleId: best.id, label: `${best.n} ${shortTitle(best)}` }
}
