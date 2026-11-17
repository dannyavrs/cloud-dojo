import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { ServerInfo } from '../shared/types'
import { DEFAULT_API_PORT, DEFAULT_EMU_NAME, DEFAULT_EMU_PORT, TEST_EMU_NAME, TEST_EMU_PORT } from '../shared/ports'
import { CONTAINER, DATA_DIR, DEFAULT_DATA_DIR, EMU_PORT, LEGACY_DATA_DIR } from './paths'

/** Who is answering: a per-process id plus the data folder, so the UI can warn about restarts and throwaway data. */
export function makeServerInfo(port: number, dataDir = DATA_DIR, now = Date.now()): ServerInfo {
  const custom = path.resolve(dataDir) !== path.resolve(DEFAULT_DATA_DIR)
  return { instanceId: randomUUID(), startedAt: now, port, customDataDir: custom, ...(custom ? { dataDir } : {}) }
}

/**
 * A server on a non-default data folder (tests, e2e, screenshots) must not sit on the learner's port:
 * the browser would talk to it believing it is the real session. Returns the problem, or null.
 */
function isRealDataDir(dataDir: string): boolean {
  return path.resolve(dataDir) === path.resolve(DEFAULT_DATA_DIR) || path.resolve(dataDir) === path.resolve(LEGACY_DATA_DIR)
}

export function portConflict(port: number, dataDir = DATA_DIR): string | null {
  if (!isRealDataDir(dataDir) && port === DEFAULT_API_PORT) {
    return `Refusing to start on port ${port} with a custom data folder (${dataDir}): ${port} is reserved for your real session. Use PORT=4848 (see scripts/with-temp-data.ts).`
  }
  return null
}

/**
 * A server on a non-default data folder must not start, reset or remove the learner's
 * emulator container or bind its port. Returns the problem, or null.
 */
export function emulatorConflict(name = CONTAINER, port = EMU_PORT, dataDir = DATA_DIR): string | null {
  if (isRealDataDir(dataDir)) return null
  const hint = `Use CLOUD_DOJO_EMULATOR_NAME=${TEST_EMU_NAME} and CLOUD_DOJO_EMULATOR_PORT=${TEST_EMU_PORT} (see scripts/with-temp-data.ts).`
  if (name === DEFAULT_EMU_NAME) {
    return `Refusing to use container ${name} with a custom data folder (${dataDir}): ${name} is reserved for your real session. ${hint}`
  }
  if (port === DEFAULT_EMU_PORT) {
    return `Refusing to use emulator port ${port} with a custom data folder (${dataDir}): ${port} is reserved for your real session. ${hint}`
  }
  return null
}
