import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { DATA_DIR_OVERRIDE, DEFAULT_DATA_DIR, LEGACY_DATA_DIR } from './paths'

const CARRIED = ['progress.json', 'capabilities.json']

/**
 * First start after the rename: if the new data folder does not exist yet and the old one does,
 * COPY the learner's progress across. The old folder is never moved, modified or deleted.
 * Returns the files copied (empty when nothing needed doing).
 */
export function migrateLegacyData(dest = DEFAULT_DATA_DIR, legacy = LEGACY_DATA_DIR): string[] {
  if (existsSync(dest) || !existsSync(legacy)) return []
  mkdirSync(dest, { recursive: true })
  const copied: string[] = []
  for (const f of CARRIED) {
    const from = path.join(legacy, f)
    if (!existsSync(from)) continue
    copyFileSync(from, path.join(dest, f))
    copied.push(f)
  }
  return copied
}

/** Called by the server on boot. Skipped when the data folder is overridden by an env var. */
export function migrateOnBoot(): void {
  if (DATA_DIR_OVERRIDE) return
  const copied = migrateLegacyData()
  if (copied.length) console.log(`[dojo] copied ${copied.join(', ')} from ${LEGACY_DATA_DIR} to ${DEFAULT_DATA_DIR} (the old folder is untouched)`)
}
