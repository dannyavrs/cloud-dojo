import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { MockLanguageModelV4 } from 'ai/test'
import { PROVIDERS } from '../shared/llm'
import { Dojo } from '../server/app'
import { createModel, parseBaseUrl, resolveFromEnv, resolveLlm, scrub, tutorStatus } from '../server/llm'
import { handleTutor, handleTutorTest, type TutorDeps } from '../server/tutor'
import { buildContext } from '../server/tutor-context'
import { lessonById } from '../shared/lessons'
import { textModel } from './llm-helpers'

const KEY = 'sk-test-SENTINEL-1234'
const state = async () => ({ checks: [], history: [], map: undefined })
const H = (h: Record<string, string>) => new Headers(h)
const req = (headers: Record<string, string>, body: unknown = { lessonId: 'lift-off', messages: [{ role: 'user', content: 'hi' }] }) => new Request('http://x/api/tutor', { method: 'POST', headers, body: JSON.stringify(body) })
const browser = (provider: string, extra: Record<string, string> = {}) => ({ 'x-llm-provider': provider, 'x-llm-key': KEY, 'x-llm-model': 'm-1', ...extra })

describe('provider streaming (mock model per provider)', () => {
  for (const p of PROVIDERS) {
    test(`${p.id}: text deltas reach the NDJSON output`, async () => {
      let seen: { provider: string; model: string; hasKey: boolean; baseUrl?: string } | undefined
      const deps: TutorDeps = { env: () => ({}), getState: state, modelFactory: (c) => { seen = { provider: c.provider, model: c.model, hasKey: c.apiKey === KEY, baseUrl: c.baseUrl }; return textModel([`from-${p.id}`, ' ok']) } }
      const headers = browser(p.id, p.id === 'custom' ? { 'x-llm-base-url': 'http://localhost:11434/v1' } : {})
      const text = await (await handleTutor(req(headers), deps)).text()
      const events = text.trim().split('\n').map((l) => JSON.parse(l) as { type: string; delta?: string })
      expect(events.filter((e) => e.type === 'text').map((e) => e.delta).join('')).toBe(`from-${p.id} ok`)
      expect(events.some((e) => e.type === 'usage')).toBe(true)
      expect(seen).toMatchObject({ provider: p.id, model: 'm-1', hasKey: true })
      if (p.id === 'openrouter') expect(seen?.baseUrl).toBe('https://openrouter.ai/api/v1')
      if (p.id === 'custom') expect(seen?.baseUrl).toBe('http://localhost:11434/v1')
    })
  }
  test('createModel builds a real model object for every provider', () => {
    for (const p of PROVIDERS) {
      const m = createModel({ provider: p.id, model: 'x', apiKey: KEY, baseUrl: 'http://localhost:1/v1' }) as { provider: string; modelId: string }
      expect(m.modelId).toBe('x')
      expect(typeof m.provider).toBe('string')
    }
  })
})

describe('resolution', () => {
  test('browser header beats env', () => {
    const r = resolveLlm(H(browser('openai')), { LLM_PROVIDER: 'google', LLM_API_KEY: 'env-key', LLM_MODEL: 'env-model' })
    expect(r).toMatchObject({ ok: true, source: 'browser', config: { provider: 'openai', model: 'm-1', apiKey: KEY } })
  })
  test('env fallback with LLM_* variables', () => {
    expect(resolveLlm(H({}), { LLM_PROVIDER: 'google', LLM_API_KEY: 'k', LLM_MODEL: 'gemini-x' })).toMatchObject({ ok: true, source: 'env', config: { provider: 'google', model: 'gemini-x', apiKey: 'k' } })
  })
  test('legacy ANTHROPIC_API_KEY and ANTHROPIC_MODEL still work', () => {
    expect(resolveFromEnv({ ANTHROPIC_API_KEY: 'sk-ant-x', ANTHROPIC_MODEL: 'claude-sonnet-5-5' })).toMatchObject({ ok: true, config: { provider: 'anthropic', model: 'claude-sonnet-5-5', apiKey: 'sk-ant-x' } })
    expect(resolveFromEnv({ ANTHROPIC_API_KEY: 'sk-ant-x' })).toMatchObject({ ok: true, config: { model: 'claude-opus-5-5' } })
    expect(resolveFromEnv({ ANTHROPIC_API_KEY: 'sk-ant-your-key-here' }).ok).toBe(false)
  })
  test('nothing configured is disabled with a helpful message', async () => {
    const r = resolveLlm(H({}), {})
    expect(r.ok).toBe(false)
    expect(tutorStatus(H({}), {})).toEqual({ enabled: false, model: '', source: 'none' })
    const res = await handleTutor(req({}), { env: () => ({}), getState: state })
    expect(res.status).toBe(503)
    expect(JSON.stringify(await res.json())).toContain('.env.local')
  })
  test('status reports provider, model and source, never a key', () => {
    const b = tutorStatus(H({ 'x-llm-provider': 'openai', 'x-llm-key-present': '1', 'x-llm-model': 'gpt-x' }), {})
    expect(b).toEqual({ enabled: true, provider: 'openai', model: 'gpt-x', source: 'browser' })
    const e = tutorStatus(H({}), { LLM_PROVIDER: 'openrouter', LLM_API_KEY: KEY })
    expect(e).toMatchObject({ enabled: true, provider: 'openrouter', source: 'env' })
    expect(JSON.stringify([b, e])).not.toContain(KEY)
  })
  test('invalid provider and base URL are rejected', async () => {
    expect(resolveLlm(H(browser('skynet')), {})).toMatchObject({ ok: false, code: 'bad_provider', status: 400 })
    expect(resolveLlm(H(browser('custom', { 'x-llm-base-url': 'file:///etc/passwd' })), {})).toMatchObject({ ok: false, code: 'bad_base_url' })
    expect(resolveLlm(H({ 'x-llm-provider': 'custom' }), {})).toMatchObject({ ok: false, code: 'bad_base_url' })
    expect(resolveLlm(H({ 'x-llm-provider': 'openai' }), {}).ok).toBe(false) // no key, no env
    expect(resolveLlm(H({ 'x-llm-provider': 'custom', 'x-llm-base-url': 'http://127.0.0.1:1234/v1/' }), {})).toMatchObject({ ok: true, config: { baseUrl: 'http://127.0.0.1:1234/v1', apiKey: undefined } })
    expect(parseBaseUrl('ftp://x')).toBeNull()
  })
})

