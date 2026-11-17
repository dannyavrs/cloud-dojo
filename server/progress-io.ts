import type { ExamAttempt, ExamFamily, ExamProgress, ModuleProgress } from '../shared/types'

/** Everything the learner has earned, and nothing else. This is what gets exported, imported and persisted. */
export interface ProgressData { modules: Record<string, ModuleProgress>; exams: Record<string, ExamProgress>; examAttempts: ExamAttempt[] }

export const EXPORT_APP = 'cloud-dojo-progress'
/** Exports made before the rename ("AWS Academy") are still accepted on import. */
export const LEGACY_EXPORT_APPS = ['aws-academy-progress']
export const EXPORT_VERSION = 1
export const MAX_ATTEMPTS = 50
export type ImportMode = 'merge' | 'replace'
export interface ExportSettings { theme?: 'dark' | 'light' }
export interface ProgressExport { app: typeof EXPORT_APP; version: number; exportedAt: string; modules: ProgressData['modules']; exams: ProgressData['exams']; examAttempts: ExamAttempt[]; settings?: ExportSettings }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown, min = 0): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min
const ID = /^[\w.-]{1,80}$/
const REF = /^[\w-]{1,60}\/[\w.-]{1,60}$/
const FAMILIES: string[] = ['SAA', 'DVA', 'MIXED']

class Bad extends Error {}
function need(cond: unknown, msg: string): asserts cond { if (!cond) throw new Bad(msg) }
const onlyKeys = (o: Record<string, unknown>, allowed: string[], where: string) => {
  for (const k of Object.keys(o)) need(allowed.includes(k), `${where}: unexpected field "${k}"`)
}

function moduleOf(raw: unknown, where: string): ModuleProgress {
  need(isObj(raw), `${where}: expected an object`)
  onlyKeys(raw, ['checksPassed', 'checksTotal', 'breakIt', 'predict', 'seconds', 'completedAt', 'manual', 'lastSeen'], where)
  need(Array.isArray(raw.checksPassed) && raw.checksPassed.length <= 500 && raw.checksPassed.every((c) => typeof c === 'string' && ID.test(c)), `${where}.checksPassed`)
  need(num(raw.checksTotal) && Number.isInteger(raw.checksTotal) && raw.checksTotal <= 500, `${where}.checksTotal`)
  need(typeof raw.breakIt === 'boolean', `${where}.breakIt`)
  need(isObj(raw.predict) && Object.keys(raw.predict).length <= 100 && Object.entries(raw.predict).every(([k, v]) => ID.test(k) && typeof v === 'boolean'), `${where}.predict`)
  need(num(raw.seconds) && raw.seconds < 1e8, `${where}.seconds`)
  need(raw.completedAt === undefined || num(raw.completedAt), `${where}.completedAt`)
  need(raw.manual === undefined || typeof raw.manual === 'boolean', `${where}.manual`)
  need(raw.lastSeen === undefined || num(raw.lastSeen), `${where}.lastSeen`)
  const m: ModuleProgress = { checksPassed: [...new Set(raw.checksPassed as string[])], checksTotal: raw.checksTotal as number, breakIt: raw.breakIt, predict: raw.predict as Record<string, boolean>, seconds: raw.seconds as number }
  if (raw.completedAt !== undefined) m.completedAt = raw.completedAt as number
  if (raw.completedAt !== undefined && raw.manual === true) m.manual = true
  if (raw.lastSeen !== undefined) m.lastSeen = raw.lastSeen as number
  return m
}

function examOf(raw: unknown, where: string): ExamProgress {
  need(isObj(raw), `${where}: expected an object`)
  onlyKeys(raw, ['answers', 'at'], where)
  need(isObj(raw.answers) && Object.keys(raw.answers).length <= 500 && Object.entries(raw.answers).every(([k, v]) => ID.test(k) && typeof v === 'boolean'), `${where}.answers`)
  need(num(raw.at), `${where}.at`)
  return { answers: raw.answers as Record<string, boolean>, at: raw.at as number }
}

