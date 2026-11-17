import type { E2E, E2EScript } from './e2e-kit'

/** Replay a step command with <PLACEHOLDER> substitution, exactly as the learner would paste it. */
const step = (k: E2E, id: string, s: string, i = 0, vars: Record<string, string> = {}, fail = false) => k.sh(id, k.sub(k.C(id, s, i), vars), fail)
const pair = (r: { stdout: string }, a: string, b: string) => {
  const [x, y] = r.stdout.trim().split(/\s+/)
  return { [a]: x, [b]: y }
}
const triple = (r: { stdout: string }) => {
  const [a, b, c] = r.stdout.trim().split(/\s+/)
  return { ROLE_KEY_ID: a, ROLE_SECRET: b, ROLE_TOKEN: c }
}

export const IAM_E2E: Record<string, E2EScript> = {
  'iam-evaluation': async (id, k) => {
    await step(k, id, 'allow')
    const v = pair(await step(k, id, 'key'), 'KEY_ID', 'SECRET')
    await step(k, id, 'before', 0, v)
    await step(k, id, 'deny')
    await k.sleep(1000)
    await step(k, id, 'break', 0, v, true)
    await step(k, id, 'read', 0, v)
    await step(k, id, 'sim')
  },

  'iam-conditions': async (id, k) => {
    await step(k, id, 'policy')
    const v = pair(await step(k, id, 'key'), 'KEY_ID', 'SECRET')
    await step(k, id, 'ok', 0, v)
    await step(k, id, 'break', 0, v, true)
    await step(k, id, 'noprefix', 0, v, true)
    await step(k, id, 'sim', 0)
    await step(k, id, 'sim', 1)
    await step(k, id, 'ip', 0)
    await step(k, id, 'ip', 1)
  },

  'iam-roles-sts': async (id, k) => {
    await step(k, id, 'role')
    await step(k, id, 'rolepol')
    await step(k, id, 'devpol')
    const v = pair(await step(k, id, 'key'), 'KEY_ID', 'SECRET')
    await k.sleep(1000)
    const t = triple(await step(k, id, 'assume', 0, v))
    await step(k, id, 'whoami', 0, t)
    await step(k, id, 'read', 0, t)
    await step(k, id, 'break', 0, t, true)
    await step(k, id, 'untrusted', 0, v, true)
  },

  'iam-resource-policies': async (id, k) => {
    await step(k, id, 'devpol', 0)
    const v = pair(await step(k, id, 'devpol', 1), 'KEY_ID', 'SECRET')
    await step(k, id, 'baseline', 0, v)
    await step(k, id, 'deny')
    await k.sleep(1000)
    await step(k, id, 'break', 0, v, true)
    const g = pair(await step(k, id, 'guest', 0), 'GUEST_KEY_ID', 'GUEST_SECRET')
    await step(k, id, 'guest', 1, g, true)
    await step(k, id, 'grant', 0)
    await k.sleep(1000)
    await step(k, id, 'grant', 1, g)
    await step(k, id, 'queue', 0)
    await k.sleep(1000)
    await step(k, id, 'queue', 1, v, true)
    await step(k, id, 'queue', 2, v)
    await step(k, id, 'fix', 0)
    await k.sleep(1000)
    await step(k, id, 'fix', 1, v)
  },

  'iam-boundaries': async (id, k) => {
    await step(k, id, 'devpol')
    await step(k, id, 'policy')
    await step(k, id, 'attach')
    await k.sleep(1000)
    await step(k, id, 'sim')
    const v = pair(await step(k, id, 'key'), 'KEY_ID', 'SECRET')
    // the honest gap: the real call goes through on the emulator, so it must succeed here
    await step(k, id, 'real', 0, v)
    await step(k, id, 'delegate', 0)
    await step(k, id, 'delegate', 1)
    await step(k, id, 'delegate', 2)
  },

  'iam-abac': async (id, k) => {
    await step(k, id, 'tag-user')
    await step(k, id, 'tag-tables', 0)
    await step(k, id, 'tag-tables', 1)
    k.edit(id, 'abac-policy.json', () => k.code(id, 'edit'))
    await step(k, id, 'attach')
    await step(k, id, 'sim', 0)
    await step(k, id, 'sim', 1)
  },
}
