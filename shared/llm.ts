/** Provider catalogue shared by the server (resolution) and the Settings panel. No secrets here. */
export type ProviderId = 'anthropic' | 'openai' | 'google' | 'openrouter' | 'custom'

export interface ProviderInfo {
  id: ProviderId
  label: string
  defaultModel: string
  /** key is optional for local servers (Ollama, LM Studio) */
  keyOptional?: boolean
  baseUrl: 'none' | 'fixed' | 'required'
  fixedBaseUrl?: string
  keyHint: string
}

export const PROVIDERS: ProviderInfo[] = [
  { id: 'anthropic', label: 'Anthropic', defaultModel: 'claude-opus-5-5', baseUrl: 'none', keyHint: 'sk-ant-…' },
  { id: 'openai', label: 'OpenAI', defaultModel: 'gpt-5-mini', baseUrl: 'none', keyHint: 'sk-…' },
  { id: 'google', label: 'Google Gemini', defaultModel: 'gemini-2.5-flash', baseUrl: 'none', keyHint: 'AIza…' },
  { id: 'openrouter', label: 'OpenRouter', defaultModel: 'anthropic/claude-sonnet-4.5', baseUrl: 'fixed', fixedBaseUrl: 'https://openrouter.ai/api/v1', keyHint: 'sk-or-…' },
  { id: 'custom', label: 'Custom (OpenAI-compatible)', defaultModel: 'llama3.1', keyOptional: true, baseUrl: 'required', keyHint: 'optional for local servers' },
]

export const isProviderId = (v: unknown): v is ProviderId => PROVIDERS.some((p) => p.id === v)
export const providerInfo = (id: ProviderId) => PROVIDERS.find((p) => p.id === id)!

export type LlmSource = 'browser' | 'env' | 'none'
export interface TutorStatus { enabled: boolean; provider?: ProviderId; model: string; source: LlmSource }

/** Request headers the browser uses to hand its own settings to the local server. */
export const LLM_HEADERS = { key: 'x-llm-key', provider: 'x-llm-provider', model: 'x-llm-model', baseUrl: 'x-llm-base-url', keyPresent: 'x-llm-key-present' } as const

export type TestResult = { ok: true; ms: number } | { ok: false; errorClass: 'auth' | 'rate_limit' | 'model' | 'network' | 'bad_request' | 'config' | 'unknown'; message: string }
