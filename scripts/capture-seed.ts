/**
 * Helpers for capture.ts: replay a module's real e2e solution through the running server's HTTP API
 * (same runner, same checker as the UI) so screenshots show true green states.
 * Run capture with the same env (CLOUD_DOJO_DATA_DIR, EMULATOR_PORT) as the server.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { makeClients } from '../server/clients'
import { parseCredentialsFile } from '../server/env'
import { EMU_HOST_DIR, EMU_PORT, WORK_ROOT } from '../server/paths'
import { makeKit, type E2EScript } from './e2e-kit'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4747'
const post = (p: string, body?: unknown) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).then((r) => r.json())

export async function capturePrelude() {
  // wait for the emulator to be ready
  for (let i = 0; i < 240; i++) {
    const s = await fetch(`${BASE}/api/status`).then((r) => r.json()).catch(() => null) as { phase?: string } | null
    if (s?.phase === 'ready') return
    await Bun.sleep(1000)
  }
  throw new Error('emulator not ready')
}

function emuInfo() {
  const dir = path.join(EMU_HOST_DIR, '9297')
  const creds = parseCredentialsFile(readFileSync(path.join(dir, 'emulator_credentials'), 'utf8'))
  return { endpoint: `https://127.0.0.1:${EMU_PORT}`, caPath: path.join(dir, 'ca.pem'), credsPath: path.join(dir, 'emulator_credentials'), ...creds }
}

/** An Dojo look-alike backed by the HTTP API, enough for the e2e kit. */
function httpApp() {
  const info = emuInfo()
  const c = makeClients(info)
  return {
    emu: { info },
    c,
    run: (id: string, command: string) => post(`/api/lessons/${id}/run`, { command }),
    // synchronous on purpose: the e2e kit's edit() is sync (curl keeps this file dependency-free)
    writeFile: (id: string, name: string, text: string) => {
      const r = Bun.spawnSync(['curl', '-s', '-X', 'PUT', '-H', 'content-type: application/json', '--data-binary', '@-', `${BASE}/api/lessons/${id}/files/${encodeURIComponent(name)}`], { stdin: new TextEncoder().encode(JSON.stringify({ text })) })
      const j = JSON.parse(r.stdout.toString() || '{}') as { ok?: boolean; error?: string; rebuilt?: boolean }
      return j.ok ? { ok: true, rebuilt: j.rebuilt } : { ok: false, error: j.error ?? 'write failed' }
    },
    probeHttp: (id: string, input: unknown) => post(`/api/lessons/${id}/http`, input),
    checks: (id: string, probe: boolean) => fetch(`${BASE}/api/lessons/${id}/checks?probe=${probe ? 1 : 0}`).then((r) => r.json()),
    ctx: (id: string) => ({ workdir: path.join(WORK_ROOT, id) }),
    showMe: () => post('/api/lessons/capstone/showme'),
  }
}

export async function seedModule(id: string, scripts: Record<string, E2EScript>) {
  const script = scripts[id]
  if (!script) throw new Error(`no e2e script for ${id}`)
  const app = httpApp()
  const kit = makeKit(app as never)
  await script(id, kit)
}
