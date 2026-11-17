import type { LessonContent, ModuleProgress } from './types'

export interface ContinueTarget { lesson: LessonContent; passed: number; total: number; started: boolean }

/**
 * "Continue where you left off": the most recently seen module that is not finished.
 * Nothing seen yet: the first module that is not done (the first module overall for a new learner).
 */
export function continueTarget(modules: Record<string, ModuleProgress> | undefined, lessons: LessonContent[]): ContinueTarget | null {
  if (!lessons.length) return null
  const mods = modules ?? {}
  const seen = lessons.filter((l) => mods[l.id]?.lastSeen && !mods[l.id].completedAt).sort((a, b) => (mods[b.id].lastSeen ?? 0) - (mods[a.id].lastSeen ?? 0))
  const lesson = seen[0] ?? lessons.find((l) => !mods[l.id]?.completedAt) ?? lessons[0]
  const m = mods[lesson.id]
  return { lesson, passed: m?.checksPassed.length ?? 0, total: m?.checksTotal || lesson.checks.length, started: Boolean(seen[0]) }
}
