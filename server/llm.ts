import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import { isProviderId, LLM_HEADERS, PROVIDERS, providerInfo, type LlmSource, type ProviderId, type TestResult, type TutorStatus } from '../shared/llm'

/**
 * Provider-agnostic model layer.
 *
 * The API key is a per-request secret: it arrives in the `x-llm-key` header (browser localStorage) or
 * from env vars (self-hosters), is used for exactly one upstream call, and is never logged, stored,
 * echoed or placed in a response. Every error string that leaves this module goes through `scrub`.
 */
export interface LlmConfig { provider: ProviderId; model: string; apiKey?: string; baseUrl?: string }
export type Resolution =
  | { ok: true; config: LlmConfig; source: Exclude<LlmSource, 'none'> }
  | { ok: false; source: 'none'; status: number; code: string; message: string }

export const NO_PROVIDER_MESSAGE = 'The tutor is not connected. Open Settings and add a provider and API key (stored in this browser only), or set LLM_PROVIDER, LLM_API_KEY and LLM_MODEL in .env.local (project root) and restart.'

type Env = Record<string, string | undefined>
const placeholder = (v?: string) => !v || /your-key-here/i.test(v)
const clean = (v: string | null | undefined) => (v ?? '').trim()

/** Custom base URLs are user-supplied. Accepts http(s) only; the request that follows is chat-completions only. */
export function parseBaseUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.toString().replace(/\/+$/, '')
  } catch { return null }
}

function build(provider: string, model: string, apiKey: string, baseUrlRaw: string, source: 'browser' | 'env'): Resolution {
  if (!isProviderId(provider)) return { ok: false, source: 'none', status: 400, code: 'bad_provider', message: `Unknown provider. Choose one of: ${PROVIDERS.map((p) => p.id).join(', ')}.` }
  const info = providerInfo(provider)
  if (!apiKey && !info.keyOptional) return { ok: false, source: 'none', status: 400, code: 'no_key', message: `${info.label} needs an API key.` }
  let baseUrl: string | undefined
  if (info.baseUrl === 'required') {
    const b = baseUrlRaw ? parseBaseUrl(baseUrlRaw) : null
    if (!b) return { ok: false, source: 'none', status: 400, code: 'bad_base_url', message: 'A custom provider needs a base URL starting with http:// or https:// (for example http://localhost:11434/v1).' }
    baseUrl = b
  } else if (info.baseUrl === 'fixed') baseUrl = info.fixedBaseUrl
  return { ok: true, source, config: { provider, model: model || info.defaultModel, apiKey: apiKey || undefined, baseUrl } }
}

/** Env: LLM_* first, then the legacy ANTHROPIC_API_KEY / ANTHROPIC_MODEL pair. */
export function resolveFromEnv(env: Env): Resolution {
  const legacyKey = placeholder(env.ANTHROPIC_API_KEY) ? '' : env.ANTHROPIC_API_KEY!.trim()
  const llmKey = placeholder(env.LLM_API_KEY) ? '' : env.LLM_API_KEY!.trim()
  const provider = clean(env.LLM_PROVIDER).toLowerCase() || (legacyKey ? 'anthropic' : '')
  if (!provider) return { ok: false, source: 'none', status: 503, code: 'no_key', message: NO_PROVIDER_MESSAGE }
  const key = llmKey || (provider === 'anthropic' ? legacyKey : '')
  const model = clean(env.LLM_MODEL) || (provider === 'anthropic' ? clean(env.ANTHROPIC_MODEL) : '')
  const r = build(provider, model, key, clean(env.LLM_BASE_URL), 'env')
  return r.ok ? r : { ...r, status: 503 }
}

/** A browser-supplied key beats env. The browser sends nothing when it has no settings saved. */
export function resolveLlm(headers: Headers, env: Env): Resolution {
  const provider = clean(headers.get(LLM_HEADERS.provider)).toLowerCase()
  const key = clean(headers.get(LLM_HEADERS.key))
  if (provider && (key || provider === 'custom')) return build(provider, clean(headers.get(LLM_HEADERS.model)), key, clean(headers.get(LLM_HEADERS.baseUrl)), 'browser')
  return resolveFromEnv(env)
}

/** For /api/status. Never needs the key itself: the browser sends x-llm-key-present instead. */
export function tutorStatus(headers: Headers, env: Env): TutorStatus {
  const provider = clean(headers.get(LLM_HEADERS.provider)).toLowerCase()
  if (provider && isProviderId(provider) && (headers.get(LLM_HEADERS.keyPresent) === '1' || provider === 'custom')) {
    return { enabled: true, provider, model: clean(headers.get(LLM_HEADERS.model)) || providerInfo(provider).defaultModel, source: 'browser' }
  }
  const r = resolveFromEnv(env)
  return r.ok ? { enabled: true, provider: r.config.provider, model: r.config.model, source: 'env' } : { enabled: false, model: '', source: 'none' }
}

export function createModel(c: LlmConfig): LanguageModel {
  switch (c.provider) {
    case 'anthropic': return createAnthropic({ apiKey: c.apiKey })(c.model)
    case 'openai': return createOpenAI({ apiKey: c.apiKey })(c.model)
    case 'google': return createGoogleGenerativeAI({ apiKey: c.apiKey })(c.model)
    case 'openrouter':
    case 'custom':
      return createOpenAICompatible({ name: c.provider, baseURL: c.baseUrl!, apiKey: c.apiKey }).chatModel(c.model)
  }
}

/** Remove the key (raw and URL-encoded) from any string before it can leave the server. */
export function scrub(text: string, key?: string): string {
  let out = text
  if (key && key.length >= 4) for (const k of new Set([key, encodeURIComponent(key)])) out = out.split(k).join('[redacted]')
  return out
}

export type ErrorClass = Extract<TestResult, { ok: false }>['errorClass']
/** Map an upstream failure to a class and a fixed message. The raw error text is never returned. */
export function classifyError(e: unknown, provider?: ProviderId): { errorClass: ErrorClass; message: string } {
  const err = e as { statusCode?: number; status?: number; code?: string; cause?: { code?: string }; name?: string }
  const status = err?.statusCode ?? err?.status
  const code = err?.code ?? err?.cause?.code
  const who = provider ? providerInfo(provider).label : 'The provider'
  if (status === 401 || status === 403) return { errorClass: 'auth', message: `${who} rejected the API key.` }
  if (status === 429) return { errorClass: 'rate_limit', message: `${who} rate limited the request or the account is out of quota. Try again shortly.` }
  if (status === 404) return { errorClass: 'model', message: 'The model or endpoint was not found. Check the model name and base URL.' }
  if (status && status >= 400 && status < 500) return { errorClass: 'bad_request', message: `${who} rejected the request (HTTP ${status}).` }
  if (status && status >= 500) return { errorClass: 'unknown', message: `${who} had a server error (HTTP ${status}).` }
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ECONNRESET' || code === 'ETIMEDOUT' || /fetch failed|Unable to connect|Cannot connect/i.test((e as Error)?.message ?? '')) return { errorClass: 'network', message: 'Could not reach the endpoint. Check the base URL and that the server is running.' }
  return { errorClass: 'unknown', message: 'The request failed.' }
}
