/** Validation for the generalised HTTP probe. The probe only ever talks to the emulator origin. */
export const PROBE_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const
export type ProbeMethod = (typeof PROBE_METHODS)[number]
const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'upgrade', 'te', 'keep-alive', 'proxy-authorization', 'cookie'])
const HEADER_NAME = /^[A-Za-z0-9-]{1,40}$/
export const MAX_PROBE_BODY = 20_000

export interface ProbeInput { url?: unknown; method?: unknown; headers?: unknown; body?: unknown }
export type ProbeRequest = { ok: true; url: string; method: ProbeMethod; headers: Record<string, string>; body?: string } | { ok: false; error: string }

export function sanitizeProbe(input: ProbeInput): ProbeRequest {
  if (typeof input.url !== 'string' || !input.url) return { ok: false, error: 'url required' }
  try { if (!/^https?:$/.test(new URL(input.url).protocol)) return { ok: false, error: 'Only http and https URLs.' } } catch { return { ok: false, error: 'That is not a valid URL.' } }
  const method = String(input.method ?? 'GET').toUpperCase() as ProbeMethod
  if (!PROBE_METHODS.includes(method)) return { ok: false, error: `Method must be one of ${PROBE_METHODS.join(', ')}.` }
  const headers: Record<string, string> = {}
  if (input.headers !== undefined && input.headers !== null) {
    if (typeof input.headers !== 'object' || Array.isArray(input.headers)) return { ok: false, error: 'headers must be an object of name to value.' }
    const entries = Object.entries(input.headers as Record<string, unknown>)
    if (entries.length > 12) return { ok: false, error: 'At most 12 headers.' }
    for (const [k, v] of entries) {
      if (!HEADER_NAME.test(k)) return { ok: false, error: `Bad header name: ${k.slice(0, 40)}` }
      if (FORBIDDEN_HEADERS.has(k.toLowerCase())) return { ok: false, error: `The ${k} header is set by the probe and cannot be overridden.` }
      if (typeof v !== 'string' || v.length > 4000|| /[\r\n]/.test(v)) return { ok: false, error: `Bad value for header ${k}.` }
      headers[k] = v
    }
  }
  let body: string | undefined
  if (input.body !== undefined && input.body !== null && input.body !== '') {
    if (typeof input.body !== 'string' || input.body.length > MAX_PROBE_BODY) return { ok: false, error: `Body is limited to ${MAX_PROBE_BODY} characters.` }
    if (method === 'GET' || method === 'HEAD') return { ok: false, error: `${method} requests cannot have a body.` }
    body = input.body
    if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json'
  }
  return { ok: true, url: input.url, method, headers, body }
}

/** "Name: value" lines to a header object (used by the UI and tests). */
export function parseHeaderLines(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const i = line.indexOf(':')
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}
