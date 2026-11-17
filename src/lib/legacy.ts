/**
 * Backward compatibility with the pre-rename app ("AWS Academy"): copy its browser-local settings
 * (theme, tutor provider, notes...) to the new key prefix once. The old keys are left in place.
 */
const OLD = 'aws-academy:'
const NEW = 'cloud-dojo:'

export function migrateLegacyLocalStorage(store: Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem'> = localStorage): number {
  let copied = 0
  try {
    const keys: string[] = []
    for (let i = 0; i < store.length; i++) { const k = store.key(i); if (k?.startsWith(OLD)) keys.push(k) }
    for (const k of keys) {
      const to = NEW + k.slice(OLD.length)
      if (store.getItem(to) === null) { const v = store.getItem(k); if (v !== null) { store.setItem(to, v); copied++ } }
    }
  } catch { /* storage unavailable: nothing to migrate */ }
  return copied
}
