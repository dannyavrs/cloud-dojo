/**
 * Runs a command with CLOUD_DOJO_DATA_DIR pointing at a fresh mkdtemp folder, then removes it.
 * Used by `bun run test:e2e` and `bun run capture`, so neither can touch the learner's real
 * progress in ~/.cloud-dojo (or the pre-rename folder).
 *   bun scripts/with-temp-data.ts <command> [args...]
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const cmd = process.argv.slice(2)
if (!cmd.length) { console.error('usage: with-temp-data.ts <command> [args...]'); process.exit(2) }

const dir = mkdtempSync(path.join(tmpdir(), 'cloud-dojo-run-'))
const env: Record<string, string | undefined> = { ...process.env, CLOUD_DOJO_DATA_DIR: dir }
delete env.ACADEMY_DATA_DIR
console.log(`[dojo] temp data dir ${dir}`)
const child = Bun.spawn(cmd, { stdout: 'inherit', stderr: 'inherit', stdin: 'inherit', env })
const forward = (sig: NodeJS.Signals) => () => child.kill(sig)
process.on('SIGINT', forward('SIGINT'))
process.on('SIGTERM', forward('SIGTERM'))
const code = await child.exited
rmSync(dir, { recursive: true, force: true })
process.exit(code)
