import type { E2EScript } from './e2e-kit'

export const LAMBDA_E2E: Record<string, E2EScript> = {
  'lambda-config-errors': async (id, k) => {
    const { sh, C } = k
    await sh(id, C(id, 'create', 0)); await sh(id, C(id, 'create', 1))
    await sh(id, C(id, 'ok')); await sh(id, C(id, 'throw')); await sh(id, C(id, 'soft'))
    for (let i = 0; i < 3; i++) await sh(id, C(id, 'env', i))
    await sh(id, C(id, 'logs'))
    await sh(id, C(id, 'break'))
    for (let i = 0; i < 3; i++) await sh(id, C(id, 'fix', i))
    k.edit(id, 'handler.mjs', () => k.code(id, 'edit'))
    for (let i = 0; i < 4; i++) await sh(id, C(id, 'warm', i))
    k.log('   warm1:', k.read(id, 'warm1.json'), 'warm2:', k.read(id, 'warm2.json'))
  },
  'lambda-versions-aliases': async (id, k) => {
    const { sh, C } = k
    await sh(id, C(id, 'create', 0)); await sh(id, C(id, 'create', 1))
    await sh(id, C(id, 'v1'))
    k.edit(id, 'handler.mjs', () => k.code(id, 'edit'))
    for (let i = 0; i < 3; i++) await sh(id, C(id, 'v2', i))
    await sh(id, C(id, 'alias', 0)); await sh(id, C(id, 'alias', 1))
    k.log('   v1 answers:', k.read(id, 'out.json'))
    await sh(id, C(id, 'break'), true)
    await sh(id, C(id, 'canary'))
    for (let i = 0; i < 4; i++) await sh(id, C(id, 'try'))
    for (let i = 0; i < 2; i++) await sh(id, C(id, 'show', i))
  },
  'lambda-layers': async (id, k) => {
    const { sh, C } = k
    const arn = (await sh(id, C(id, 'publish'))).stdout.trim()
    k.log('   layer arn:', arn)
    k.edit(id, 'handler.mjs', () => k.code(id, 'edit'))
    await sh(id, k.sub(C(id, 'create', 0), { LAYER_ARN: arn })); await sh(id, C(id, 'create', 1))
    await sh(id, C(id, 'works'))
    for (let i = 0; i < 3; i++) await sh(id, C(id, 'break', i))
    k.log('   broken:', k.read(id, 'broken.json').slice(0, 120))
    for (const i of [0, 1, 2]) await sh(id, k.sub(C(id, 'fix', i), { LAYER_ARN: arn }))
    for (let i = 0; i < 2; i++) await sh(id, C(id, 'inspect', i))
  },
  'lambda-concurrency': async (id, k) => {
    const { sh, C } = k
    await sh(id, C(id, 'look'))
    await sh(id, C(id, 'reserve', 0)); await sh(id, C(id, 'reserve', 1))
    const mid = await k.app.checks(id, true)
    k.log('   Check while reserved=1:', mid.filter((c) => c.id === 'parallel').map((c) => `${c.pass} ${c.detail}`).join(''))
    await sh(id, C(id, 'parallel'))
    await sh(id, C(id, 'break', 0)); await sh(id, C(id, 'break', 1), true)
    await sh(id, C(id, 'restore', 0)); await sh(id, C(id, 'restore', 1))
    for (let i = 0; i < 4; i++) await sh(id, C(id, 'provisioned', i))
    await sh(id, C(id, 'rule'), true)
  },
  'lambda-function-url': async (id, k) => {
    const { sh, C } = k
    await sh(id, C(id, 'create'))
    const url = (await sh(id, C(id, 'break'))).stdout.trim()
    const before = await k.app.probeHttp(id, { url })
    k.log('   probe before:', before.status, before.body)
    await sh(id, C(id, 'perm-url')); await sh(id, C(id, 'perm-invoke'))
    await sh(id, C(id, 'open'))
    const after = await k.app.probeHttp(id, { url })
    k.log('   probe after:', after.status, after.body.slice(0, 100))
  },
  'lambda-async-destinations': async (id, k) => {
    const { sh, C } = k
    k.edit(id, 'event-invoke-config.json', () => k.code(id, 'edit'))
    await sh(id, C(id, 'apply', 0)); await sh(id, C(id, 'apply', 1))
    await sh(id, C(id, 'fire', 0))
    await k.sleep(6000)
    k.log('   failures queue after async failure:', (await sh(id, C(id, 'fire', 1))).stdout.replace(/\s+/g, ' '))
    await sh(id, C(id, 'dlq'))
  },
}
