/** Shared helpers for the end-to-end scripts (core + per-track M2 files). */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Dojo } from '../server/app'
import { lessonById } from '../shared/lessons'

export const A = '000000000000'
export const q = (n: string) => `https://sqs.us-east-1.amazonaws.com/${A}/${n}`
export const sleep = (ms: number) => Bun.sleep(ms)
export const log = (...a: unknown[]) => console.log(...a)

export function makeKit(app: Dojo) {
  async function sh(id: string, cmd: string, expectFail = false) {
    const r = await app.run(id, cmd)
    const bad = expectFail ? r.exitCode === 0 : r.exitCode !== 0
    log(`  ${bad ? 'XX' : 'ok'} $ ${cmd.slice(0, 110)}${r.exitCode ? `\n       ↳ ${r.stderr.trim().split('\n').pop()?.slice(0, 240)}` : ''}`)
    if (bad) throw new Error(`unexpected result for: ${cmd}`)
    return r
  }
  /** The exact command text a learner sees in a step. */
  const C = (id: string, step: string, i = 0) => {
    const c = lessonById(id)!.steps.find((s) => s.id === step)?.commands?.[i]
    if (!c) throw new Error(`no command ${i} in step ${step} of ${id}`)
    return c
  }
  const code = (id: string, step: string) => lessonById(id)!.steps.find((s) => s.id === step)!.code!.text
  const read = (id: string, name: string) => readFileSync(path.join(app.ctx(id).workdir, name), 'utf8')
  /** What the in-app editor does: PUT the whole file. */
  const edit = (id: string, name: string, f: (t: string) => string) => {
    const r = app.writeFile(id, name, f(read(id, name)))
    if (!r.ok) throw new Error(r.error)
    return r.rebuilt
  }
  const json = (r: { stdout: string }) => JSON.parse(r.stdout)
  const sub = (cmd: string, vars: Record<string, string>) => Object.entries(vars).reduce((c, [k, v]) => c.replaceAll(`<${k}>`, v), cmd)
  return { app, sh, C, code, read, edit, json, sub, A, q, sleep, log }
}
export type E2E = ReturnType<typeof makeKit>
/** A per-module end-to-end solution: replays the learner's real commands. */
export type E2EScript = (id: string, k: E2E) => Promise<void>