describe('key never leaks', () => {
  const logs: string[] = []
  const spies: { mockRestore: () => void }[] = []
  beforeAll(() => {
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) spies.push(spyOn(console, m).mockImplementation((...a: unknown[]) => { logs.push(a.map((x) => (x instanceof Error ? `${x.message}\n${x.stack}` : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')) }))
  })
  afterAll(() => { for (const s of spies) s.mockRestore() })

  const dump = async (res: Response) => (await res.text()) + JSON.stringify([...res.headers])
  const leaky = (code: number) => new MockLanguageModelV4({ doStream: async () => { throw Object.assign(new Error(`HTTP ${code} for key ${KEY}`), { statusCode: code, requestBodyValues: { headers: { authorization: `Bearer ${KEY}` } }, url: `https://x/?key=${KEY}` }) } })

  test('success, upstream error and invalid provider responses never contain the key', async () => {
    const ok = await dump(await handleTutor(req(browser('anthropic')), { env: () => ({}), getState: state, modelFactory: () => textModel(['fine']) }))
    const bodies = [ok]
    for (const code of [401, 429, 404, 500, 400]) bodies.push(await dump(await handleTutor(req(browser('openai')), { env: () => ({}), getState: state, modelFactory: () => leaky(code) })))
    bodies.push(await dump(await handleTutor(req({ ...browser('skynet') }), { env: () => ({}), getState: state })))
    bodies.push(await dump(await handleTutor(req(browser('custom', { 'x-llm-base-url': 'javascript:alert(1)' })), { env: () => ({}), getState: state })))
    bodies.push(await dump(await handleTutor(req(browser('openai'), '{bad json'), { env: () => ({}), getState: state, modelFactory: () => textModel(['x']) })))
    for (const b of bodies) expect(b).not.toContain(KEY)
    expect(bodies[0]).toContain('fine')
  })

  test('mid-stream error parts do not leak either', async () => {
    const m = new MockLanguageModelV4({ doStream: async () => ({ stream: new ReadableStream({ start(c) { c.enqueue({ type: 'stream-start', warnings: [] }); c.enqueue({ type: 'error', error: Object.assign(new Error(KEY), { statusCode: 401 }) }); c.close() } }) }) })
    const out = await dump(await handleTutor(req(browser('google')), { env: () => ({}), getState: state, modelFactory: () => m }))
    expect(out).toContain('rejected the API key')
    expect(out).not.toContain(KEY)
  })

  test('test-connection reports ok / error class without echoing the key', async () => {
    const t = (code: number | null, headers = browser('openai')) => handleTutorTest(new Request('http://x/api/tutor/test', { method: 'POST', headers }), { env: () => ({}), modelFactory: () => code === null ? new MockLanguageModelV4({ doGenerate: { content: [{ type: 'text', text: 'ok' }], finishReason: { unified: 'stop', raw: 'stop' }, usage: { inputTokens: { total: 1, noCache: 1 }, outputTokens: { total: 1, text: 1 } }, warnings: [] } as never }) : new MockLanguageModelV4({ doGenerate: async () => { throw Object.assign(new Error(KEY), { statusCode: code }) } }) })
    const ok = await t(null)
    expect(await ok.json()).toMatchObject({ ok: true })
    for (const [code, cls] of [[401, 'auth'], [429, 'rate_limit'], [404, 'model'], [400, 'bad_request'], [500, 'unknown']] as const) {
      const res = await t(code)
      const text = await dump(res.clone())
      expect(JSON.parse(await res.text())).toMatchObject({ ok: false, errorClass: cls })
      expect(text).not.toContain(KEY)
    }
    const bad = await t(null, browser('skynet'))
    const bt = await dump(bad)
    expect(bt).toContain('config')
    expect(bt).not.toContain(KEY)
  })

  test('scrub removes raw and url-encoded keys', () => {
    expect(scrub(`a ${KEY} b ${encodeURIComponent(KEY)}`, KEY)).toBe('a [redacted] b [redacted]')
  })

  test('not in tutor context, progress, status, or on disk', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dojo-byok-'))
    try {
      const dojo = new Dojo(() => tutorStatus(H(browser('openai', { 'x-llm-key-present': '1' })), {}), dir)
      dojo.progress.tick('lift-off', 30)
      await handleTutor(req(browser('openai')), { env: () => ({}), getState: state, modelFactory: () => textModel(['x']) })
      const lesson = lessonById('lift-off')!
      const ctx = buildContext({ lesson, checks: [], history: [], map: undefined })
      const surfaces = [ctx, JSON.stringify(dojo.progressView()), JSON.stringify(dojo.status())]
      for (const f of readdirSync(dir)) surfaces.push(readFileSync(path.join(dir, f), 'utf8'))
      for (const s of surfaces) expect(s).not.toContain(KEY)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  test('nothing was written to the console containing the key', () => {
    expect(logs.join('\n')).not.toContain(KEY)
  })
})

describe('end to end against a local fake OpenAI-compatible server', () => {
  let server: ReturnType<typeof Bun.serve>
  const seen: { path: string; auth: string | null; body: string }[] = []
  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      async fetch(r) {
        const body = await r.text()
        seen.push({ path: new URL(r.url).pathname, auth: r.headers.get('authorization'), body })
        if (r.headers.get('authorization') === 'Bearer sk-test-SENTINEL-bad') return new Response(JSON.stringify({ error: { message: 'nope sk-test-SENTINEL-bad' } }), { status: 401 })
        const parsed = JSON.parse(body) as { stream?: boolean }
        const chunk = (delta: object, finish: string | null = null, usage?: object) => `data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', created: 1, model: 'fake', choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) })}\n\n`
        if (!parsed.stream) return Response.json({ id: 'c', object: 'chat.completion', created: 1, model: 'fake', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
        const text = chunk({ role: 'assistant', content: '' }) + chunk({ content: 'Local ' }) + chunk({ content: 'model says hi' }) + chunk({}, 'stop', { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 }) + 'data: [DONE]\n\n'
        return new Response(text, { headers: { 'content-type': 'text/event-stream' } })
      },
    })
  })
  afterAll(() => server.stop(true))
  const deps = (): TutorDeps => ({ env: () => ({}), getState: state })
  const base = () => `http://127.0.0.1:${server.port}/v1`

  test('custom provider streams through the real AI SDK and sends the key upstream only', async () => {
    const res = await handleTutor(req(browser('custom', { 'x-llm-base-url': base() })), deps())
    const text = await res.text()
    expect(text).toContain('Local ')
    expect(text).toContain('model says hi')
    expect(text).toContain('"usage"')
    expect(text).not.toContain(KEY)
    const call = seen.at(-1)!
    expect(call.path).toBe('/v1/chat/completions')
    expect(call.auth).toBe(`Bearer ${KEY}`)
  })
  test('no key is needed for a local server (Ollama style)', async () => {
    const res = await handleTutor(req({ 'x-llm-provider': 'custom', 'x-llm-base-url': base(), 'x-llm-model': 'llama3.1' }), deps())
    expect(await res.text()).toContain('model says hi')
    expect(seen.at(-1)!.auth).toBeNull()
  })
  test('upstream 401 becomes an auth error with no upstream text', async () => {
    const bad = 'sk-test-SENTINEL-bad'
    const res = await handleTutor(req({ ...browser('custom', { 'x-llm-base-url': base() }), 'x-llm-key': bad }), deps())
    const text = await res.text()
    expect(text).toContain('rejected the API key')
    expect(text).not.toContain(bad)
    expect(text).not.toContain('nope')
  })
  test('test connection works against the fake server', async () => {
    const res = await handleTutorTest(new Request('http://x/t', { method: 'POST', headers: browser('custom', { 'x-llm-base-url': base() }) }), { env: () => ({}) })
    expect(await res.json()).toMatchObject({ ok: true })
    const dead = await handleTutorTest(new Request('http://x/t', { method: 'POST', headers: browser('custom', { 'x-llm-base-url': 'http://127.0.0.1:1/v1' }) }), { env: () => ({}) })
    const j = (await dead.json()) as { ok: boolean; errorClass: string }
    expect(j.ok).toBe(false)
    expect(j.errorClass).toBe('network')
  })
})

