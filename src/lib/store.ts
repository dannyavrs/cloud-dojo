import { useCallback, useEffect, useState } from 'react'

const PREFIX = 'cloud-dojo:'
export function useLocal<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [val, setVal] = useState<T>(() => {
    try { const raw = localStorage.getItem(PREFIX + key); return raw ? (JSON.parse(raw) as T) : initial } catch { return initial }
  })
  // re-read when the key changes (e.g. switching lessons)
  useEffect(() => {
    try { const raw = localStorage.getItem(PREFIX + key); setVal(raw ? (JSON.parse(raw) as T) : initial) } catch { setVal(initial) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const set = useCallback((v: T | ((p: T) => T)) => {
    setVal((prev) => {
      const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v
      try { localStorage.setItem(PREFIX + key, JSON.stringify(next)) } catch { /* quota */ }
      return next
    })
  }, [key])
  return [val, set]
}

export const readLocal = <T,>(key: string, fallback: T): T => {
  try { const raw = localStorage.getItem(PREFIX + key); return raw ? (JSON.parse(raw) as T) : fallback } catch { return fallback }
}
export const writeLocal = (key: string, v: unknown) => { try { localStorage.setItem(PREFIX + key, JSON.stringify(v)) } catch { /* ignore */ } }
