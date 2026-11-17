/**
 * Runs a command with CLOUD_DOJO_DATA_DIR pointing at a fresh mkdtemp folder, then removes it.
 * Used by `bun run test:e2e` and `bun run capture`, so neither can touch the learner's real
 * progress in ~/.cloud-dojo (or the pre-rename folder). It also moves every child onto the dedicated test ports
 * (API 4848, Vite 5274) and a dedicated emulator (`cloud-dojo-emulator-test` on 9298), so a test
 * run can never take over the learner's 4747/5173 session or wipe their live lab on 9297.
 *   bun scripts/with-temp-data.ts <command> [args...]
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DEFAULT_EMU_NAME, DEFAULT_EMU_PORT, TEST_API_PORT, TEST_EMU_NAME, TEST_EMU_PORT, TEST_WEB_PORT } from '../shared/ports'

const cmd = process.argv.slice(2)
if (!cmd.length) { console.error('usage: with-temp-data.ts <command> [args...]'); process.exit(2) }

const emuName = process.env.CLOUD_DOJO_EMULATOR_NAME ?? TEST_EMU_NAME
const emuPort = Number(process.env.CLOUD_DOJO_EMULATOR_PORT ?? TEST_EMU_PORT)
if (emuName === DEFAULT_EMU_NAME || emuPort === DEFAULT_EMU_PORT) {
  console.error(`Refusing to run: test mode cannot use the learner's emulator (${DEFAULT_EMU_NAME} on port ${DEFAULT_EMU_PORT}).
Use CLOUD_DOJO_EMULATOR_NAME=${TEST_EMU_NAME} and CLOUD_DOJO_EMULATOR_PORT=${TEST_EMU_PORT}.`)
  process.exit(2)
}

const dir = mkdtempSync(path.join(tmpdir(), 'cloud-dojo-run-'))
const env: Record<string, string | undefined> = {
  ...process.env,
  CLOUD_DOJO_DATA_DIR: dir,
  PORT: String(TEST_API_PORT),
  WEB_PORT: String(TEST_WEB_PORT),
  CLOUD_DOJO_EMULATOR_NAME: emuName,
  CLOUD_DOJO_EMULATOR_PORT: String(emuPort),
  AWS_ENDPOINT_URL: `https://127.0.0.1:${emuPort}`,
}
delete env.ACADEMY_DATA_DIR
console.log(`[dojo] temp data dir ${dir} (API :${TEST_API_PORT}, web :${TEST_WEB_PORT}, emulator ${emuName} :${emuPort})`)
const child = Bun.spawn(cmd, { stdout: 'inherit', stderr: 'inherit', stdin: 'inherit', env })
const forward = (sig: NodeJS.Signals) => () => child.kill(sig)
process.on('SIGINT', forward('SIGINT'))
process.on('SIGTERM', forward('SIGTERM'))
const code = await child.exited
rmSync(dir, { recursive: true, force: true })
process.exit(code)
