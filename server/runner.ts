import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { buildChildEnv, type EmuInfo } from './env'
import { AWS_CONFIG_PATH, CHILD_HOME, DATA_DIR } from './paths'

export type ParsedCommand =
  | { ok: true; argv: string[]; env: Record<string, string> }
  | { ok: false; error: string }

const ALLOWED_ENV = new Set(['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'])
const FORBIDDEN_FLAGS = ['--profile', '--endpoint-url', '--no-verify-ssl', '--ca-bundle', '--cli-auto-prompt', '--debug']
const FORBIDDEN_SERVICES = new Set(['sso', 'login', 'logout', 'help', 'history', 'wizard', 'cli-dev', 'login-session'])
const META = new Set(['|', '&', ';', '<', '>', '(', ')', '`', '$', '\n', '\r'])

/** Minimal POSIX-ish tokenizer. No expansion of any kind: quotes group, nothing else is interpreted. */
export function tokenize(line: string): { tokens: string[] } | { error: string } {
  const tokens: string[] = []
  let cur = ''
  let has = false
  let i = 0
  while (i < line.length) {
    const c = line[i]
    if (c === "'") {
      const end = line.indexOf("'", i + 1)
      if (end < 0) return { error: 'Unclosed single quote.' }
      cur += line.slice(i + 1, end)
      has = true
      i = end + 1
    } else if (c === '"') {
      i++
      let closed = false
      while (i < line.length) {
        if (line[i] === '\\' && (line[i + 1] === '"' || line[i + 1] === '\\')) {
          cur += line[i + 1]
          i += 2
        } else if (line[i] === '"') {
          closed = true
          i++
          break
        } else cur += line[i++]
      }
      if (!closed) return { error: 'Unclosed double quote.' }
      has = true
    } else if (c === ' ' || c === '\t') {
      if (has) tokens.push(cur)
      cur = ''
      has = false
      i++
    } else if (META.has(c)) {
      return { error: `Shell syntax (${c === '\n' ? 'newline' : c}) is not supported: the runner starts \`aws\` directly, with no shell. Run one aws command at a time.` }
    } else {
      cur += c
      has = true
      i++
    }
  }
  if (has) tokens.push(cur)
  return { tokens }
}

export function parseCommand(line: string, workdir: string): ParsedCommand {
  const t = tokenize(line.trim())
  if ('error' in t) return { ok: false, error: t.error }
  const tokens = [...t.tokens]
  const env: Record<string, string> = {}
  while (tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) {
    const eq = tokens[0].indexOf('=')
    const k = tokens[0].slice(0, eq)
    const v = tokens[0].slice(eq + 1)
    if (!ALLOWED_ENV.has(k)) return { ok: false, error: `Only AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_SESSION_TOKEN may be set inline (got ${k}).` }
    if (k === 'AWS_ACCESS_KEY_ID' && !v.startsWith('EMULATOR')) {
      return { ok: false, error: 'Only emulator access keys (starting with EMULATOR) can be used here. Real AWS keys are never accepted by this app.' }
    }
    env[k] = v
    tokens.shift()
  }
  if (tokens[0] !== 'aws') return { ok: false, error: 'Only `aws ...` commands run here (optionally prefixed by AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=…).' }
  const argv = tokens.slice(1)
  if (!argv.length) return { ok: false, error: 'Add a service and operation, e.g. `aws sts get-caller-identity`.' }
  for (const a of argv) {
    const flag = a.split('=')[0]
    if (FORBIDDEN_FLAGS.includes(flag)) {
      return { ok: false, error: `${flag} is refused: this runner always talks to AWS Emulator with its own credentials, so profiles, endpoint overrides and TLS bypasses are not allowed.` }
    }
  }
  const service = argv.find((a) => !a.startsWith('-'))
  if (service && FORBIDDEN_SERVICES.has(service)) return { ok: false, error: `\`aws ${service}\` is not available in the runner.` }
  if (service === 'configure' && argv[argv.indexOf('configure') + 1] !== 'list') {
    return { ok: false, error: 'Only `aws configure list` is available (it would otherwise edit config files).' }
  }
  for (const a of argv) {
    const value = a.startsWith('file://') ? a.slice(7) : a.startsWith('fileb://') ? a.slice(8) : a
    const looksPath = a.startsWith('file') ? value !== a : true
    if (!looksPath) continue
    if (/(^|\/)\.\.(\/|$)/.test(value)) return { ok: false, error: 'Paths may not contain `..`. Files live in this lesson\'s working folder.' }
    if (value.startsWith('/') && !value.startsWith('/aws/') && existsSync(value) && !path.resolve(value).startsWith(workdir)) {
      return { ok: false, error: 'That path is outside the lesson working folder.' }
    }
    if (value !== a && value.startsWith('/') && !path.resolve(value).startsWith(workdir)) {
      return { ok: false, error: 'file:// paths must be inside the lesson working folder (use a relative path).' }
    }
    if (a.startsWith('~')) return { ok: false, error: '`~` is not expanded here. Use a relative path inside the lesson working folder.' }
  }
  return { ok: true, argv, env }
}

export function ensureChildDirs() {
  mkdirSync(CHILD_HOME, { recursive: true })
  mkdirSync(DATA_DIR, { recursive: true })
  if (!existsSync(AWS_CONFIG_PATH)) writeFileSync(AWS_CONFIG_PATH, '[default]\nregion = us-east-1\noutput = json\n')
}

export interface RunResult {
  command: string
  exitCode: number
  stdout: string
  stderr: string
  ms: number
  rejected?: boolean
  at: number
}

const MAX_OUT = 64 * 1024

export function findAws(): string {
  return Bun.which('aws') ?? '/opt/homebrew/bin/aws'
}

export async function runAws(line: string, emu: EmuInfo, workdir: string, awsBin = findAws()): Promise<RunResult> {
  const at = Date.now()
  const parsed = parseCommand(line, workdir)
  if (!parsed.ok) return { command: line, exitCode: 126, stdout: '', stderr: parsed.error, ms: 0, rejected: true, at }
  ensureChildDirs()
  mkdirSync(workdir, { recursive: true })
  const proc = Bun.spawn([awsBin, ...parsed.argv], {
    cwd: workdir,
    env: buildChildEnv(emu, parsed.env),
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const killer = setTimeout(() => proc.kill(), 60_000)
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const code = await proc.exited
  clearTimeout(killer)
  const cap = (s: string) => (s.length > MAX_OUT ? s.slice(0, MAX_OUT) + '\n… output truncated' : s)
  return { command: line, exitCode: code, stdout: cap(out), stderr: cap(err), ms: Date.now() - at, at }
}
