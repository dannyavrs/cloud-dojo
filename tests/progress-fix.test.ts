import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { LESSONS } from '../shared/lessons'
import { doneKind, passedCount, withHistory } from '../shared/history'
import { DEFAULT_API_PORT, DEFAULT_WEB_PORT, TEST_API_PORT, TEST_WEB_PORT } from '../shared/ports'
import type { CheckResult, LessonContent, ModuleProgress } from '../shared/types'
import { Dojo } from '../server/app'
import { backupPath, writeFileAtomic } from '../server/atomic-file'
import { mergeLegacyProgress } from '../server/data-migration'
import { makeServerInfo, portConflict } from '../server/info'
import { DATA_DIR, DEFAULT_DATA_DIR } from '../server/paths'
import { Progress } from '../server/progress'
import { buildExport, mergeData, parseImport, type ProgressData } from '../server/progress-io'

const tmp = () => mkdtempSync(path.join(tmpdir(), 'dojo-fix-'))
const lesson: LessonContent = LESSONS.find((l) => l.checks.length >= 2)!
const results = (pass: (id: string, i: number) => boolean | null): CheckResult[] => lesson.checks.map((c, i) => ({ id: c.id, label: c.label, pass: pass(c.id, i) }))
const allPass = () => results(() => true)
const nonePass = () => results(() => false)
const mod = (o: Partial<ModuleProgress> = {}): ModuleProgress => ({ checksPassed: [], checksTotal: 4, breakIt: false, predict: {}, seconds: 0, ...o })
const read = (f: string) => JSON.parse(readFileSync(f, 'utf8')) as ProgressData

describe('manual complete and undo', () => {
  test('mark as done stores manual: true; undo clears completedAt and manual', () => {
    const f = path.join(tmp(), 'progress.json'); const p = new Progress(f)
    p.setComplete(lesson.id, true)
    const m = read(f).modules[lesson.id]
    expect(m.manual).toBe(true); expect(m.completedAt).toBeGreaterThan(0)
    expect(doneKind(m)).toBe('manual')
    p.setComplete(lesson.id, false)
    const u = read(f).modules[lesson.id]
    expect(u.completedAt).toBeUndefined(); expect(u.manual).toBeUndefined()
    expect(doneKind(u)).toBeNull()
  })

  test('checks that confirm a lesson make it verified, and marking it never downgrades it', () => {
    const p = new Progress(path.join(tmp(), 'progress.json'))
    p.recordChecks(lesson, allPass())
    expect(doneKind(p.exportData().modules[lesson.id])).toBe('verified')
    const before = p.exportData().modules[lesson.id].completedAt
    p.setComplete(lesson.id, true)
    expect(p.exportData().modules[lesson.id]).toMatchObject({ completedAt: before })
    expect(p.exportData().modules[lesson.id].manual).toBeUndefined()
  })

  test('undo works on a verified lesson, keeps checksPassed, and later polls do not re-complete it', () => {
    const f = path.join(tmp(), 'progress.json'); const p = new Progress(f)
    p.recordChecks(lesson, allPass())
    p.setComplete(lesson.id, false)
    p.recordChecks(lesson, allPass()) // the 2s poll with everything still green
    p.recordChecks(lesson, allPass())
    const m = read(f).modules[lesson.id]
    expect(m.completedAt).toBeUndefined()
    expect(m.checksPassed.length).toBe(lesson.checks.length)
  })

  test('a manually completed lesson becomes verified once the checks pass; a later live 0 changes nothing', () => {
    const p = new Progress(path.join(tmp(), 'progress.json'))
    p.setComplete(lesson.id, true)
    p.recordChecks(lesson, nonePass())
    expect(doneKind(p.exportData().modules[lesson.id])).toBe('manual')
    p.setComplete(lesson.id, false)
    p.recordChecks(lesson, allPass())
    expect(doneKind(p.exportData().modules[lesson.id])).toBe('verified')
  })

  test('export and import carry manual, and merge prefers verified over marked-by-you', () => {
    const data: ProgressData = { modules: { [lesson.id]: mod({ completedAt: 9, manual: true }) }, exams: {}, examAttempts: [] }
    const exp = buildExport(data)
    expect(exp.modules[lesson.id].manual).toBe(true)
    const parsed = parseImport(JSON.parse(JSON.stringify(exp)))
    expect(parsed.ok && parsed.data.modules[lesson.id].manual).toBe(true)
    expect(parseImport({ ...exp, modules: { [lesson.id]: { ...exp.modules[lesson.id], manual: 'yes' } } }).ok).toBe(false)
    const verified: ProgressData = { modules: { [lesson.id]: mod({ completedAt: 5 }) }, exams: {}, examAttempts: [] }
    expect(mergeData(data, verified).modules[lesson.id].manual).toBeUndefined()
    expect(mergeData(verified, data).modules[lesson.id].manual).toBeUndefined()
  })

  test('sticky history: checks passed earlier show as earlier when the live check is 0', () => {
    const live = nonePass()
    const h = withHistory(live, [lesson.checks[0].id])
    expect(h[0].earlier).toBe(true)
    expect(h.slice(1).every((c) => !c.earlier)).toBe(true)
    expect(passedCount(h)).toBe(1)
    expect(withHistory(allPass(), [lesson.checks[0].id]).some((c) => c.earlier)).toBe(false)
  })
})

