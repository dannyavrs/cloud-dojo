/** End-to-end solutions for the Step Functions track: replay the learner's real commands. */
import type { E2EScript } from './e2e-kit'

const LOST_CATCH_RESULT_PATH = /\n\s*"ResultPath": "\$\.error",/

export const SFN_E2E: Record<string, E2EScript> = {
  'sfn-retry': async (id, k) => {
    const { sh, C, sleep, log } = k
    await sh(id, C(id, 'role'))
    await sh(id, C(id, 'create'))
    await sh(id, C(id, 'plain', 0)); await sleep(2500)
    log('   plain:', (await sh(id, C(id, 'plain', 1))).stdout.replace(/\s+/g, ' '))
    k.edit(id, 'workflow.asl.json', () => k.code(id, 'edit'))
    await sh(id, C(id, 'update'))
    await sh(id, C(id, 'recover', 0)); await sleep(7000)
    log('   recovered:', (await sh(id, C(id, 'recover', 1))).stdout.replace(/\s+/g, ' '))
    await sh(id, C(id, 'recover', 2))
    await sh(id, C(id, 'exhaust', 0)); await sleep(7000)
    log('   exhausted:', (await sh(id, C(id, 'exhaust', 1))).stdout.replace(/\s+/g, ' '), 'failed attempts:', (await sh(id, C(id, 'exhaust', 2))).stdout.trim())
    await sh(id, C(id, 'break', 0), true)
    await sh(id, C(id, 'break', 1))
  },
  'sfn-catch-fail': async (id, k) => {
    const { sh, C, sleep, log } = k
    await sh(id, C(id, 'create'))
    await sh(id, C(id, 'uncaught', 0)); await sleep(3000)
    await sh(id, C(id, 'uncaught', 1)); await sh(id, C(id, 'uncaught', 2))
    k.edit(id, 'workflow.asl.json', () => k.code(id, 'edit'))
    await sh(id, C(id, 'update'))
    await sh(id, C(id, 'declined', 0)); await sleep(4000)
    for (const i of [1, 2, 3]) await sh(id, C(id, 'declined', i))
    await sh(id, C(id, 'paid', 0)); await sleep(4000)
    for (const i of [1, 2]) await sh(id, C(id, 'paid', i))
    k.edit(id, 'workflow.asl.json', (t) => { if (!LOST_CATCH_RESULT_PATH.test(t)) throw new Error('ResultPath line not found'); return t.replace(LOST_CATCH_RESULT_PATH, '') })
    await sh(id, C(id, 'break', 0)); await sh(id, C(id, 'break', 1)); await sleep(4000)
    log('   lost:', (await sh(id, C(id, 'break', 2))).stdout.replace(/\s+/g, ' ').slice(0, 200))
    k.edit(id, 'workflow.asl.json', () => k.code(id, 'fix'))
    await sh(id, C(id, 'fix', 0)); await sh(id, C(id, 'fix', 1)); await sleep(4000)
    await sh(id, C(id, 'fix', 2))
  },
  'sfn-map-choice-ddb': async (id, k) => {
    const { sh, C, sleep, log } = k
    await sh(id, C(id, 'create'))
    await sh(id, C(id, 'small', 0)); await sleep(5000); await sh(id, C(id, 'small', 1))
    await sh(id, C(id, 'bulk', 0)); await sleep(5000); await sh(id, C(id, 'bulk', 1))
    log('   map iterations:', (await sh(id, C(id, 'history', 0))).stdout.trim())
    await sh(id, C(id, 'history', 1))
    log('   table:', (await sh(id, C(id, 'table'))).stdout.replace(/\s+/g, ' ').slice(0, 260))
    k.edit(id, 'workflow.asl.json', (t) => { if (!t.includes('"$.lineCount", "NumericGreaterThanEquals"')) throw new Error('Choice variable not found'); return t.replace('"$.lineCount", "NumericGreaterThanEquals"', '"$.total", "NumericGreaterThanEquals"') })
    await sh(id, C(id, 'break', 0)); await sh(id, C(id, 'break', 1)); await sleep(4000)
    log('   missing:', (await sh(id, C(id, 'break', 2))).stdout.replace(/\s+/g, ' ').slice(0, 200))
    k.edit(id, 'workflow.asl.json', () => k.code(id, 'fix'))
    await sh(id, C(id, 'fix', 0)); await sh(id, C(id, 'fix', 1)); await sleep(5000)
    await sh(id, C(id, 'fix', 2))
  },
  'sfn-wait-for-token': async (id, k) => {
    const { sh, C, sleep, log, sub } = k
    const token = (r: { stdout: string }) => JSON.parse(r.stdout.trim()).taskToken as string
    await sh(id, C(id, 'create'))
    await sh(id, C(id, 'start', 0)); await sleep(2000)
    log('   while parked:', (await sh(id, C(id, 'start', 1))).stdout.trim())
    const t1 = token(await sh(id, C(id, 'inbox')))
    await sh(id, sub(C(id, 'approve', 0), { TASK_TOKEN: t1 })); await sleep(1500)
    log('   approved:', (await sh(id, C(id, 'approve', 1))).stdout.replace(/\s+/g, ' '))
    await sh(id, C(id, 'reject', 0)); await sleep(2000)
    const t2 = token(await sh(id, C(id, 'reject', 1)))
    await sh(id, sub(C(id, 'reject', 2), { TASK_TOKEN: t2 })); await sleep(1500)
    log('   rejected:', (await sh(id, C(id, 'reject', 3))).stdout.replace(/\s+/g, ' '))
    await sh(id, sub(C(id, 'approve', 0), { TASK_TOKEN: t1 }), true) // a used token is refused too
    await sh(id, C(id, 'break'), true)
  },
  'sfn-express-jsonata': async (id, k) => {
    const { sh, C, log } = k
    await sh(id, C(id, 'create'))
    log('   sync small:', (await sh(id, C(id, 'sync'))).stdout.replace(/\s+/g, ' '))
    k.edit(id, 'workflow.asl.json', () => k.code(id, 'edit'))
    await sh(id, C(id, 'edit', 0))
    log('   sync large:', (await sh(id, C(id, 'edit', 1))).stdout.replace(/\s+/g, ' '))
    for (const i of [0, 1]) await sh(id, C(id, 'test', i))
    await sh(id, C(id, 'limits'), true)
    await sh(id, C(id, 'break', 0)); await sh(id, C(id, 'break', 1), true)
  },
}
