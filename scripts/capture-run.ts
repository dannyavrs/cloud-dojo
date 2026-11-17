/**
 * One-command capture: builds the UI, starts the server on a temp data dir (fresh, empty progress),
 * runs capture.ts against it, then stops the server. Invoked via `bun run capture` through with-temp-data.ts.
 */
import { DEFAULT_API_PORT, TEST_API_PORT } from '../shared/ports'
const PORT = String(process.env.PORT ?? TEST_API_PORT)
if (Number(PORT) === DEFAULT_API_PORT) { console.error(`Refusing to capture on port ${PORT}: it is reserved for your real session. Use the default (${TEST_API_PORT}).`); process.exit(2) }
const base = `http://127.0.0.1:${PORT}`
// Never capture from a server that is already there: it would not be the throwaway one this run starts.
if (await fetch(`${base}/api/status`).then((r) => r.ok).catch(() => false)) { console.error(`Something already answers on ${base}. Stop it (or set PORT) and retry.`); process.exit(2) }
const build = Bun.spawn(['bun', '--bun', 'run', 'build'], { stdout: 'inherit', stderr: 'inherit' })
if ((await build.exited) !== 0) process.exit(1)
const server = Bun.spawn(['bun', 'server/index.ts'], { stdout: 'inherit', stderr: 'inherit', env: { ...process.env, PORT } })
try {
  for (let i = 0; i < 60; i++) { if (await fetch(`${base}/api/status`).then((r) => r.ok).catch(() => false)) break; await Bun.sleep(500) }
  const cap = Bun.spawn(['bun', 'scripts/capture.ts'], { stdout: 'inherit', stderr: 'inherit', env: { ...process.env, BASE: base } })
  process.exitCode = await cap.exited
} finally {
  server.kill('SIGTERM')
  await server.exited
}
