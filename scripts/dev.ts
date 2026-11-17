// Starts the Bun API server (owns the emulator container) and the Vite dev server together.
const procs = [
  Bun.spawn(['bun', 'server/index.ts'], { stdout: 'inherit', stderr: 'inherit', env: process.env }),
  Bun.spawn(['bunx', '--bun', 'vite'], { stdout: 'inherit', stderr: 'inherit', env: process.env }),
]
const stop = () => { for (const p of procs) p.kill('SIGINT') }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
await Promise.race(procs.map((p) => p.exited))
stop()
