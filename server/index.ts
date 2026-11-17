import { existsSync } from 'node:fs'
import path from 'node:path'
import { Dojo } from './app'
import { migrateOnBoot } from './data-migration'
import { makeServerInfo, portConflict, emulatorConflict } from './info'
import { APP_DIR, CONTAINER, EMU_PORT } from './paths'
import { tutorStatus } from './llm'
import { LESSONS } from '../shared/lessons'
import { DEFAULT_API_PORT } from '../shared/ports'
import { TRACKS } from '../shared/tracks'
import { examModeInfo, gradeExamMode, startExamMode } from './exam-mode'
import { parseImport } from './progress-io'
import { handleTutor, handleTutorTest } from './tutor'
import { handleDashboard } from './dashboard-api'

const PORT = Number(process.env.PORT ?? DEFAULT_API_PORT)
const conflict = portConflict(PORT) ?? emulatorConflict()
if (conflict) { console.error(`[dojo] ${conflict}`); process.exit(2) }
migrateOnBoot()
const app = new Dojo(() => tutorStatus(new Headers(), process.env))
const info = makeServerInfo(PORT)

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
const fail = (e: unknown, status = 500) => json({ error: e instanceof Error ? e.message : String(e) }, status)

// boot the emulator in the background so the UI can show progress
app.emu.ensureReady().then(() => app.warm()).catch((e) => console.error('[dojo] emulator not ready:', e instanceof Error ? e.message : e))

const dist = path.join(APP_DIR, 'dist')

