import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { LESSONS, lessonById, modulesOf } from '../shared/lessons'
import { TRACKS } from '../shared/tracks'
import type { QuizQuestion } from '../shared/types'
import { SERVER_LESSONS } from '../server/lessons'
import { writeModuleFile } from '../server/files'
import { gradeExam, gradePredict } from '../server/quiz'
import { Progress } from '../server/progress'
import { parseHeaderLines, sanitizeProbe } from '../server/probe'
import { loadCapabilities } from '../server/capabilities'
import { makeZip } from '../server/zip'

const M1 = ['ddb-single-table', 'ddb-indexes', 'ddb-conditional', 'ddb-transactions', 'ddb-streams-ttl', 'ddb-query-scan', 'sqs-visibility', 'sqs-dlq-redrive', 'sqs-fifo', 'sns-filter-fanout', 'sqs-lambda-batch']
const M2 = ['cli-fluency', 'iam-evaluation', 'iam-conditions', 'iam-roles-sts', 'iam-resource-policies', 'iam-boundaries', 'iam-abac', 's3-presigned', 's3-multipart', 's3-notifications', 's3-lifecycle', 's3-data-protection', 's3-replication-conditional', 'lambda-config-errors', 'lambda-versions-aliases', 'lambda-layers', 'lambda-concurrency', 'lambda-function-url', 'lambda-async-destinations']
const M3 = ['apigw-routes-stages', 'apigw-lambda-authorizer', 'apigw-jwt-cognito', 'apigw-throttle-cors', 'apigw-rest-keys-usage', 'sfn-retry', 'sfn-catch-fail', 'sfn-map-choice-ddb', 'sfn-wait-for-token', 'sfn-express-jsonata', 'eb-patterns', 'eb-targets-sfn', 'eb-scheduler', 'eb-archive-replay', 'cw-metrics', 'cw-alarms-sns', 'cw-logs-insights', 'cw-dashboards', 'kms-envelope', 'kms-policies-grants', 'secrets-rotation', 'ssm-parameter-store']
const questions = (): { where: string; q: QuizQuestion }[] => [
  ...LESSONS.flatMap((l) => l.predict.map((q) => ({ where: `${l.id}/${q.id}`, q }))),
  ...TRACKS.flatMap((t) => (t.exam ?? []).map((q) => ({ where: `${t.id}/${q.id}`, q }))),
]

describe('tracks and modules', () => {
  test('every module belongs to a track, ids are unique, numbers read track.module', () => {
    const ids = LESSONS.map((l) => l.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const l of LESSONS) {
      const t = TRACKS.find((x) => x.id === l.trackId)
      expect(t, l.id).toBeDefined()
      if (l.n !== '★') expect(l.n.startsWith(`${t!.n}.`), `${l.id} ${l.n}`).toBe(true)
      for (const p of l.prereqs) expect(lessonById(p), `${l.id} prereq ${p}`).toBeDefined()
      expect(l.estMinutes).toBeGreaterThan(0)
    }
  })
  test('the deep tracks hold the planned modules in order', () => {
    expect(modulesOf('dynamodb').map((l) => l.n)).toEqual(['3.1', '3.2', '3.3', '3.4', '3.5', '3.6', '3.7'])
    expect(modulesOf('messaging').map((l) => l.n)).toEqual(['5.1', '5.2', '5.3', '5.4', '5.5', '5.6'])
    expect(modulesOf('foundations').map((l) => l.n)).toEqual(['0.1', '0.2'])
    expect(modulesOf('iam').map((l) => l.n)).toEqual(['1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7'])
    expect(modulesOf('s3').map((l) => l.n)).toEqual(['2.1', '2.2', '2.3', '2.4', '2.5', '2.6', '2.7'])
    expect(modulesOf('lambda').map((l) => l.n)).toEqual(['4.1', '4.2', '4.3', '4.4', '4.5', '4.6', '4.7'])
  })
  test('every module has a server checker whose ids match the content, a break-it and honest metadata', () => {
    for (const l of LESSONS) {
      expect(SERVER_LESSONS.find((s) => s.id === l.id), l.id).toBeDefined()
      expect(l.checks.length).toBeGreaterThan(0)
      expect(['live', 'simulated', 'concept']).toContain(l.honesty)
      if (l.breakItCheck) expect(l.checks.map((c) => c.id), l.id).toContain(l.breakItCheck)
      expect(l.steps.some((s) => s.breakIt) || l.honesty === 'concept' || l.id === 'lambda-roles' || l.id === 'capstone' || l.id === 'sns-sqs' || l.id === 's3-sqs-lambda' || l.id === 'http-api', l.id).toBe(true)
      for (const f of l.editable ?? []) expect(l.files, l.id).toContain(f)
    }
  })
  test('M1 and M2 modules are intermediate or advanced, with predict questions, exam tags and real depth', () => {
    for (const id of [...M1, ...M2, ...M3]) {
      const l = lessonById(id)!
      expect(l.level, id).not.toBe('core')
      expect(l.predict.length, id).toBeGreaterThanOrEqual(1)
      expect(l.predict.length, id).toBeLessThanOrEqual(3)
      expect(l.examTags.length, id).toBeGreaterThan(0)
      expect(l.concept.join(' ').length, id).toBeGreaterThan(1400)
      expect(l.steps.filter((s) => s.commands?.length || s.code).length, id).toBeGreaterThanOrEqual(l.honesty === 'concept' ? 3 : 4)
      expect(l.realAws.cost.length, id).toBeGreaterThan(0)
      expect(l.realAws.differences.length, id).toBeGreaterThan(0)
    }
  })
  test('every command shown to the learner is an aws command or a clear placeholder', () => {
    for (const l of LESSONS) for (const s of l.steps) for (const c of s.commands ?? []) expect(/^(\w+=\S+ )*aws /.test(c), `${l.id}/${s.id}: ${c.slice(0, 40)}`).toBe(true)
  })
})

