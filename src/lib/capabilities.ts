import { useEffect, useState } from 'react'
import type { CapabilityReport, Honesty, LessonContent } from '@shared/types'
import { api } from './api'

export type CapState = { report: CapabilityReport | null; pending: boolean }

/** Read the probe result. While the one-time probe runs the badge falls back to what the module declares. */
export function useCapabilities(): CapState {
  const [st, setSt] = useState<CapState>({ report: null, pending: true })
  useEffect(() => {
    let alive = true
    const load = () => api.capabilities().then((r) => {
      if (!alive) return
      if ('pending' in r) { setSt({ report: null, pending: true }); setTimeout(load, 4000) } else setSt({ report: r, pending: false })
    }).catch(() => alive && setTimeout(load, 6000))
    void load()
    return () => { alive = false }
  }, [])
  return st
}

/** A simulated or concept module flips to live on its own once the probe finds everything it needs enforced. */
export function effectiveHonesty(l: LessonContent, report: CapabilityReport | null): Honesty {
  if (l.honesty === 'live' || !l.requires?.length || !report) return l.honesty
  const on = new Set(report.capabilities.filter((c) => c.enforced).map((c) => c.key))
  return l.requires.every((k) => on.has(k)) ? 'live' : l.honesty
}