Bun.serve({
  hostname: '127.0.0.1',
  port: PORT,
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url)
    const p = url.pathname
    // The server can run commands: refuse cross-site browser requests.
    if (req.method !== 'GET' && req.headers.get('origin') && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.get('origin')!)) return json({ error: 'forbidden origin' }, 403)
    try {
      if (p === '/api/status') return json({ ...app.status(), tutor: tutorStatus(req.headers, process.env), server: info })
      if (p === '/api/info') return json(info)
      if (p === '/api/map') return json(await app.map())
      if (p.startsWith('/api/dashboard/')) return handleDashboard(() => app.c, p.slice('/api/dashboard/'.length))
      if (p === '/api/capabilities') return json(app.capabilities ?? { pending: true, probing: app.probing })
      if (p === '/api/progress') return json(app.progressView())
      if (p === '/api/progress/export') return json(app.progress.exportData())
      if (p === '/api/progress/import' && req.method === 'POST') {
        if (Number(req.headers.get('content-length') ?? 0) > 2_000_000) return json({ error: 'file too large' }, 413)
        const body = (await req.json().catch(() => null)) as { mode?: string; data?: unknown } | null
        if (!body || (body.mode !== 'merge' && body.mode !== 'replace')) return json({ error: 'mode must be merge or replace' }, 400)
        const parsed = parseImport(body.data, { modules: new Set(LESSONS.map((l) => l.id)), tracks: new Set(TRACKS.map((x) => x.id)) })
        if (!parsed.ok) return json({ error: `Not a valid progress export: ${parsed.error}` }, 400)
        const summary = app.progress.importData(parsed.data, body.mode)
        return json({ ok: true, mode: body.mode, skipped: parsed.skipped, settings: parsed.settings, ...summary })
      }
      if (p === '/api/exam-mode/info') return json(examModeInfo(TRACKS, app.progress.view(LESSONS, TRACKS).examAttempts))
      if (p === '/api/exam-mode/start' && req.method === 'POST') {
        const r = startExamMode(TRACKS, (await req.json().catch(() => ({}))) as never)
        return 'error' in r ? json(r, 400) : json(r)
      }
      if (p === '/api/exam-mode/submit' && req.method === 'POST') {
        const body = (await req.json().catch(() => ({}))) as { id?: unknown; answers?: Record<string, unknown> }
        const r = gradeExamMode(TRACKS, body.id, body.answers && typeof body.answers === 'object' ? body.answers : {})
        if ('error' in r) return json(r, 400)
        app.progress.recordAttempt(r.attempt)
        return json(r)
      }
      let t = p.match(/^\/api\/progress\/([\w-]+)\/complete$/)
      if (t && req.method === 'POST') {
        if (!app.lessonExists(t[1])) return json({ error: 'unknown lesson' }, 404)
        const body = (await req.json().catch(() => ({}))) as { undo?: unknown }
        return json({ ok: true, module: app.progress.setComplete(t[1], body.undo !== true) })
      }
      t = p.match(/^\/api\/progress\/([\w-]+)\/tick$/)
      if (t && req.method === 'POST') {
        if (!app.lessonExists(t[1])) return json({ error: 'unknown lesson' }, 404)
        const body = (await req.json().catch(() => ({}))) as { seconds?: number }
        app.progress.tick(t[1], Number(body.seconds))
        return json({ ok: true })
      }
      t = p.match(/^\/api\/quiz\/([\w-]+)\/predict$/)
      if (t && req.method === 'POST') {
        const body = (await req.json().catch(() => ({}))) as { qid?: string; choice?: number }
        const r = typeof body.qid === 'string' ? app.predict(t[1], body.qid, body.choice) : null
        return r ? json(r) : json({ error: 'unknown question' }, 404)
      }
      t = p.match(/^\/api\/quiz\/([\w-]+)\/exam$/)
      if (t && req.method === 'POST') {
        const body = (await req.json().catch(() => ({}))) as { answers?: Record<string, number> }
        const g = app.exam(t[1], body.answers && typeof body.answers === 'object' ? body.answers : {})
        return g ? json(g) : json({ error: 'no exam for this track' }, 404)
      }
      if (p === '/api/emulator/retry' && req.method === 'POST') { app.emu.ensureReady().catch(() => undefined); return json({ ok: true }) }
      let m = p.match(/^\/api\/lessons\/([\w-]+)\/(\w+)$/)
      if (m) {
        const [, id, action] = m
        if (!app.lessonExists(id)) return json({ error: 'unknown lesson' }, 404)
        if (action === 'start' && req.method === 'POST') {
          const body = (await req.json().catch(() => ({}))) as { fresh?: boolean }
          return json(await app.startLesson(id, { fresh: Boolean(body.fresh) }))
        }
        if (action === 'checks') return json(await app.checks(id, url.searchParams.get('probe') === '1'))
        if (action === 'files') return json({ files: app.files(id) })
        if (action === 'history') return json(app.history(id))
        if (action === 'run' && req.method === 'POST') {
          const body = (await req.json()) as { command?: string }
          if (typeof body.command !== 'string' || body.command.length > 4000) return json({ error: 'bad command' }, 400)
          return json(await app.run(id, body.command))
        }
        if (action === 'http' && req.method === 'POST') {
          return json(await app.probeHttp(id, (await req.json().catch(() => ({}))) as never))
        }
        if (action === 'showme' && req.method === 'POST') return json(await app.showMe())
      }
      m = p.match(/^\/api\/lessons\/([\w-]+)\/files\/([^/]+)$/)
      if (m && req.method === 'PUT') {
        const body = (await req.json().catch(() => ({}))) as { text?: string }
        const r = app.writeFile(m[1], decodeURIComponent(m[2]), String(body.text ?? ''))
        return r.ok ? json({ ok: true, rebuilt: r.rebuilt, files: app.files(m[1]) }) : json({ error: r.error }, 400)
      }
      if (m) {
        const f = app.readFile(m[1], decodeURIComponent(m[2]))
        return f ? json(f) : json({ error: 'not found' }, 404)
      }
      if (p === '/api/tutor/test' && req.method === 'POST') return handleTutorTest(req, { env: () => process.env })
      if (p === '/api/tutor' && req.method === 'POST') {
        return handleTutor(req, {
          env: () => process.env,
          getState: async (id) => ({
            checks: await app.checks(id, false).catch(() => []),
            history: app.history(id).map((r) => ({ ...r })),
            map: await app.map(),
          }),
        })
      }
      if (p.startsWith('/api/')) return json({ error: 'not found' }, 404)
      // production: serve the built SPA
      if (existsSync(dist)) {
        const f = Bun.file(path.join(dist, p === '/' ? 'index.html' : p))
        if (await f.exists() && !p.includes('..')) return new Response(f)
        return new Response(Bun.file(path.join(dist, 'index.html')))
      }
      return new Response('Cloud Dojo API is running. Start the UI with `bun run dev`.', { status: 200 })
    } catch (e) {
      return fail(e)
    }
  },
})
console.log(`[dojo] server on http://127.0.0.1:${PORT} (instance ${info.instanceId.slice(0, 8)}, emulator ${CONTAINER} :${EMU_PORT})`)
process.on('SIGINT', async () => { await app.emu.stop(); process.exit(0) })
process.on('SIGTERM', async () => { await app.emu.stop(); process.exit(0) })
