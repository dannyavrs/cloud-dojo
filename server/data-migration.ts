import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { writeFileAtomic } from './atomic-file'
import { buildExport, mergeData, type ProgressData } from './progress-io'
import { DATA_DIR, DATA_DIR_OVERRIDE, DEFAULT_DATA_DIR, LEGACY_DATA_DIR } from './paths'

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

/** Lenient read: a progress file in any shape, reduced to well-formed records (malformed ones are skipped). */
function readProgress(file: string): ProgressData | null {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<ProgressData>
    const clean = buildExport({ modules: raw.modules ?? {}, exams: raw.exams ?? {}, examAttempts: Array.isArray(raw.examAttempts) ? raw.examAttempts : [] })
    return { modules: clean.modules, exams: clean.exams, examAttempts: clean.examAttempts }
  } catch { return null }
}

/**
 * Keep working on the old folder safe: if `~/.aws-academy/progress.json` is newer than `~/.cloud-dojo/progress.json`
 * (the old build was used after the copy), MERGE it in with the same rule as an import instead of ignoring it.
 * Idempotent: merging twice changes nothing, nothing is written when the merge adds nothing, and after a write the
 * new file is the newer one so later boots skip it. The old folder is only read.
 * Returns true when the new file was updated.
 */
export function mergeLegacyProgress(dest = DEFAULT_DATA_DIR, legacy = LEGACY_DATA_DIR): boolean {
  const from = path.join(legacy, 'progress.json')
  const to = path.join(dest, 'progress.json')
  if (!existsSync(from)) return false
  if (existsSync(to) && statSync(from).mtimeMs <= statSync(to).mtimeMs) return false
  const incoming = readProgress(from)
  if (!incoming) return false
  const current = existsSync(to) ? readProgress(to) : { modules: {}, exams: {}, examAttempts: [] }
  if (!current) return false // the new file is unreadable: do not touch it
  const merged = mergeData(current, incoming)
  if (JSON.stringify(merged) === JSON.stringify(current)) return false
  writeFileAtomic(to, JSON.stringify(merged, null, 2), { isHealthy: (t) => { JSON.parse(t); return true } })
  return true
}

/** Called by the server on boot. Always logs the data folder in use; migration is skipped when it is overridden. */
export function migrateOnBoot(): void {
  console.log(`[dojo] data folder: ${DATA_DIR}${DATA_DIR_OVERRIDE ? ' (custom: CLOUD_DOJO_DATA_DIR)' : ' (default)'}`)
  if (DATA_DIR_OVERRIDE) return
  const copied = migrateLegacyData()
  if (copied.length) console.log(`[dojo] copied ${copied.join(', ')} from ${LEGACY_DATA_DIR} to ${DEFAULT_DATA_DIR} (the old folder is untouched)`)
  try {
    if (mergeLegacyProgress()) console.log(`[dojo] merged newer progress from ${LEGACY_DATA_DIR} into ${DEFAULT_DATA_DIR} (the old folder is untouched)`)
  } catch (e) { console.error('[dojo] legacy progress merge skipped:', e instanceof Error ? e.message : e) }
}
