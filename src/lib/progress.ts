import { useEffect, useSyncExternalStore } from 'react'
import type { ProgressView } from '@shared/types'
import { api } from './api'

let state: ProgressView | null = null
let inflight: Promise<void> | null = null
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

/** Server-side progress (a JSON file in DATA_DIR). The browser only mirrors it. */
export function refreshProgress(): Promise<void> {
  inflight ??= api.progress().then((p) => { state = p; emit() }).catch(() => undefined).finally(() => { inflight = null })
  return inflight
}

export function useProgress(): ProgressView | null {
  const v = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => state)
  useEffect(() => { void refreshProgress() }, [])
  return v
}

export const isDone = (p: ProgressView | null, id: string) => Boolean(p?.modules[id]?.completedAt)
