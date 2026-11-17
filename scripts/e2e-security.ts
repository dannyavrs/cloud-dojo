/** End-to-end solutions for the Security track: replay the learner's real commands. */
import type { E2E, E2EScript } from './e2e-kit'

const pair = (r: { stdout: string }, a: string, b: string) => {
  const [x, y] = r.stdout.trim().split(/\s+/)
  return { [a]: x, [b]: y }
}
const step = (k: E2E, id: string, s: string, i = 0, vars: Record<string, string> = {}, fail = false) => k.sh(id, k.sub(k.C(id, s, i), vars), fail)

export const SEC_E2E: Record<string, E2EScript> = {
  'kms-envelope': async (id, k) => {
    await step(k, id, 'look')
    const keyId = (await step(k, id, 'key', 0)).stdout.trim()
    await step(k, id, 'key', 1, { KEY_ID: keyId })
    await step(k, id, 'key', 2)
    const ct = (await step(k, id, 'enc')).stdout.trim()
    await step(k, id, 'dec', 0, { CIPHERTEXT: ct })
    await step(k, id, 'break', 0, { CIPHERTEXT: ct }, true)
    const dk = (await step(k, id, 'dk')).stdout.trim().split(/\s+/)
    k.log('   data key: plaintext chars', dk[0].length, '| encrypted chars', dk[1].length)
    await step(k, id, 'unwrap', 0, { DATA_KEY_CIPHERTEXT: dk[1] })
    const nct = (await step(k, id, 'reenc', 0, { CIPHERTEXT: ct })).stdout.trim()
    await step(k, id, 'reenc', 1, { NEW_CIPHERTEXT: nct })
  },

  'kms-policies-grants': async (id, k) => {
    await step(k, id, 'look')
    const a = pair(await step(k, id, 'keys', 0), 'KEY_ID', 'SECRET')
    const u = pair(await step(k, id, 'keys', 1), 'AUD_KEY_ID', 'AUD_SECRET')
    await k.sleep(1000)
    const ct = (await step(k, id, 'baseline', 0)).stdout.trim()
    await step(k, id, 'baseline', 1, a)
    const iso = (await step(k, id, 'nodeleg', 0)).stdout.trim()
    await step(k, id, 'nodeleg', 1, { ...a, ISOLATED_KEY_ID: iso }, true)
    await step(k, id, 'deny')
    await k.sleep(1000)
    await step(k, id, 'break', 0, a, true)
    await step(k, id, 'break', 1, { ...a, CIPHERTEXT: ct })
    const aud = { ...u, CIPHERTEXT: ct }
    await step(k, id, 'grant', 0, aud, true)
    const gid = (await step(k, id, 'grant', 1)).stdout.trim()
    await k.sleep(1500)
    await step(k, id, 'grant', 2, aud)
    await step(k, id, 'grant', 3, aud, true)
    await step(k, id, 'grant', 4)
    await step(k, id, 'grant', 5, { GRANT_ID: gid })
    await k.sleep(1500)
    await step(k, id, 'grant', 6, aud, true)
    await step(k, id, 'rotate', 0)
    await step(k, id, 'rotate', 1)
    const scratch = (await step(k, id, 'delete', 0)).stdout.trim()
    await step(k, id, 'delete', 1, { SCRATCH_KEY_ID: scratch })
    await step(k, id, 'delete', 2, { SCRATCH_KEY_ID: scratch }, true)
    await step(k, id, 'delete', 3, { SCRATCH_KEY_ID: scratch })
  },

  'secrets-rotation': async (id, k) => {
    await step(k, id, 'look')
    await step(k, id, 'create')
    for (let i = 0; i < 3; i++) await step(k, id, 'versions', i)
    await step(k, id, 'fn', 0); await step(k, id, 'fn', 1)
    await step(k, id, 'break', 0, {}, true)
    await step(k, id, 'perm')
    await step(k, id, 'rotate')
    for (let i = 0; i < 20; i++) {
      if ((await step(k, id, 'watch', 1)).stdout.includes('rotated-')) break
      await k.sleep(1000)
    }
    for (let i = 0; i < 3; i++) await step(k, id, 'watch', i)
    await step(k, id, 'logs')
    const r = pair(await step(k, id, 'policy', 0), 'KEY_ID', 'SECRET')
    await k.sleep(1000)
    await step(k, id, 'policy', 1, r)
    await step(k, id, 'policy', 2)
    await k.sleep(1000)
    await step(k, id, 'policy', 3, r, true)
  },

  'ssm-parameter-store': async (id, k) => {
    await step(k, id, 'look', 0); await step(k, id, 'look', 1)
    for (let i = 0; i < 3; i++) await step(k, id, 'put', i)
    k.log('   ciphertext without decryption:', (await step(k, id, 'break')).stdout.trim().slice(0, 24) + '...')
    await step(k, id, 'decrypt')
    for (let i = 0; i < 3; i++) k.log('   by path:', (await step(k, id, 'path', i)).stdout.trim())
    await step(k, id, 'versions', 0, {}, true)
    for (let i = 1; i < 4; i++) await step(k, id, 'versions', i)
    await step(k, id, 'cmk', 0)
    const r = pair(await step(k, id, 'cmk', 1), 'KEY_ID', 'SECRET')
    await k.sleep(1000)
    await step(k, id, 'cmk', 2, r)
    await step(k, id, 'cmk', 3, r, true)
    await step(k, id, 'cmk', 4)
    await k.sleep(1000)
    await step(k, id, 'cmk', 5, r)
  },
}
