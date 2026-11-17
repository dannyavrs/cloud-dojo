/**
 * One-command capture: builds the UI, starts the server on a temp data dir (fresh, empty progress),
 * runs capture.ts against it, then stops the server. Invoked via `bun run capture` through with-temp-data.ts.
 */
const PORT = process.env.PORT ?? '4747'
const base = `http://127.0.0.1:${PORT}`
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
