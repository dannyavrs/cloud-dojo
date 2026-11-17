import { generateText, streamText, type LanguageModel } from 'ai'
import { lessonById } from '../shared/lessons'
import type { TestResult } from '../shared/llm'
import type { CheckResult, ResourceMap, RunRecord } from '../shared/types'
import { classifyError, createModel, resolveLlm, scrub, type LlmConfig } from './llm'
import { buildContext, SYSTEM_PROMPT } from './tutor-context'

export interface TutorDeps {
  /** Read lazily (process.env can change between requests in tests). */
  env: () => Record<string, string | undefined>
  getState: (lessonId: string) => Promise<{ checks: CheckResult[]; history: RunRecord[]; map?: ResourceMap }>
  /** test seam: inject a mock model instead of calling a provider */
  modelFactory?: (c: LlmConfig) => LanguageModel
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

export function sanitizeMessages(raw: unknown): { role: 'user' | 'assistant'; content: string }[] | null {
  if (!Array.isArray(raw)) return null
  const out = raw
    .filter((m): m is { role: string; content: string } => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim().length > 0)
    .slice(-20)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content.slice(0, 4000) }))
  // API requires the conversation to start with a user turn and end with one
  while (out.length && out[0].role !== 'user') out.shift()
  return out.length && out[out.length - 1].role === 'user' ? out : null
}

/** Streamed replies are never cached. */
const NDJSON = { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' }

export async function handleTutor(req: Request, deps: TutorDeps): Promise<Response> {
  const r = resolveLlm(req.headers, deps.env())
  if (!r.ok) return json(r.status, { error: r.code, message: r.message })
  const cfg = r.config
  const key = cfg.apiKey
  let body: { lessonId?: string; messages?: unknown }
  try { body = (await req.json()) as typeof body } catch { return json(400, { error: 'bad_json' }) }
  const lesson = typeof body.lessonId === 'string' ? lessonById(body.lessonId) : undefined
  if (!lesson) return json(404, { error: 'unknown_lesson' })
  const messages = sanitizeMessages(body.messages)
  if (!messages) return json(400, { error: 'bad_messages', message: 'Send at least one user message.' })
  const st = await deps.getState(lesson.id)
  const system = `${SYSTEM_PROMPT}\n\n${buildContext({ lesson, ...st })}`
  const enc = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + '\n'))
      const fail = (e: unknown) => {
        // never echo the raw error: SDK errors can carry request metadata
        const c = classifyError(e, cfg.provider)
        send({ type: 'error', message: scrub(c.message, key) })
      }
      try {
        const result = streamText({
          model: (deps.modelFactory ?? createModel)(cfg),
          system,
          messages,
          maxOutputTokens: 4000,
          maxRetries: 1,
          onError: () => { /* surfaced through fullStream below; the default handler would console.error the raw error */ },
        })
        let failed = false
        for await (const part of result.fullStream) {
          if (part.type === 'text-delta') send({ type: 'text', delta: part.text })
          else if (part.type === 'error') { failed = true; fail(part.error) }
          else if (part.type === 'finish' && !failed) send({ type: 'usage', input_tokens: part.totalUsage.inputTokens ?? 0, output_tokens: part.totalUsage.outputTokens ?? 0 })
        }
      } catch (e) { fail(e) }
      controller.close()
    },
  })
  return new Response(stream, { headers: NDJSON })
}

/** "Test connection": one tiny request. Returns an error class and a fixed message, never upstream text or the key. */
export async function handleTutorTest(req: Request, deps: Pick<TutorDeps, 'env' | 'modelFactory'>): Promise<Response> {
  const r = resolveLlm(req.headers, deps.env())
  if (!r.ok) return json(200, { ok: false, errorClass: 'config', message: scrub(r.message) } satisfies TestResult)
  const t0 = Date.now()
  try {
    await generateText({ model: (deps.modelFactory ?? createModel)(r.config), prompt: 'Reply with: ok', maxOutputTokens: 16, maxRetries: 0, abortSignal: AbortSignal.timeout(20_000) })
    return json(200, { ok: true, ms: Date.now() - t0 } satisfies TestResult)
  } catch (e) {
    const c = classifyError(e, r.config.provider)
    return json(200, { ok: false, errorClass: c.errorClass, message: scrub(c.message, r.config.apiKey) } satisfies TestResult)
  }
}
