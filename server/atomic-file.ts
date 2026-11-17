import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from 'node:fs'
import path from 'node:path'

export const backupPath = (file: string) => `${file}.bak`

export interface AtomicOptions {
  /** Keep the previous contents in `<file>.bak` before replacing them (default true). */
  backup?: boolean
  /** Only back up a previous file when this says it is healthy, so a corrupt file never replaces a good `.bak`. */
  isHealthy?: (text: string) => boolean
}

/**
 * Crash-safe write: the new contents go to a temp file in the same folder (same filesystem, so the
 * rename is atomic), are flushed to disk, then renamed over the target. A reader sees the old file
 * or the new one, never half of one. The previous version is kept as a rolling `.bak`.
 */
export function writeFileAtomic(file: string, text: string, opts: AtomicOptions = {}): void {
  const dir = path.dirname(file)
  mkdirSync(dir, { recursive: true })
  if (opts.backup !== false && existsSync(file) && statSync(file).size > 0) {
    let healthy = true
    if (opts.isHealthy) { try { healthy = opts.isHealthy(readFileSync(file, 'utf8')) } catch { healthy = false } }
    if (healthy) copyFileSync(file, backupPath(file))
  }
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`)
  try {
    const fd = openSync(tmp, 'w', 0o600)
    try { writeSync(fd, text); fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(tmp, file)
  } catch (e) {
    rmSync(tmp, { force: true })
    throw e
  }
}