function attemptOf(raw: unknown, where: string): ExamAttempt {
  need(isObj(raw), `${where}: expected an object`)
  onlyKeys(raw, ['id', 'family', 'startedAt', 'submittedAt', 'durationSec', 'elapsedSec', 'score', 'total', 'byDomain', 'correctRefs', 'wrongRefs'], where)
  need(typeof raw.id === 'string' && raw.id.length <= 80 && /^[\w.-]+$/.test(raw.id), `${where}.id`)
  need(typeof raw.family === 'string' && FAMILIES.includes(raw.family), `${where}.family`)
  for (const k of ['startedAt', 'submittedAt', 'durationSec', 'elapsedSec', 'score', 'total'] as const) need(num(raw[k]), `${where}.${k}`)
  const refs = (v: unknown, k: string) => { need(Array.isArray(v) && v.length <= 500 && v.every((r) => typeof r === 'string' && REF.test(r)), `${where}.${k}`); return v as string[] }
  need(isObj(raw.byDomain) && Object.keys(raw.byDomain).length <= 40, `${where}.byDomain`)
  const byDomain: ExamAttempt['byDomain'] = {}
  for (const [d, v] of Object.entries(raw.byDomain)) {
    need(/^[\w:-]{1,40}$/.test(d) && isObj(v) && num(v.correct) && num(v.total), `${where}.byDomain.${d}`)
    onlyKeys(v, ['correct', 'total'], `${where}.byDomain.${d}`)
    byDomain[d] = { correct: v.correct as number, total: v.total as number }
  }
  return {
    id: raw.id, family: raw.family as ExamFamily, startedAt: raw.startedAt as number, submittedAt: raw.submittedAt as number, durationSec: raw.durationSec as number,
    elapsedSec: raw.elapsedSec as number, score: raw.score as number, total: raw.total as number, byDomain, correctRefs: refs(raw.correctRefs, 'correctRefs'), wrongRefs: refs(raw.wrongRefs, 'wrongRefs'),
  }
}

const pick = (o: unknown, keys: string[]) => (isObj(o) ? Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]])) : o)
const MODULE_KEYS = ['checksPassed', 'checksTotal', 'breakIt', 'predict', 'seconds', 'completedAt', 'manual', 'lastSeen']
const EXAM_KEYS = ['answers', 'at']
const ATTEMPT_KEYS = ['id', 'family', 'startedAt', 'submittedAt', 'durationSec', 'elapsedSec', 'score', 'total', 'byDomain', 'correctRefs', 'wrongRefs']

/** Build the export from a whitelist of fields, so nothing else that ever lands in the store can leak. */
export function buildExport(data: ProgressData, settings?: ExportSettings, now = new Date()): ProgressExport {
  const modules: ProgressData['modules'] = {}
  for (const [id, m] of Object.entries(data.modules)) { try { modules[id] = moduleOf(pick(m, MODULE_KEYS), id) } catch { /* skip malformed records */ } }
  const exams: ProgressData['exams'] = {}
  for (const [id, e] of Object.entries(data.exams)) { try { exams[id] = examOf(pick(e, EXAM_KEYS), id) } catch { /* skip */ } }
  const examAttempts: ExamAttempt[] = []
  for (const a of data.examAttempts) { try { examAttempts.push(attemptOf(pick(a, ATTEMPT_KEYS), a.id)) } catch { /* skip */ } }
  const out: ProgressExport = { app: EXPORT_APP, version: EXPORT_VERSION, exportedAt: now.toISOString(), modules, exams, examAttempts }
  if (settings?.theme === 'dark' || settings?.theme === 'light') out.settings = { theme: settings.theme }
  return out
}

export interface Known { modules: Set<string>; tracks: Set<string> }
export type ParseResult = { ok: true; data: ProgressData; settings: ExportSettings; skipped: number } | { ok: false; error: string }

