// Starts the Bun API server (owns the emulator container) and the Vite dev server together.
// Ports come from PORT / WEB_PORT (defaults 4747 / 5173; `bun run dev:test` moves both to the test pair).
const procs = [
  Bun.spawn(['bun', 'server/index.ts'], { stdout: 'inherit', stderr: 'inherit', env: process.env }),
  Bun.spawn(['bunx', '--bun', 'vite'], { stdout: 'inherit', stderr: 'inherit', env: process.env }),
]
const stop = () => { for (const p of procs) p.kill('SIGINT') }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
await Promise.race(procs.map((p) => p.exited))
stop()
