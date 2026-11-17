import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { CheckResult } from '../shared/types'
import type { Clients } from './clients'
import type { EmuInfo } from './env'
import type { RunResult } from './runner'
import { WORK_ROOT } from './paths'
import { makeZip } from './zip'

/** One call made from the in-app HTTP probe panel (emulator origin only). */
export interface ProbeRecord { url: string; method: string; status: number; body: string; at: number }

export interface Ctx {
  c: Clients
  emu: EmuInfo
  workdir: string
  history: RunResult[]
  lessonId: string
  /** Calls the learner made from the HTTP probe panel in this module (newest last). */
  probes: ProbeRecord[]
  /** GET against the emulator origin only (trusts the emulator CA for this one connection). */
  httpGet(url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }): Promise<{ status: number; body: string; headers: Record<string, string> }>
}

export interface LessonServer {
  id: string
  /** Text files written into the lesson working folder on start. */
  files?: Record<string, string>
  /** zip name -> { file name inside zip: contents } */
  zips?: Record<string, Record<string, string>>
  fixture?(ctx: Ctx): Promise<void>
  check(ctx: Ctx, opts: { probe: boolean }): Promise<CheckResult[]>
}

export const workdirFor = (id: string) => path.join(WORK_ROOT, id)

export function writeStarterFiles(dir: string, l: LessonServer) {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  for (const [n, t] of Object.entries(l.files ?? {})) writeFileSync(path.join(dir, n), t)
  for (const [n, f] of Object.entries(l.zips ?? {})) writeFileSync(path.join(dir, n), makeZip(f))
}

export const listFiles = (dir: string) => { try { return readdirSync(dir).sort() } catch { return [] } }

/** Run an async probe; any thrown error means "false". */
export async function ok(fn: () => Promise<unknown>): Promise<boolean> {
  try { return Boolean(await fn()) } catch { return false }
}

export const ACCOUNT = '000000000000'
export const arn = {
  queue: (n: string) => `arn:aws:sqs:us-east-1:${ACCOUNT}:${n}`,
  topic: (n: string) => `arn:aws:sns:us-east-1:${ACCOUNT}:${n}`,
  table: (n: string) => `arn:aws:dynamodb:us-east-1:${ACCOUNT}:table/${n}`,
  role: (n: string) => `arn:aws:iam::${ACCOUNT}:role/${n}`,
  fn: (n: string) => `arn:aws:lambda:us-east-1:${ACCOUNT}:function:${n}`,
}
export const queueUrl = (n: string) => `https://sqs.us-east-1.amazonaws.com/${ACCOUNT}/${n}`

export const LAMBDA_TRUST = JSON.stringify({
  Version: '2012-10-17',
  Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
}, null, 2)

export function item(id: string, label: string, pass: boolean | null, hint: string, detail?: string): CheckResult {
  return { id, label, pass, hint: pass ? undefined : hint, detail }
}

export function historyHas(h: RunResult[], re: RegExp, where: 'stdout' | 'stderr' | 'command' = 'command', exit?: 'ok' | 'fail') {
  return h.some((r) => re.test(r[where]) && (exit === undefined || (exit === 'ok' ? r.exitCode === 0 : r.exitCode !== 0)))
}

/** A command that exited 0, matched `cmd`, and (optionally) printed something that satisfies `out`. */
export const ranOk = (h: RunResult[], cmd: RegExp, out?: (stdout: string) => boolean) =>
  h.some((r) => !r.rejected && r.exitCode === 0 && cmd.test(r.command) && (!out || out(r.stdout)))

/** A command that failed with a stderr matching `err`. */
export const ranFail = (h: RunResult[], cmd: RegExp, err: RegExp) =>
  h.some((r) => !r.rejected && r.exitCode !== 0 && cmd.test(r.command) && err.test(r.stderr))
