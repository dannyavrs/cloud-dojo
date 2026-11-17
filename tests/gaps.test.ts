import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { DISCLAIMER, TAGLINE } from '../shared/disclaimer'
import { GAPS, gapsMarkdown } from '../shared/gaps'
import { lessonById } from '../shared/lessons'
import { PROBES } from '../server/capabilities'

const root = path.resolve(import.meta.dirname, '..')
const read = (f: string) => readFileSync(path.join(root, f), 'utf8')

describe('emulator gaps table', () => {
  test('every capability probe is covered by a row, and rows name only real probes', () => {
    const keys = new Set(PROBES.map((p) => p.key))
    const named = new Set(GAPS.flatMap((r) => r.probes))
    for (const k of keys) expect(named.has(k), `probe ${k} is in no row`).toBe(true)
    for (const k of named) expect(keys.has(k), `row names unknown probe ${k}`).toBe(true)
  })

  test('badges match what each lesson declares, and the lessons exist', () => {
    for (const r of GAPS) for (const l of r.lessons) {
      const lesson = lessonById(l.id)
      expect(lesson, `unknown lesson ${l.id}`).toBeDefined()
      expect(lesson!.honesty, `${l.id} badge`).toBe(l.badge)
    }
  })

  test('every Simulated or Concept lesson appears in the table', () => {
    const listed = new Set(GAPS.flatMap((r) => r.lessons.map((l) => l.id)))
    for (const id of ['iam-boundaries', 'iam-abac', 's3-lifecycle', 'lambda-async-destinations', 'cw-logs-insights']) expect(listed.has(id)).toBe(true)
  })

  test('README and docs/EMULATOR-GAPS.md carry the generated table (run `bun scripts/gen-gaps.ts` to update)', () => {
    const table = gapsMarkdown()
    expect(read('README.md')).toContain(table)
    expect(read('docs/EMULATOR-GAPS.md')).toContain(table)
    expect(table.split('\n')[0]).toBe("| Service | What works live | What's simulated or missing | How the lesson handles it |")
  })
})

describe('trademark text', () => {
  test('the disclaimer is word for word in the README, the gaps doc and the tagline is in the README', () => {
    expect(DISCLAIMER).toBe('Cloud Dojo is an independent open-source project. It is not affiliated with, endorsed by, or sponsored by Amazon Web Services, Inc. or its affiliates. Amazon Web Services, AWS, and the names of AWS services are trademarks of Amazon.com, Inc. or its affiliates.')
    expect(read('README.md')).toContain(DISCLAIMER)
    expect(read('docs/EMULATOR-GAPS.md')).toContain(DISCLAIMER)
    expect(read('README.md')).toContain(TAGLINE)
    expect(read('README.md').indexOf(DISCLAIMER)).toBeLessThan(1500) // near the top
  })

  test('"AWS Academy" survives only in the changelog / migration notes and the backward-compat code', () => {
    const allowed = new Set(['CHANGELOG.md', 'README.md', '.gitleaks.toml', 'docs/OPEN-SOURCE-NOTES.md', 'server/paths.ts', 'server/data-migration.ts', 'server/progress-io.ts', 'src/lib/legacy.ts', 'tests/progress-io.test.ts', 'tests/data-isolation.test.ts', 'tests/gaps.test.ts'])
    const hits = Bun.spawnSync(['git', 'grep', '--untracked', '-il', 'aws.academy', '--', '.', ':!bun.lock'], { cwd: root }).stdout.toString().split('\n').filter(Boolean)
    for (const f of hits) expect(allowed.has(f), `${f} still says AWS Academy`).toBe(true)
  })
})
