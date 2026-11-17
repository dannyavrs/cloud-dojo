import { describe, expect, test } from 'bun:test'
import { lessonById } from '../shared/lessons'
import type { RunRecord } from '../shared/types'
import { MockLanguageModelV4 } from 'ai/test'
import { textModel } from './llm-helpers'
import { handleTutor, sanitizeMessages, type TutorDeps } from '../server/tutor'
import { buildContext, summarizeHistory, summarizeMap } from '../server/tutor-context'

const KEY = 'sk-test-SENTINEL-1234'
const state = async () => ({ checks: [], history: [] as RunRecord[], map: undefined })
const post = (body: unknown, headers: Record<string, string> = { 'x-llm-provider': 'anthropic', 'x-llm-key': KEY }) => new Request('http://x/api/tutor', { method: 'POST', headers, body: JSON.stringify(body) })
const rec = (i: number, size = 10): RunRecord => ({ command: `aws s3 ls #${i}`, exitCode: 0, stdout: 'x'.repeat(size), stderr: '', ms: 1, at: i })
const ask = { lessonId: 'lift-off', messages: [{ role: 'user', content: 'explain' }] }

const deps = (over: Partial<TutorDeps> = {}): TutorDeps => ({ env: () => ({}), getState: state, modelFactory: () => textModel(['Hello', ' world']), ...over })

describe('tutor route', () => {
  test('rejects without any key, with a helpful message', async () => {
    const res = await handleTutor(post(ask, {}), deps())
    expect(res.status).toBe(503)
    const b = (await res.json()) as { error: string; message: string }
    expect(b.error).toBe('no_key')
    expect(b.message).toContain('Settings')
    expect(b.message).toContain('LLM_API_KEY')
  })
  test('validates lesson and messages', async () => {
    expect((await handleTutor(post({ lessonId: 'nope', messages: [{ role: 'user', content: 'hi' }] }), deps())).status).toBe(404)
    expect((await handleTutor(post({ lessonId: 'lift-off', messages: [] }), deps())).status).toBe(400)
  })
  test('streams text and usage, with lesson context in the system prompt', async () => {
    const seen: { system?: string } = {}
    const res = await handleTutor(post(ask), deps({ modelFactory: () => textModel(['Hello', ' world'], seen) }))
    const text = await res.text()
    expect(text).toContain('"Hello"')
    expect(text).toContain('"usage"')
    expect(seen.system).toContain('CURRENT MODULE 0.1')
    expect(seen.system).not.toContain(KEY)
  })
  test('upstream errors are reported as a fixed message without leaking details or the key', async () => {
    const boom = new MockLanguageModelV4({ doStream: async () => { throw Object.assign(new Error(`bad key ${KEY}`), { statusCode: 401 }) } })
    const text = await (await handleTutor(post(ask), deps({ modelFactory: () => boom }))).text()
    expect(text).toContain('"error"')
    expect(text).toContain('rejected the API key')
    expect(text).not.toContain(KEY)
  })
})

describe('context builder', () => {
  test('keeps only the last 10 commands and truncates long output', () => {
    const h = Array.from({ length: 30 }, (_, i) => rec(i, 50_000))
    const s = summarizeHistory(h)
    expect(s).toContain('#29')
    expect(s).toContain('#20')
    expect(s).not.toContain('#19')
    expect(s).toContain('truncated')
    expect(s.length).toBeLessThan(10 * 2000)
  })
  test('whole context is bounded and carries lesson, checks and map', () => {
    const lesson = lessonById('dynamodb-notes')!
    const map = { nodes: Array.from({ length: 200 }, (_, i) => ({ id: `n${i}`, kind: 'queue' as const, label: `q${i}` })), edges: [], at: 0 }
    const ctx = buildContext({ lesson, checks: [{ id: 'a', label: 'Table is ACTIVE', pass: false }, { id: 'b', label: 'Probe', pass: null }], history: Array.from({ length: 30 }, (_, i) => rec(i, 100_000)), map })
    expect(ctx).toContain('DynamoDB')
    expect(ctx).toContain('[FAIL] Table is ACTIVE')
    expect(ctx).toContain('[not run] Probe')
    expect(ctx.length).toBeLessThanOrEqual(24_100)
    expect(summarizeMap(map).length).toBeLessThanOrEqual(3100)
  })
  test('sanitizeMessages trims to a valid conversation', () => {
    expect(sanitizeMessages([{ role: 'assistant', content: 'a' }, { role: 'user', content: 'u' }])).toEqual([{ role: 'user', content: 'u' }])
    expect(sanitizeMessages([{ role: 'user', content: 'u' }, { role: 'assistant', content: 'a' }])).toBeNull()
    expect(sanitizeMessages('x')).toBeNull()
    expect(sanitizeMessages([{ role: 'user', content: 'x'.repeat(9000) }])![0].content.length).toBe(4000)
  })
})