/** Strict validation of an uploaded export. Unknown fields are rejected, unknown module/track ids are dropped and counted. */
export function parseImport(raw: unknown, known?: Known): ParseResult {
  try {
    need(isObj(raw), 'not a JSON object')
    onlyKeys(raw, ['app', 'version', 'exportedAt', 'modules', 'exams', 'examAttempts', 'settings'], 'file')
    need(raw.app === EXPORT_APP || LEGACY_EXPORT_APPS.includes(raw.app as string), 'this is not a Cloud Dojo progress export')
    need(typeof raw.version === 'number' && Number.isInteger(raw.version) && raw.version >= 1, 'missing version')
    need(raw.version <= EXPORT_VERSION, `export version ${raw.version} is newer than this app understands (${EXPORT_VERSION})`)
    need(typeof raw.exportedAt === 'string' && !Number.isNaN(Date.parse(raw.exportedAt)), 'exportedAt must be a date string')
    need(isObj(raw.modules) && Object.keys(raw.modules).length <= 1000, 'modules')
    need(isObj(raw.exams) && Object.keys(raw.exams).length <= 100, 'exams')
    need(Array.isArray(raw.examAttempts) && raw.examAttempts.length <= 500, 'examAttempts')
    let skipped = 0
    const data: ProgressData = { modules: {}, exams: {}, examAttempts: [] }
    for (const [id, m] of Object.entries(raw.modules)) {
      need(ID.test(id), `modules: bad id "${id.slice(0, 40)}"`)
      const mod = moduleOf(m, `modules.${id}`)
      if (known && !known.modules.has(id)) skipped++
      else data.modules[id] = mod
    }
    for (const [id, e] of Object.entries(raw.exams)) {
      need(ID.test(id), `exams: bad id "${id.slice(0, 40)}"`)
      const ex = examOf(e, `exams.${id}`)
      if (known && !known.tracks.has(id)) skipped++
      else data.exams[id] = ex
    }
    const seen = new Set<string>()
    raw.examAttempts.forEach((a, i) => { const at = attemptOf(a, `examAttempts[${i}]`); if (!seen.has(at.id)) { seen.add(at.id); data.examAttempts.push(at) } })
    data.examAttempts = capAttempts(data.examAttempts)
    const settings: ExportSettings = {}
    if (raw.settings !== undefined) {
      need(isObj(raw.settings), 'settings')
      onlyKeys(raw.settings, ['theme'], 'settings')
      need(raw.settings.theme === undefined || raw.settings.theme === 'dark' || raw.settings.theme === 'light', 'settings.theme')
      if (raw.settings.theme) settings.theme = raw.settings.theme
    }
    return { ok: true, data, settings, skipped }
  } catch (e) {
    if (e instanceof Bad) return { ok: false, error: e.message }
    throw e
  }
}

const capAttempts = (a: ExamAttempt[]) => [...a].sort((x, y) => x.submittedAt - y.submittedAt).slice(-MAX_ATTEMPTS)

const predictCorrect = (m: ModuleProgress) => Object.values(m.predict).filter(Boolean).length
/** Rank for "which module record is further along": completed, verified over manual, then checks passed, then break-it, then predictions, then time spent. */
const rank = (m: ModuleProgress) => [m.completedAt ? 1 : 0, m.completedAt && !m.manual ? 1 : 0, m.checksPassed.length, m.breakIt ? 1 : 0, predictCorrect(m), m.seconds]
function moreComplete(a: ModuleProgress, b: ModuleProgress): boolean {
  const ra = rank(a), rb = rank(b)
  for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] > rb[i]
  return false
}

/**
 * Merge rule (default import):
 * - module: keep whichever record is more complete (completed, verified over marked-by-you > more checks passed > break-it > more predictions right > more time);
 *   on a tie keep the current one. lastSeen is always the newer of the two so "Continue" points at the latest work.
 * - track exam: the newer attempt (`at`) wins.
 * - exam-mode attempts: union by id, newest 50 kept.
 */
export function mergeData(current: ProgressData, incoming: ProgressData): ProgressData {
  const modules: ProgressData['modules'] = { ...current.modules }
  for (const [id, inc] of Object.entries(incoming.modules)) {
    const cur = modules[id]
    const win = !cur || moreComplete(inc, cur) ? inc : cur
    const lastSeen = Math.max(cur?.lastSeen ?? 0, inc.lastSeen ?? 0)
    modules[id] = lastSeen ? { ...win, lastSeen } : { ...win }
  }
  const exams: ProgressData['exams'] = { ...current.exams }
  for (const [id, inc] of Object.entries(incoming.exams)) if (!exams[id] || inc.at > exams[id].at) exams[id] = inc
  const byId = new Map(current.examAttempts.map((a) => [a.id, a]))
  for (const a of incoming.examAttempts) if (!byId.has(a.id)) byId.set(a.id, a)
  return { modules, exams, examAttempts: capAttempts([...byId.values()]) }
}
