import { useSyncExternalStore } from 'react'

/** The step the learner is currently reading, for the breadcrumb and the side nav. */
let current: { lesson: string; step: string; title: string } | null = null
const subs = new Set<() => void>()
export const setCurrentStep = (v: typeof current) => { if (JSON.stringify(v) !== JSON.stringify(current)) { current = v; subs.forEach((f) => f()) } }
export const useCurrentStep = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => current)
