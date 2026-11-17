/** Content + wire types shared by the browser and the Bun server. No SDK imports here. */

export interface Step {
  id: string
  title: string
  /** Plain text. `code` and **bold** are rendered inline. */
  body: string
  commands?: string[]
  /** Marks the on-purpose failure for this lesson. */
  breakIt?: boolean
  /** Display-only code or JSON (no send button), e.g. a snippet to paste into a starter file. */
  code?: { file?: string; text: string }
}

/** How honestly the emulator can show a module. */
export type Honesty = 'live' | 'simulated' | 'concept'
export type Level = 'core' | 'intermediate' | 'advanced'

export interface QuizQuestion {
  id: string
  prompt: string
  /** Optional code or command shown under the prompt. */
  code?: string
  options: string[]
  /** Index into options. Grading is local and deterministic. */
  answer: number
  explain: string
  /** Exam domain this question counts toward, e.g. "SAA:Resilient" or "DVA:Dev". */
  tag?: string
}

export interface Track {
  id: string
  n: string
  title: string
  blurb: string
  /** key of the service tile used for this track */
  tile: string
  /** exam domains this track covers, e.g. ["SAA:Performant", "DVA:Dev"] */
  exams: string[]
  /** 6-10 exam-style scenario questions, shown at the end of the track (M1 deep tracks only). */
  exam?: QuizQuestion[]
}

export interface Fidelity { service: string; pass: number; total: number }

export interface LessonContent {
  id: string
  /** Display number such as 3.2, or ★ */
  n: string
  trackId: string
  level: Level
  /** Module ids worth doing first. Not enforced: every module seeds its own prerequisites. */
  prereqs: string[]
  estMinutes: number
  honesty: Honesty
  /** Capability keys the badge depends on. When the probe finds them all enforced, a simulated/concept module flips to live. */
  requires?: string[]
  /** One sentence on what the emulator does or does not do for this module. */
  honestyNote?: string
  /** Exam domains this module supports. */
  examTags: string[]
  /** 1-3 "what will happen?" questions answered before running anything. */
  predict: QuizQuestion[]
  /** Check id that flips when the on-purpose failure has been seen. */
  breakItCheck?: string
  /** Starter files the learner may edit (the server writes only inside this module's working folder). */
  editable?: string[]
  title: string
  tagline: string
  concept: string[]
  goal: string
  steps: Step[]
  breakIt: { title: string; command: string; explain: string[] }
  realAws: { cost: string[]; differences: string[]; asOf: string; sources: { label: string; url: string }[] }
  fidelity: Fidelity[]
  /** Files the starter folder contains (shown in the Files viewer). */
  files: string[]
  /** Which checks only run when the learner presses Check (they send probe traffic). */
  probeNote?: string
  /** Optional HTTP probe panel (API Gateway lessons). */
  httpProbe?: boolean
  checks: { id: string; label: string; hint: string }[]
}

export interface CheckResult {
  id: string
  label: string
  /** null = not evaluated yet (needs the Check button) */
  pass: boolean | null
  hint?: string
  detail?: string
  /** Capstone review: the Well-Architected pillar this row scores, and its sub-checks (null = needs the Check button). */
  pillar?: string
  sub?: { label: string; pass: boolean | null }[]
}

export interface MapNode {
  id: string
  kind: 'bucket' | 'table' | 'queue' | 'topic' | 'function' | 'api' | 'role' | 'user' | 'statemachine' | 'bus' | 'alarm' | 'key' | 'secret' | 'pool'
  label: string
  detail?: string
  status?: string
}
export interface MapEdge { from: string; to: string; label?: string }
export interface ResourceMap { nodes: MapNode[]; edges: MapEdge[]; at: number; error?: string }

export interface RunRecord {
  command: string
  exitCode: number
  stdout: string
  stderr: string
  ms: number
  at: number
  rejected?: boolean
}

export interface EmulatorStatus {
  phase: 'starting' | 'docker-missing' | 'building-image' | 'booting' | 'ready' | 'stopped' | 'error'
  message: string
  version: string
  endpoint: string
  bootMs?: number
  currentLesson?: string | null
  starting?: boolean
  /** true while the one-time capability probe runs */
  probing?: boolean
  tutor: import('./llm').TutorStatus
}

export interface QuizResult { correct: boolean; answer: number; explain: string }

export interface ModuleProgress {
  checksPassed: string[]
  checksTotal: number
  breakIt: boolean
  predict: Record<string, boolean>
  seconds: number
  completedAt?: number
  lastSeen?: number
}
export interface ExamProgress { answers: Record<string, boolean>; at: number }
export interface DomainReadiness { domain: string; modulesDone: number; modulesTotal: number; examCorrect: number; examTotal: number; percent: number }
export interface TrackSummary { id: string; done: number; total: number; examCorrect: number; examTotal: number }
export interface ProgressView {
  modules: Record<string, ModuleProgress>
  exams: Record<string, ExamProgress>
  tracks: TrackSummary[]
  readiness: DomainReadiness[]
  /** Finished mixed practice exams, oldest first (newest 50 kept). */
  examAttempts: ExamAttempt[]
}

/** Exam mode (mixed, timed practice across all track exams). A question ref is `trackId/questionId`. */
export type ExamFamily = 'SAA' | 'DVA' | 'MIXED'
export interface ExamAttempt {
  id: string
  family: ExamFamily
  startedAt: number
  submittedAt: number
  /** Allowed time, 0 = untimed. */
  durationSec: number
  elapsedSec: number
  score: number
  total: number
  byDomain: Record<string, { correct: number; total: number }>
  correctRefs: string[]
  /** Wrong or unanswered. */
  wrongRefs: string[]
}
/** A question as sent to the browser before submit: never the answer key or the explanation. */
export interface ExamModeQuestion { ref: string; trackId: string; tag?: string; prompt: string; code?: string; options: string[] }
export interface ExamModeStart { id: string; family: ExamFamily; startedAt: number; durationSec: number; questions: ExamModeQuestion[] }
export interface ExamReviewItem { ref: string; trackId: string; tag?: string; picked: number | null; answer: number; explain: string; study: { moduleId: string; label: string } | null }
export interface ExamModeResult { attempt: ExamAttempt; answered: number; review: ExamReviewItem[] }
export interface ExamModeInfo { available: Record<ExamFamily, number>; domains: Record<ExamFamily, Record<string, number>>; recent: ExamAttempt[] }

export interface Capability { key: string; label: string; enforced: boolean; detail?: string }
export interface CapabilityReport { image: string; at: number; capabilities: Capability[] }