describe('quizzes', () => {
  test('answer keys are in range, options are distinct, explanations exist', () => {
    for (const { where, q } of questions()) {
      expect(q.options.length, where).toBeGreaterThanOrEqual(2)
      expect(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length, where).toBe(true)
      expect(new Set(q.options).size, where).toBe(q.options.length)
      expect(q.explain.length, where).toBeGreaterThan(20)
    }
  })
  test('question ids are unique within a module or track', () => {
    for (const l of LESSONS) expect(new Set(l.predict.map((q) => q.id)).size).toBe(l.predict.length)
    for (const t of TRACKS) expect(new Set((t.exam ?? []).map((q) => q.id)).size).toBe((t.exam ?? []).length)
  })
  test('M2 honesty badges match the plan, and simulated or concept modules name the capability they wait for', () => {
    const h = (id: string) => lessonById(id)!
    expect(h('iam-boundaries').honesty).toBe('simulated')
    expect(h('s3-lifecycle').honesty).toBe('simulated')
    expect(h('iam-abac').honesty).toBe('concept')
    expect(h('lambda-async-destinations').honesty).toBe('concept')
    for (const id of M2) { const l = h(id); if (l.honesty !== 'live') { expect(l.requires?.length, id).toBeGreaterThan(0); expect(l.honestyNote?.length ?? 0, id).toBeGreaterThan(20) } }
    for (const id of ['iam-evaluation', 'iam-conditions', 'iam-roles-sts', 'iam-resource-policies', 's3-presigned', 's3-multipart', 's3-notifications', 's3-data-protection', 's3-replication-conditional', 'lambda-config-errors', 'lambda-versions-aliases', 'lambda-layers', 'lambda-concurrency', 'lambda-function-url']) expect(h(id).honesty, id).toBe('live')
  })
  test('every capability key a module requires has a real probe', async () => {
    const { PROBES } = await import('../server/capabilities')
    const keys = new Set(PROBES.map((p) => p.key))
    for (const l of LESSONS) for (const k of l.requires ?? []) expect(keys.has(k), `${l.id} requires ${k}`).toBe(true)
  })
  test('the right answers are not all in the same slot', () => {
    for (const t of TRACKS.filter((x) => x.exam)) expect(new Set(t.exam!.map((q) => q.answer)).size, t.id).toBeGreaterThan(1)
  })
  test('the deep tracks end with 6-10 tagged exam questions', () => {
    for (const id of ['dynamodb', 'messaging', 'iam', 's3', 'lambda']) {
      const t = TRACKS.find((x) => x.id === id)!
      expect(t.exam!.length).toBeGreaterThanOrEqual(6)
      expect(t.exam!.length).toBeLessThanOrEqual(10)
      for (const q of t.exam!) expect(q.tag, `${id}/${q.id}`).toMatch(/^(SAA:(Secure|Resilient|Performant|Cost)|DVA:(Dev|Sec|Deploy|Troubleshoot))$/)
    }
  })
  test('grading is deterministic: right is right, wrong is wrong, junk counts as wrong', () => {
    const l = lessonById('ddb-conditional')!
    const q = l.predict[0]
    expect(gradePredict(l, q.id, q.answer)?.correct).toBe(true)
    expect(gradePredict(l, q.id, (q.answer + 1) % q.options.length)?.correct).toBe(false)
    expect(gradePredict(l, 'nope', 0)).toBeNull()
    expect(gradePredict(l, q.id, '1')).toBeNull()
    const t = TRACKS.find((x) => x.id === 'dynamodb')!
    const all = gradeExam(t, Object.fromEntries(t.exam!.map((e) => [e.id, e.answer])))!
    expect(all.score).toBe(all.total)
    expect(Object.values(all.byDomain).reduce((n, d) => n + d.total, 0)).toBe(all.total)
    expect(gradeExam(t, { e1: 'x', e2: null })!.score).toBe(0)
    expect(gradeExam(TRACKS.find((x) => x.id === 'foundations')!, {})).toBeNull()
  })
})

