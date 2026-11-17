import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { LESSONS } from '../shared/lessons'
import { TRACKS } from '../shared/tracks'
import { continueTarget } from '../shared/continue'
import type { ExamAttempt, ModuleProgress } from '../shared/types'
import { Progress } from '../server/progress'
import { buildExport, mergeData, parseImport, EXPORT_VERSION, type ProgressData } from '../server/progress-io'

const SENTINEL = 'sk-test-SENTINEL'
const known = { modules: new Set(LESSONS.map((l) => l.id)), tracks: new Set(TRACKS.map((t) => t.id)) }
const tmpFile = () => path.join(mkdtempSync(path.join(tmpdir(), 'dojo-io-')), 'progress.json')
const mod = (o: Partial<ModuleProgress> = {}): ModuleProgress => ({ checksPassed: [], checksTotal: 4, breakIt: false, predict: {}, seconds: 0, ...o })
const attempt = (id: string, submittedAt: number): ExamAttempt => ({ id, family: 'SAA', startedAt: submittedAt - 5, submittedAt, durationSec: 0, elapsedSec: 5, score: 1, total: 2, byDomain: { 'SAA:Secure': { correct: 1, total: 2 } }, correctRefs: ['iam/e1'], wrongRefs: ['iam/e2'] })
const [m1, m2, m3] = LESSONS.map((l) => l.id)
const data = (): ProgressData => ({ modules: { [m1]: mod({ checksPassed: ['a', 'b'], completedAt: 5, lastSeen: 100 }), [m2]: mod({ checksPassed: ['a'], lastSeen: 300 }) }, exams: { iam: { answers: { e1: true, e2: false }, at: 50 } }, examAttempts: [attempt('SAA.2.a.1760000000000.0', 1760000000000)] })

/** Keys anywhere in the object that look like secrets. */
const secretKeys = (v: unknown, out: string[] = []): string[] => {
  if (Array.isArray(v)) v.forEach((x) => secretKeys(x, out))
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (/key|token|secret|password|authorization|header/i.test(k)) out.push(k); secretKeys(x, out) }
  return out
}

describe('export', () => {
  test('contains version, exportedAt and learning progress only', () => {
    const e = buildExport(data(), { theme: 'light' }, new Date('2026-01-02T03:04:05Z'))
    expect(e).toMatchObject({ app: 'cloud-dojo-progress', version: EXPORT_VERSION, exportedAt: '2026-01-02T03:04:05.000Z', settings: { theme: 'light' } })
    expect(Object.keys(e).sort()).toEqual(['app', 'examAttempts', 'exams', 'exportedAt', 'modules', 'settings', 'version'])
  })
  test('never leaks secrets: sentinel and key-like fields are absent even if they reached the store or settings', () => {
    const file = tmpFile()
    // A store file polluted with tutor settings, headers and env-like values, as a worst case.
    const dirty = { ...data(), llm: { apiKey: SENTINEL, headers: { authorization: `Bearer ${SENTINEL}` } }, env: { ANTHROPIC_API_KEY: SENTINEL }, path: '/Users/someone/.aws/credentials' } as Record<string, unknown>
    ;(dirty.modules as Record<string, Record<string, unknown>>)[m1].apiKey = SENTINEL
    ;(dirty.modules as Record<string, Record<string, unknown>>)[m1].note = SENTINEL
    ;(dirty.examAttempts as unknown as Record<string, unknown>[])[0].token = SENTINEL
    writeFileSync(file, JSON.stringify(dirty))
    const p = new Progress(file)
    const out = p.exportData({ theme: 'dark', apiKey: SENTINEL, 'x-api-key': SENTINEL } as never)
    const text = JSON.stringify(out)
    expect(text).not.toContain(SENTINEL)
    expect(text).not.toContain('.aws')
    expect(text).not.toContain('/Users')
    expect(secretKeys(out)).toEqual([])
    expect(out.modules[m1].checksPassed).toEqual(['a', 'b']) // real progress survives the whitelist
    // and the persisted progress.json written by the app is clean of anything the export would have dropped being added
    p.tick(m3, 5)
    expect(readFileSync(file, 'utf8')).toContain(m3)
  })
})

