/**
 * Bun test preload (see bunfig.toml). Runs before any test file imports server code, so
 * `server/paths.ts` sees a throwaway data dir and nothing a test does can reach the learner's
 * real progress folder. The dir is removed when the test process exits.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { TEST_EMU_NAME, TEST_EMU_PORT } from '../shared/ports'

const dir = mkdtempSync(path.join(tmpdir(), 'cloud-dojo-test-'))
process.env.CLOUD_DOJO_DATA_DIR = dir
delete process.env.ACADEMY_DATA_DIR
process.env.CLOUD_DOJO_EMULATOR_NAME = TEST_EMU_NAME
process.env.CLOUD_DOJO_EMULATOR_PORT = String(TEST_EMU_PORT)
process.env.AWS_ENDPOINT_URL = `https://127.0.0.1:${TEST_EMU_PORT}`
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* best effort */ } })