describe('progress file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aa-prog-'))
  const file = path.join(dir, 'progress.json')
  const l = lessonById('ddb-conditional')!
  const pass = (ids: string[]) => l.checks.map((c) => ({ id: c.id, label: c.label, pass: ids.includes(c.id) }))
  test('records checks, break-it, quiz and time; completion sticks; survives a reload', () => {
    const p = new Progress(file)
    p.recordChecks(l, pass(['seed', 'a']))
    expect(p.view(LESSONS, TRACKS).modules[l.id].completedAt).toBeUndefined()
    p.recordChecks(l, pass(['breakit']))
    expect(p.view(LESSONS, TRACKS).modules[l.id].breakIt).toBe(true)
    p.recordChecks(l, pass(['retry', 'counter']))
    p.recordPredict(l.id, 'p1', true)
    p.recordPredict(l.id, 'p1', false) // a later wrong answer does not erase the first correct one
    p.tick(l.id, 30); p.tick(l.id, 999)
    const again = new Progress(file).view(LESSONS, TRACKS)
    expect(again.modules[l.id].completedAt).toBeGreaterThan(0)
    expect(again.modules[l.id].checksPassed.sort()).toEqual(l.checks.map((c) => c.id).sort())
    expect(again.modules[l.id].predict.p1).toBe(true)
    expect(again.modules[l.id].seconds).toBe(90) // 30 + capped 60
    expect(again.tracks.find((t) => t.id === 'dynamodb')).toMatchObject({ done: 1, total: 7 })
  })
  test('exam answers feed per-domain readiness', () => {
    const p = new Progress(path.join(dir, 'p2.json'))
    const t = TRACKS.find((x) => x.id === 'dynamodb')!
    const none = p.view(LESSONS, TRACKS).readiness.find((r) => r.domain === 'DVA:Dev')!
    expect(none.percent).toBe(0)
    p.recordExam('dynamodb', Object.fromEntries(t.exam!.map((q) => [q.id, true])))
    const dev = p.view(LESSONS, TRACKS).readiness.find((r) => r.domain === 'DVA:Dev')!
    expect(dev.examCorrect).toBe(t.exam!.filter((q) => q.tag === 'DVA:Dev').length) // only the DynamoDB exam was answered
    expect(dev.examTotal).toBeGreaterThan(dev.examCorrect) // the messaging exam still counts toward the domain
    expect(dev.percent).toBeGreaterThan(0)
    expect(dev.percent).toBeLessThanOrEqual(100)
  })
  test('a corrupt file starts clean instead of crashing', () => {
    const bad = path.join(dir, 'bad.json')
    writeFileSync(bad, '{nope')
    expect(new Progress(bad).view(LESSONS, TRACKS).tracks.every((t) => t.done === 0)).toBe(true)
  })
})

