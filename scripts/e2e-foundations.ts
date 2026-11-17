import type { E2EScript } from './e2e-kit'

export const FOUNDATIONS_E2E: Record<string, E2EScript> = {
  'cli-fluency': async (id, k) => {
    const { sh, C, json, sub, log } = k
    await sh(id, C(id, 'shape'))
    await sh(id, C(id, 'project'))
    await sh(id, C(id, 'filter'))
    for (let i = 0; i < 3; i++) await sh(id, C(id, 'functions', i))
    for (let i = 0; i < 3; i++) log('  ', (await sh(id, C(id, 'pagesize', i))).stdout.replace(/\s+/g, ' ').trim())
    const first = json(await sh(id, C(id, 'resume', 0)))
    await sh(id, sub(C(id, 'resume', 1), { NEXT_TOKEN: first.NextToken }))
    for (let i = 0; i < 5; i++) await sh(id, C(id, 'waiter', i))
    const r = await sh(id, C(id, 'break'))
    log('   break-it output:', JSON.stringify(r.stdout.trim()))
  },
}
