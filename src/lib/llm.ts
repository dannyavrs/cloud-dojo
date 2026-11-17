import { useSyncExternalStore } from 'react'
import { isProviderId, LLM_HEADERS, providerInfo, type ProviderId } from '@shared/llm'

/**
 * Tutor settings. The API key lives ONLY in this browser's localStorage. It is sent to the local
 * server per request in `x-llm-key` and nowhere else; it is never rendered back into the page.
 */
export interface LlmSettings { provider: ProviderId; model: string; baseUrl: string; key: string }
const STORE = 'cloud-dojo:llm'
export const LLM_CHANGED = 'dojo:llm-changed'
export const OPEN_SETTINGS = 'dojo:open-settings'
const EMPTY: LlmSettings = { provider: 'anthropic', model: '', baseUrl: '', key: '' }

let cache: { raw: string | null; value: LlmSettings } | null = null

function read(): LlmSettings {
  let raw: string | null = null
  try { raw = localStorage.getItem(STORE) } catch { /* private mode */ }
  if (cache && cache.raw === raw) return cache.value
  let value = EMPTY
  try {
    const p = raw ? (JSON.parse(raw) as Partial<LlmSettings>) : {}
    value = { provider: isProviderId(p.provider) ? p.provider : 'anthropic', model: String(p.model ?? ''), baseUrl: String(p.baseUrl ?? ''), key: String(p.key ?? '') }
  } catch { /* corrupt entry: fall back to empty */ }
  cache = { raw, value }
  return value
}

/** True when the browser has enough saved to talk to a provider (a key, or a local custom endpoint). */
export const isConfigured = (s: LlmSettings) => Boolean(s.key) || (s.provider === 'custom' && Boolean(s.baseUrl))

export function saveLlm(s: LlmSettings) {
  try { localStorage.setItem(STORE, JSON.stringify(s)) } catch { /* quota */ }
  window.dispatchEvent(new Event(LLM_CHANGED))
}
export function forgetKey() {
  saveLlm({ ...read(), key: '' })
}

function subscribe(cb: () => void) {
  window.addEventListener(LLM_CHANGED, cb)
  window.addEventListener('storage', cb)
  return () => { window.removeEventListener(LLM_CHANGED, cb); window.removeEventListener('storage', cb) }
}
export const useLlm = () => useSyncExternalStore(subscribe, read, () => EMPTY)
export const readLlm = read

/** Headers for the local server. `withKey: false` sends only a presence flag (used by status polling). */
export function llmHeaders(s: LlmSettings, withKey: boolean): Record<string, string> {
  const h: Record<string, string> = {}
  if (!isConfigured(s)) return h
  h[LLM_HEADERS.provider] = s.provider
  if (s.model.trim()) h[LLM_HEADERS.model] = s.model.trim()
  if (s.baseUrl.trim()) h[LLM_HEADERS.baseUrl] = s.baseUrl.trim()
  if (s.key) { if (withKey) h[LLM_HEADERS.key] = s.key; else h[LLM_HEADERS.keyPresent] = '1' }
  return h
}

export const effectiveModel = (s: LlmSettings) => s.model.trim() || providerInfo(s.provider).defaultModel