describe('import validation', () => {
  test('exports from before the rename (app id "aws-academy-progress") still import', () => {
    const r = parseImport({ ...ok(), app: 'aws-academy-progress' }, known)
    expect(r.ok).toBe(true)
  })
  const ok = () => JSON.parse(JSON.stringify(buildExport(data(), { theme: 'dark' })))
  test('accepts an export round trip', () => {
    const r = parseImport(ok(), known)
    expect(r.ok).toBe(true)
    if (r.ok) { expect(r.data).toEqual(data()); expect(r.settings).toEqual({ theme: 'dark' }); expect(r.skipped).toBe(0) }
  })
  test('round trip through a real Progress instance (replace) restores the same view', () => {
    const a = new Progress(tmpFile()); a.importData(data(), 'replace')
    const b = new Progress(tmpFile())
    const r = parseImport(JSON.parse(JSON.stringify(a.exportData())), known)
    if (!r.ok) throw new Error(r.error)
    b.importData(r.data, 'replace')
    expect(b.view(LESSONS, TRACKS)).toEqual(a.view(LESSONS, TRACKS))
  })
  test.each([
    ['null', null], ['a string', 'hello'], ['an array', []], ['empty object', {}],
    ['wrong app', { ...ok(), app: 'other' }],
    ['future version', { ...ok(), version: 99 }],
    ['no version', (() => { const x = ok(); delete x.version; return x })()],
    ['bad date', { ...ok(), exportedAt: 'yesterday' }],
    ['unknown top-level field (apiKey)', { ...ok(), apiKey: SENTINEL }],
    ['unknown module field', (() => { const x = ok(); x.modules[m1].apiKey = SENTINEL; return x })()],
    ['negative seconds', (() => { const x = ok(); x.modules[m1].seconds = -1; return x })()],
    ['checksPassed not strings', (() => { const x = ok(); x.modules[m1].checksPassed = [1, 2]; return x })()],
    ['modules as array', { ...ok(), modules: [] }],
    ['bad attempt family', (() => { const x = ok(); x.examAttempts[0].family = 'XXX'; return x })()],
    ['bad attempt ref', (() => { const x = ok(); x.examAttempts[0].wrongRefs = ['../../etc/passwd']; return x })()],
    ['bad module id', (() => { const x = ok(); x.modules['../x'] = mod(); return x })()],
    ['settings with a key', { ...ok(), settings: { theme: 'dark', apiKey: SENTINEL } }],
    ['bad theme', { ...ok(), settings: { theme: 'neon' } }],
  ])('rejects %s', (_n, raw) => { expect(parseImport(raw, known).ok).toBe(false) })
  test('unknown module and track ids are dropped and counted, not stored', () => {
    const x = ok(); x.modules['not-a-module'] = mod(); x.exams['not-a-track'] = { answers: {}, at: 1 }
    const r = parseImport(x, known)
    if (!r.ok) throw new Error(r.error)
    expect(r.skipped).toBe(2)
    expect(Object.keys(r.data.modules)).not.toContain('not-a-module')
  })
})

describe('merge and replace', () => {
  test('merge keeps the more complete module, takes the newer exam, unions attempts, keeps the newest lastSeen', () => {
    const cur: ProgressData = { modules: { [m1]: mod({ checksPassed: ['a'], lastSeen: 900 }), [m2]: mod({ checksPassed: ['a', 'b', 'c'], lastSeen: 10 }) }, exams: { iam: { answers: { e1: false }, at: 100 }, s3: { answers: { e1: true }, at: 1 } }, examAttempts: [attempt('A', 1)] }
    const inc: ProgressData = { modules: { [m1]: mod({ checksPassed: ['a', 'b'], completedAt: 5, lastSeen: 100 }), [m2]: mod({ checksPassed: ['a'], lastSeen: 700 }), [m3]: mod({ checksPassed: ['z'] }) }, exams: { iam: { answers: { e1: true }, at: 50 }, s3: { answers: { e1: false }, at: 9 } }, examAttempts: [attempt('A', 1), attempt('B', 2)] }
    const r = mergeData(cur, inc)
    expect(r.modules[m1].completedAt).toBe(5) // completed beats more recent but unfinished
    expect(r.modules[m1].checksPassed).toEqual(['a', 'b'])
    expect(r.modules[m1].lastSeen).toBe(900) // newest lastSeen of both
    expect(r.modules[m2].checksPassed).toEqual(['a', 'b', 'c']) // more checks passed wins
    expect(r.modules[m2].lastSeen).toBe(700)
    expect(r.modules[m3]).toBeDefined()
    expect(r.exams.iam.at).toBe(100) // newer wins
    expect(r.exams.s3.answers.e1).toBe(false)
    expect(r.examAttempts.map((a) => a.id)).toEqual(['A', 'B'])
  })
  test('merge is idempotent and does not mutate its inputs', () => {
    const a = data(), b = data()
    const once = mergeData(a, b)
    expect(mergeData(once, b)).toEqual(once)
    expect(a).toEqual(data())
  })
  test('replace drops what the file does not have; merge keeps it', () => {
    const p = new Progress(tmpFile()); p.importData(data(), 'replace')
    const only: ProgressData = { modules: { [m3]: mod({ checksPassed: ['x'] }) }, exams: {}, examAttempts: [] }
    p.importData(only, 'merge')
    expect(Object.keys(p.view(LESSONS, TRACKS).modules).sort()).toEqual([m1, m2, m3].sort())
    p.importData(only, 'replace')
    expect(Object.keys(p.view(LESSONS, TRACKS).modules)).toEqual([m3])
  })
})

describe('continue where you left off', () => {
  test('most recently seen unfinished module, with checks x of y', () => {
    const t = continueTarget(data().modules, LESSONS)!
    expect(t.lesson.id).toBe(m2) // m1 is complete, m2 seen latest
    expect(t.passed).toBe(1)
    expect(t.total).toBe(4)
    expect(t.started).toBe(true)
  })
  test('new learner gets the first module; finished-everything-seen suggests the next undone', () => {
    const fresh = continueTarget({}, LESSONS)!
    expect(fresh.lesson.id).toBe(m1)
    expect(fresh.started).toBe(false)
    const done = continueTarget({ [m1]: mod({ completedAt: 1, lastSeen: 5 }) }, LESSONS)!
    expect(done.lesson.id).toBe(m2)
    expect(continueTarget(undefined, [])).toBeNull()
  })
})