describe('atomic writes and rolling backup', () => {
  test('writes via a temp file in the same folder and leaves no temp files behind', () => {
    const dir = tmp(); const f = path.join(dir, 'progress.json')
    writeFileAtomic(f, '{"a":1}')
    expect(readFileSync(f, 'utf8')).toBe('{"a":1}')
    expect(readdirSync(dir)).toEqual(['progress.json'])
  })

  test('keeps the previous version as .bak before each write', () => {
    const dir = tmp(); const f = path.join(dir, 'progress.json')
    writeFileAtomic(f, '{"v":1}')
    expect(existsSync(backupPath(f))).toBe(false)
    writeFileAtomic(f, '{"v":2}')
    expect(readFileSync(backupPath(f), 'utf8')).toBe('{"v":1}')
    writeFileAtomic(f, '{"v":3}')
    expect(readFileSync(backupPath(f), 'utf8')).toBe('{"v":2}')
    expect(readFileSync(f, 'utf8')).toBe('{"v":3}')
  })

  test('a failed write leaves the old file intact and no temp file', () => {
    const dir = tmp(); const f = path.join(dir, 'progress.json')
    writeFileAtomic(f, '{"v":1}')
    mkdirSync(path.join(dir, 'sub'))
    expect(() => writeFileAtomic(path.join(dir, 'sub'), 'x')).toThrow() // target is a directory
    expect(readFileSync(f, 'utf8')).toBe('{"v":1}')
    expect(readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })

  test('a corrupt file never overwrites a good .bak, and Progress recovers from the .bak', () => {
    const f = path.join(tmp(), 'progress.json')
    const p = new Progress(f)
    p.recordChecks(lesson, allPass()) // write 1
    p.setComplete(lesson.id, false) // write 2: .bak holds write 1
    writeFileSync(f, '{ torn')
    const q = new Progress(f) // restart on a corrupt file
    expect(q.exportData().modules[lesson.id].checksPassed.length).toBe(lesson.checks.length)
    q.tick(lesson.id, 5) // saving must not copy the corrupt file over the good .bak
    expect(JSON.parse(readFileSync(backupPath(f), 'utf8')).modules[lesson.id]).toBeDefined()
    expect(readdirSync(path.dirname(f)).some((n) => n.includes('.corrupt-'))).toBe(true)
  })
})

describe('legacy progress merge', () => {
  const setup = (legacy: ProgressData, current: ProgressData | null, legacyNewer: boolean) => {
    const root = tmp(); const l = path.join(root, 'old'); const d = path.join(root, 'new')
    mkdirSync(l); mkdirSync(d)
    writeFileSync(path.join(l, 'progress.json'), JSON.stringify(legacy))
    if (current) writeFileSync(path.join(d, 'progress.json'), JSON.stringify(current))
    const t = Date.now() / 1000
    utimesSync(path.join(l, 'progress.json'), t + (legacyNewer ? 100 : -100), t + (legacyNewer ? 100 : -100))
    if (current) utimesSync(path.join(d, 'progress.json'), t, t)
    return { l, d }
  }
  const [a, b] = LESSONS.map((x) => x.id)
  const cur: ProgressData = { modules: { [a]: mod({ checksPassed: ['x'], lastSeen: 10 }) }, exams: {}, examAttempts: [] }
  const old: ProgressData = { modules: { [a]: mod({ checksPassed: ['x', 'y'], completedAt: 7 }), [b]: mod({ checksPassed: ['z'] }) }, exams: {}, examAttempts: [] }

  test('merges a newer legacy file with the import rule, and is idempotent', () => {
    const { l, d } = setup(old, cur, true)
    const legacyBefore = readFileSync(path.join(l, 'progress.json'), 'utf8')
    expect(mergeLegacyProgress(d, l)).toBe(true)
    const merged = read(path.join(d, 'progress.json'))
    expect(merged.modules[a]).toMatchObject({ completedAt: 7, checksPassed: ['x', 'y'], lastSeen: 10 })
    expect(merged.modules[b].checksPassed).toEqual(['z'])
    const after = readFileSync(path.join(d, 'progress.json'), 'utf8')
    // run it again, and again with the legacy file touched to look newer: nothing changes
    expect(mergeLegacyProgress(d, l)).toBe(false)
    utimesSync(path.join(l, 'progress.json'), Date.now() / 1000 + 500, Date.now() / 1000 + 500)
    expect(mergeLegacyProgress(d, l)).toBe(false)
    expect(readFileSync(path.join(d, 'progress.json'), 'utf8')).toBe(after)
    expect(readFileSync(path.join(l, 'progress.json'), 'utf8')).toBe(legacyBefore)
  })

  test('ignores a legacy file that is older, keeps the previous version as .bak when it merges', () => {
    const older = setup(old, cur, false)
    expect(mergeLegacyProgress(older.d, older.l)).toBe(false)
    expect(read(path.join(older.d, 'progress.json')).modules[b]).toBeUndefined()
    const newer = setup(old, cur, true)
    mergeLegacyProgress(newer.d, newer.l)
    expect(read(backupPath(path.join(newer.d, 'progress.json'))).modules[b]).toBeUndefined()
  })

  test('survives a garbage legacy file and a missing new file', () => {
    const { l, d } = setup(old, null, true)
    expect(mergeLegacyProgress(d, l)).toBe(true)
    expect(read(path.join(d, 'progress.json')).modules[b]).toBeDefined()
    writeFileSync(path.join(l, 'progress.json'), 'not json')
    utimesSync(path.join(l, 'progress.json'), Date.now() / 1000 + 900, Date.now() / 1000 + 900)
    expect(mergeLegacyProgress(d, l)).toBe(false)
  })
})

describe('server restart mid-lesson', () => {
  test('nothing is lost: checks, manual completion and time survive a new server on the same data dir', () => {
    const dir = tmp()
    const info = () => ({ enabled: false, model: '', source: 'none' as const })
    const first = new Dojo(info, dir)
    first.progress.recordChecks(lesson, results((_, i) => i === 0)) // partway through the lesson
    first.progress.tick(lesson.id, 30)
    first.progress.setComplete(LESSONS[1].id, true)
    const idA = makeServerInfo(TEST_API_PORT, dir).instanceId

    const second = new Dojo(info, dir) // the restart: new process state, same folder
    expect(makeServerInfo(TEST_API_PORT, dir).instanceId).not.toBe(idA)
    second.progress.recordChecks(lesson, nonePass()) // the emulator was reset, so every live check reads 0
    const view = second.progressView()
    expect(view.modules[lesson.id].checksPassed).toEqual([lesson.checks[0].id])
    expect(view.modules[lesson.id].seconds).toBe(30)
    expect(doneKind(view.modules[LESSONS[1].id])).toBe('manual')
    // and the lesson page would show that check as passed earlier
    expect(withHistory(nonePass(), view.modules[lesson.id].checksPassed)[0].earlier).toBe(true)
    // finishing the rest after the restart completes it as verified
    second.progress.recordChecks(lesson, allPass())
    expect(doneKind(second.progressView().modules[lesson.id])).toBe('verified')
  })
})

describe('no hijacking', () => {
  test('tests run on a temp data dir and the reserved ports are not the test ports', () => {
    expect(DATA_DIR.startsWith(tmpdir())).toBe(true)
    expect([TEST_API_PORT, TEST_WEB_PORT]).toEqual([4848, 5274])
    expect(TEST_API_PORT).not.toBe(DEFAULT_API_PORT)
    expect(TEST_WEB_PORT).not.toBe(DEFAULT_WEB_PORT)
  })

  test('a custom data dir is reported by the server info, the default is not echoed', () => {
    const custom = makeServerInfo(TEST_API_PORT, tmp())
    expect(custom.customDataDir).toBe(true); expect(custom.dataDir).toBeDefined()
    const real = makeServerInfo(DEFAULT_API_PORT, DEFAULT_DATA_DIR)
    expect(real.customDataDir).toBe(false); expect(real.dataDir).toBeUndefined()
    expect(custom.instanceId).not.toBe(makeServerInfo(TEST_API_PORT, tmp()).instanceId)
  })

  test('a server with a custom data dir refuses the learner port', () => {
    expect(portConflict(DEFAULT_API_PORT, tmp())).toMatch(/reserved/)
    expect(portConflict(TEST_API_PORT, tmp())).toBeNull()
    expect(portConflict(DEFAULT_API_PORT, DEFAULT_DATA_DIR)).toBeNull()
  })

  test('scripts and configs never hardcode 4747/5173 (they import shared/ports)', () => {
    const root = path.resolve(import.meta.dirname, '..')
    const files = [...readdirSync(path.join(root, 'scripts')).map((n) => `scripts/${n}`), 'vite.config.ts', 'server/info.ts', 'server/index.ts']
    const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1').replace(/http:\/\/localhost:5173/g, '')
    const offenders = files.filter((f) => statSync(path.join(root, f)).isFile() && /\b(4747|5173)\b/.test(code(readFileSync(path.join(root, f), 'utf8'))))
    expect(offenders).toEqual([])
  })
})