describe('starter-file editor', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aa-edit-'))
  const lesson = SERVER_LESSONS.find((s) => s.id === 'sqs-lambda-batch')
  test('writes plain text files inside the folder only', () => {
    expect(writeModuleFile(dir, lesson, 'notes.txt', 'hi')).toMatchObject({ ok: true })
    expect(readFileSync(path.join(dir, 'notes.txt'), 'utf8')).toBe('hi')
    for (const bad of ['../x.json', '..', 'a/b.json', '/etc/passwd', '.env', '.hidden.json', 'x.sh', 'x', 'a\\b.json', '']) expect(writeModuleFile(dir, lesson, bad, 'x'), bad).toMatchObject({ ok: false })
    expect(existsSync(path.join(dir, '..', 'x.json'))).toBe(false)
    expect(writeModuleFile(dir, lesson, 'big.txt', 'x'.repeat(30000))).toMatchObject({ ok: false })
    expect(writeModuleFile(dir, lesson, 'handler.zip', 'x')).toMatchObject({ ok: false })
  })
  test('editing a handler rebuilds the zip that contains it', () => {
    const r = writeModuleFile(dir, lesson, 'handler.mjs', 'export const handler = async () => ({ batchItemFailures: [] })')
    expect(r).toEqual({ ok: true, rebuilt: ['handler.zip'] })
    const zip = readFileSync(path.join(dir, 'handler.zip'))
    expect(zip.includes(Buffer.from('batchItemFailures'))).toBe(true)
    expect(zip.length).toBeGreaterThan(makeZip({ 'handler.mjs': '' }).length)
    expect(readdirSync(dir).sort()).toContain('handler.zip')
  })
  test('unrelated edits rebuild nothing', () => {
    expect(writeModuleFile(dir, lesson, 'other.json', '{}')).toEqual({ ok: true, rebuilt: [] })
  })
})

describe('generalised HTTP probe', () => {
  test('accepts method, headers and body; fills a content type for bodies', () => {
    const r = sanitizeProbe({ url: 'https://127.0.0.1:9297/x', method: 'put', headers: { Authorization: 'Bearer abc', 'x-api-key': 'k' }, body: '{"a":1}' })
    expect(r).toMatchObject({ ok: true, method: 'PUT', body: '{"a":1}' })
    if (r.ok) expect(r.headers).toMatchObject({ Authorization: 'Bearer abc', 'content-type': 'application/json' })
  })
  test('refuses what could escape or break the request', () => {
    const bad = (i: object) => expect(sanitizeProbe({ url: 'https://127.0.0.1:9297/x', ...i }).ok).toBe(false)
    bad({ method: 'TRACE' }); bad({ method: 'GET', body: 'x' }); bad({ headers: { Host: 'evil.com' } }); bad({ headers: { Cookie: 'a=b' } })
    bad({ headers: { 'x-a': 'line\r\nbreak: 1' } }); bad({ headers: { 'bad name': 'v' } }); bad({ headers: ['a'] }); bad({ body: 'x'.repeat(30000), method: 'POST' })
    expect(sanitizeProbe({ url: 'file:///etc/passwd' }).ok).toBe(false)
    expect(sanitizeProbe({ url: 'nope' }).ok).toBe(false)
    expect(sanitizeProbe({}).ok).toBe(false)
  })
  test('header lines parse', () => {
    expect(parseHeaderLines('Authorization: Bearer x:y\n\nbad line\nX-Api-Key:  k ')).toEqual({ Authorization: 'Bearer x:y', 'X-Api-Key': 'k' })
  })
})

describe('capability report', () => {
  test('is only reused for the same image', () => {
    const f = path.join(mkdtempSync(path.join(tmpdir(), 'aa-cap-')), 'c.json')
    expect(loadCapabilities('img:1', f)).toBeNull()
    writeFileSync(f, JSON.stringify({ image: 'img:1', at: 1, capabilities: [] }))
    expect(loadCapabilities('img:1', f)?.image).toBe('img:1')
    expect(loadCapabilities('img:2', f)).toBeNull()
  })
})
