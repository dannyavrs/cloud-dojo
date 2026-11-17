import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { ServerInfo } from '../shared/types'
import { DEFAULT_API_PORT } from '../shared/ports'
import { DATA_DIR, DEFAULT_DATA_DIR, LEGACY_DATA_DIR } from './paths'

/** Who is answering: a per-process id plus the data folder, so the UI can warn about restarts and throwaway data. */
export function makeServerInfo(port: number, dataDir = DATA_DIR, now = Date.now()): ServerInfo {
  const custom = path.resolve(dataDir) !== path.resolve(DEFAULT_DATA_DIR)
  return { instanceId: randomUUID(), startedAt: now, port, customDataDir: custom, ...(custom ? { dataDir } : {}) }
}

/**
 * A server on a non-default data folder (tests, e2e, screenshots) must not sit on the learner's port:
 * the browser would talk to it believing it is the real session. Returns the problem, or null.
 */
export function portConflict(port: number, dataDir = DATA_DIR): string | null {
  const real = path.resolve(dataDir) === path.resolve(DEFAULT_DATA_DIR) || path.resolve(dataDir) === path.resolve(LEGACY_DATA_DIR)
  if (!real && port === DEFAULT_API_PORT) {
    return `Refusing to start on port ${port} with a custom data folder (${dataDir}): ${port} is reserved for your real session. Use PORT=4848 (see scripts/with-temp-data.ts).`
  }
  return null
}
