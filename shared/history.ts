import type { CheckResult, ModuleProgress } from './types'

export type DoneKind = 'verified' | 'manual' | null

/** How a module was finished: confirmed by its checks ("verified"), marked by the learner ("manual"), or not at all. */
export function doneKind(m: Pick<ModuleProgress, 'completedAt' | 'manual'> | undefined): DoneKind {
  return m?.completedAt ? (m.manual ? 'manual' : 'verified') : null
}

/**
 * Sticky history for the lesson page. The live checker reads the emulator, which is reset whenever you switch
 * lesson or the server restarts, so a live 0 does not mean the work was lost. Any check that is not passing
 * live but is recorded as passed shows as `earlier: true`.
 */
export function withHistory(checks: CheckResult[], passed: readonly string[] | undefined): CheckResult[] {
  const set = new Set(passed ?? [])
  return checks.map((c) => (c.pass !== true && set.has(c.id) ? { ...c, earlier: true } : c))
}

export const passedCount = (checks: CheckResult[]) => checks.filter((c) => c.pass === true || c.earlier).length
