import { existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { parseCredentialsFile, type EmuInfo } from './env'
import { emulatorConflict } from './info'
import { CONTAINER, EMULATOR_VERSION, EMU_HOST_DIR, EMU_PORT, IMAGE, APP_DIR } from './paths'

/** The emulator always listens on 9297 inside the container; it names its generated files after that port. */
const INTERNAL_PORT = '9297'

export type Phase = 'starting' | 'docker-missing' | 'building-image' | 'booting' | 'ready' | 'stopped' | 'error'
export interface EmuStatus {
  phase: Phase
  message: string
  version: string
  endpoint: string
  startedAt?: number
  bootMs?: number
}

async function sh(cmd: string[], opts: { quiet?: boolean } = {}): Promise<{ code: number; out: string; err: string }> {
  const p = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
  const code = await p.exited
  if (code !== 0 && !opts.quiet) console.error(`[emulator] ${cmd.slice(0, 3).join(' ')} → ${code}: ${err.slice(0, 300)}`)
  return { code, out, err }
}

export class EmulatorManager {
  status: EmuStatus = { phase: 'starting', message: 'Not started', version: EMULATOR_VERSION, endpoint: `https://127.0.0.1:${EMU_PORT}` }
  info?: EmuInfo
  /** bumped on every (re)start so cached SDK clients know to rebuild */
  generation = 0
  private busy?: Promise<void>

  private set(phase: Phase, message: string, extra: Partial<EmuStatus> = {}) {
    this.status = { ...this.status, phase, message, ...extra }
  }

  /** Ensure docker works, the pinned image exists, and a healthy container is running. */
  ensureReady(): Promise<void> {
    this.busy ??= this.boot().finally(() => (this.busy = undefined))
    return this.busy
  }

  /** The only clean reset the emulator supports: throw the container away and start a new one. */
  restart(): Promise<void> {
    this.busy ??= this.boot(true).finally(() => (this.busy = undefined))
    return this.busy
  }

  private assertIsolated() {
    const problem = emulatorConflict(CONTAINER, EMU_PORT)
    if (problem) {
      this.set('error', problem)
      throw new Error(problem)
    }
  }

  private async boot(forceFresh = false) {
    const t0 = Date.now()
    try {
      this.assertIsolated()
      const v = await sh(['docker', 'version', '--format', '{{.Server.Version}}'], { quiet: true })
      if (v.code !== 0) {
        this.set('docker-missing', 'Docker is not running. Start Docker Desktop (or OrbStack/Colima) and reload.')
        throw new Error('docker unavailable')
      }
      const img = await sh(['docker', 'image', 'inspect', IMAGE], { quiet: true })
      if (img.code !== 0) {
        this.set('building-image', `Building ${IMAGE} (first run only, downloads the emulator package)…`)
        const b = await sh(['docker', 'build', '--platform', 'linux/arm64', '-t', IMAGE, path.join(APP_DIR, 'emulator')])
        if (b.code !== 0) {
          this.set('error', `docker build failed: ${b.err.slice(-300)}`)
          throw new Error('build failed')
        }
      }
      if (!forceFresh) {
        const running = await sh(['docker', 'inspect', '-f', '{{.State.Running}}', CONTAINER], { quiet: true })
        if (running.out.trim() === 'true' && (await this.tryAttach())) return
      }
      this.set('booting', forceFresh ? 'Fresh cloud: restarting the emulator…' : 'Starting the emulator…')
      console.log(`[emulator] starting ${CONTAINER} on 127.0.0.1:${EMU_PORT} (image ${IMAGE})`)
      await sh(['docker', 'rm', '-f', CONTAINER], { quiet: true })
      rmSync(path.join(EMU_HOST_DIR, INTERNAL_PORT), { recursive: true, force: true })
      mkdirSync(EMU_HOST_DIR, { recursive: true })
      const run = await sh([
        'docker', 'run', '-d', '--name', CONTAINER,
        '--memory=2g', '--memory-swap=2g',
        '-p', `127.0.0.1:${EMU_PORT}:9297`,
        '-v', `${EMU_HOST_DIR}:/home/emulator/.aws/emulator`,
        IMAGE, '-p', '9297', '--telemetry', 'off',
      ])
      if (run.code !== 0) {
        this.set('error', `docker run failed: ${run.err.slice(-300)}`)
        throw new Error('run failed')
      }
      const deadline = Date.now() + 60_000
      while (Date.now() < deadline) {
        if (await this.tryAttach()) {
          const bootMs = Date.now() - t0
          this.set('ready', `Emulator ${EMULATOR_VERSION} ready`, { startedAt: Date.now(), bootMs })
          return
        }
        await Bun.sleep(250)
      }
      this.set('error', 'The emulator did not become healthy within 60s.')
      throw new Error('health timeout')
    } catch (e) {
      if (this.status.phase !== 'docker-missing' && this.status.phase !== 'error') this.set('error', String(e))
      throw e
    }
  }

  /** Read this run's generated keys + cert, then hit the health route with that cert as the only trust anchor. */
  private async tryAttach(): Promise<boolean> {
    const dir = path.join(EMU_HOST_DIR, INTERNAL_PORT)
    const caPath = path.join(dir, 'ca.pem')
    const credsPath = path.join(dir, 'emulator_credentials')
    if (!existsSync(caPath) || !existsSync(credsPath)) return false
    try {
      const res = await fetch(`https://127.0.0.1:${EMU_PORT}/__admin/health`, { tls: { ca: readFileSync(caPath, 'utf8') }, signal: AbortSignal.timeout(1500) })
      if (!res.ok) return false
      const creds = parseCredentialsFile(readFileSync(credsPath, 'utf8'))
      this.info = { endpoint: `https://127.0.0.1:${EMU_PORT}`, caPath, credsPath, ...creds }
      this.generation++
      this.set('ready', `Emulator ${EMULATOR_VERSION} ready`, { startedAt: this.status.startedAt ?? Date.now() })
      return true
    } catch {
      return false
    }
  }

  async stop() {
    this.assertIsolated()
    console.log(`[emulator] stopping ${CONTAINER}`)
    await sh(['docker', 'rm', '-f', CONTAINER], { quiet: true })
    this.info = undefined
    this.set('stopped', 'Emulator stopped')
  }
}
