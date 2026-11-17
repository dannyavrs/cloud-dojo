import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { Dojo } from '../server/app'
import { migrateLegacyData } from '../server/data-migration'
import { DATA_DIR, DEFAULT_DATA_DIR, LEGACY_DATA_DIR } from '../server/paths'
import { migrateLegacyLocalStorage } from '../src/lib/legacy'

/** mtime + size of every file under a dir, to prove nothing changed. */
const fingerprint = (dir: string): string[] =>
  !existsSync(dir) ? ['<absent>'] : readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => {
    const p = path.join(e.parentPath, e.name); const s = statSync(p); return `${p}:${s.size}:${s.mtimeMs}`
  }).sort()

describe('test isolation', () => {
  test('tests use a temp data dir, never the home data dirs', () => {
    expect(DATA_DIR.startsWith(path.join(tmpdir()))).toBe(true)
    expect(DATA_DIR).not.toBe(DEFAULT_DATA_DIR)
    expect(DATA_DIR).not.toBe(LEGACY_DATA_DIR)
    expect(DATA_DIR.startsWith(homedir() + path.sep) && !DATA_DIR.startsWith(tmpdir())).toBe(false)
  })

  test('creating the app and recording progress leaves the home data dirs untouched', () => {
    const before = [fingerprint(DEFAULT_DATA_DIR), fingerprint(LEGACY_DATA_DIR)]
    const app = new Dojo(() => ({ enabled: false, model: '', source: 'none' }))
    app.progress.tick('lift-off', 30)
    expect(existsSync(path.join(DATA_DIR, 'progress.json'))).toBe(true)
    expect([fingerprint(DEFAULT_DATA_DIR), fingerprint(LEGACY_DATA_DIR)]).toEqual(before)
  })
})

describe('legacy data migration', () => {
  const tmp = () => mkdtempSync(path.join(tmpdir(), 'dojo-mig-'))

  test('copies progress and capabilities, never moves or alters the old folder', () => {
    const root = tmp(); const legacy = path.join(root, 'old'); const dest = path.join(root, 'new')
    mkdirSync(legacy); writeFileSync(path.join(legacy, 'progress.json'), '{"x":1}'); writeFileSync(path.join(legacy, 'capabilities.json'), '{}'); writeFileSync(path.join(legacy, 'other.txt'), 'keep')
    expect(migrateLegacyData(dest, legacy).sort()).toEqual(['capabilities.json', 'progress.json'])
    expect(readFileSync(path.join(dest, 'progress.json'), 'utf8')).toBe('{"x":1}')
    expect(readdirSync(dest).sort()).toEqual(['capabilities.json', 'progress.json'])
    expect(readFileSync(path.join(legacy, 'progress.json'), 'utf8')).toBe('{"x":1}')
    expect(existsSync(path.join(legacy, 'other.txt'))).toBe(true)
    rmSync(root, { recursive: true, force: true })
  })

  test('does nothing when the new folder already exists or the old one is missing', () => {
    const root = tmp(); const legacy = path.join(root, 'old'); const dest = path.join(root, 'new')
    mkdirSync(legacy); writeFileSync(path.join(legacy, 'progress.json'), 'old'); mkdirSync(dest)
    expect(migrateLegacyData(dest, legacy)).toEqual([])
    expect(existsSync(path.join(dest, 'progress.json'))).toBe(false)
    expect(migrateLegacyData(path.join(root, 'fresh'), path.join(root, 'nope'))).toEqual([])
    expect(existsSync(path.join(root, 'fresh'))).toBe(false)
    rmSync(root, { recursive: true, force: true })
  })

  test('browser settings under the old key prefix are copied once, never overwritten', () => {
    const m = new Map<string, string>([['aws-academy:theme', '"light"'], ['aws-academy:llm', 'old'], ['cloud-dojo:llm', 'new']])
    const store = { get length() { return m.size }, key: (i: number) => [...m.keys()][i] ?? null, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } }
    expect(migrateLegacyLocalStorage(store)).toBe(1)
    expect(m.get('cloud-dojo:theme')).toBe('"light"')
    expect(m.get('cloud-dojo:llm')).toBe('new')
    expect(m.get('aws-academy:theme')).toBe('"light"')
  })
})
