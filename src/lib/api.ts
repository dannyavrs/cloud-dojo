import type { TestResult } from '@shared/llm'
import type { CapabilityReport, CheckResult, EmulatorStatus, ExamFamily, ExamModeInfo, ExamModeResult, ExamModeStart, ProgressView, QuizResult, ResourceMap, RunRecord } from '@shared/types'
import { llmHeaders, readLlm } from './llm'

async function j<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`)
  return data as T
}
const post = (url: string, body?: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })

export const api = {
  status: () => fetch('/api/status', { headers: llmHeaders(readLlm(), false) }).then(j<EmulatorStatus>),
  map: () => fetch('/api/map').then(j<ResourceMap>),
  start: (id: string, fresh = false) => post(`/api/lessons/${id}/start`, { fresh }).then(j<{ ms: number; files: string[] }>),
  checks: (id: string, probe = false) => fetch(`/api/lessons/${id}/checks${probe ? '?probe=1' : ''}`).then(j<CheckResult[]>),
  run: (id: string, command: string) => post(`/api/lessons/${id}/run`, { command }).then(j<RunRecord>),
  files: (id: string) => fetch(`/api/lessons/${id}/files`).then(j<{ files: string[] }>),
  file: (id: string, name: string) => fetch(`/api/lessons/${id}/files/${encodeURIComponent(name)}`).then(j<{ text: string; binary: boolean }>),
  http: (id: string, req: { url: string; method: string; headers?: Record<string, string>; body?: string }) => post(`/api/lessons/${id}/http`, req).then(j<{ status: number; body: string; headers?: Record<string, string> }>),
  saveFile: (id: string, name: string, text: string) => fetch(`/api/lessons/${id}/files/${encodeURIComponent(name)}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) }).then(j<{ ok: true; rebuilt: string[]; files: string[] }>),
  progress: () => fetch('/api/progress').then(j<ProgressView>),
  tick: (id: string, seconds: number) => post(`/api/progress/${id}/tick`, { seconds }).catch(() => undefined),
  capabilities: () => fetch('/api/capabilities').then(j<CapabilityReport | { pending: true; probing: boolean }>),
  predict: (id: string, qid: string, choice: number) => post(`/api/quiz/${id}/predict`, { qid, choice }).then(j<QuizResult>),
  exam: (trackId: string, answers: Record<string, number>) => post(`/api/quiz/${trackId}/exam`, { answers }).then(j<{ score: number; total: number; results: Record<string, QuizResult>; byDomain: Record<string, { correct: number; total: number }> }>),
  examModeInfo: () => fetch('/api/exam-mode/info').then(j<ExamModeInfo>),
  examModeStart: (family: ExamFamily, count: number, pace: number) => post('/api/exam-mode/start', { family, count, pace }).then(j<ExamModeStart>),
  examModeSubmit: (id: string, answers: Record<string, number>) => post('/api/exam-mode/submit', { id, answers }).then(j<ExamModeResult>),
  exportProgress: () => fetch('/api/progress/export').then(j<Record<string, unknown>>),
  importProgress: (data: unknown, mode: 'merge' | 'replace') => post('/api/progress/import', { mode, data }).then(j<{ ok: true; mode: string; skipped: number; settings: { theme?: 'dark' | 'light' }; modules: number; exams: number; attempts: number }>),
  showMe: (id: string) => post(`/api/lessons/${id}/showme`).then(j<{ done: boolean; step?: number; total: number; title?: string; explain?: string }>),
  retry: () => post('/api/emulator/retry'),
  /** Tiny request to the configured provider. Sends the draft settings, never stores them. */
  testLlm: (s: Parameters<typeof llmHeaders>[0]) => fetch('/api/tutor/test', { method: 'POST', headers: llmHeaders(s, true) }).then(j<TestResult>),
}

export type TutorMsg = { role: 'user' | 'assistant'; content: string; usage?: { input: number; output: number }; error?: boolean }

export async function streamTutor(lessonId: string, messages: TutorMsg[], on: (e: { type: 'text'; delta: string } | { type: 'usage'; input_tokens: number; output_tokens: number } | { type: 'error'; message: string }) => void, signal?: AbortSignal) {
  const res = await fetch('/api/tutor', { method: 'POST', headers: { 'content-type': 'application/json', ...llmHeaders(readLlm(), true) }, body: JSON.stringify({ lessonId, messages: messages.map(({ role, content }) => ({ role, content })) }), signal })
  if (!res.ok || !res.body) {
    const d = await res.json().catch(() => ({}))
    on({ type: 'error', message: (d as { message?: string }).message ?? `Tutor unavailable (HTTP ${res.status})` })
    return
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (line) on(JSON.parse(line))
    }
  }
}
