import { useEffect, useState } from 'react'

export function useTheme(): 'dark' | 'light' {
  const read = (): 'dark' | 'light' => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
  const [t, setT] = useState(read)
  useEffect(() => {
    const mo = new MutationObserver(() => setT(read()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => mo.disconnect()
  }, [])
  return t
}
