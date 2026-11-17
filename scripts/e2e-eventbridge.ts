/** End-to-end solutions for the EventBridge track: replay the learner's real commands. */
import type { E2EScript } from './e2e-kit'

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19)
const must = (cond: unknown, msg: string) => { if (!cond) throw new Error(msg) }

export const EB_E2E: Record<string, E2EScript> = {
  'eb-patterns': async (id, k) => {
    const { sh, C, sleep, log } = k
    await sh(id, C(id, 'bus'))
    log('   big:', (await sh(id, C(id, 'test', 0))).stdout.trim(), 'small:', (await sh(id, C(id, 'test', 1))).stdout.trim())
    log('   string pattern:', (await sh(id, C(id, 'break'))).stdout.trim())
    await sh(id, C(id, 'rule')); await sh(id, C(id, 'policy')); await sh(id, C(id, 'target'))
    const put = JSON.parse((await sh(id, C(id, 'send'))).stdout)
    must(put.FailedEntryCount === 0, 'put-events failed entries')
    await sleep(1500)
    const got = (await sh(id, C(id, 'receive'))).stdout
    log('   queue:', got.replace(/\s+/g, ' ').slice(0, 160))
    must(got.includes('o-big') && !got.includes('o-small'), 'only the big order should arrive')
  },
  'eb-targets-sfn': async (id, k) => {
    const { sh, C, sleep, log, json, sub } = k
    await sh(id, C(id, 'look', 0)); await sh(id, C(id, 'look', 1))
    await sh(id, C(id, 'rule'))
    await sh(id, C(id, 'break', 0)); await sh(id, C(id, 'break', 1)); await sleep(4000)
    log('   executions with the wrong role:', (await sh(id, C(id, 'break', 2))).stdout.replace(/\s+/g, ''))
    await sh(id, C(id, 'role', 0)); await sh(id, C(id, 'role', 1)); await sleep(4000)
    log('   executions with right trust, no permission:', (await sh(id, C(id, 'role', 2))).stdout.replace(/\s+/g, ''))
    await sh(id, C(id, 'policy'))
    await sh(id, C(id, 'run', 0)); await sleep(4000)
    const arn1 = (await sh(id, C(id, 'run', 1))).stdout.trim()
    must(arn1.startsWith('arn:aws:states'), 'expected an execution after the policy')
    log('   InputPath input:', (await sh(id, sub(C(id, 'run', 2), { EXECUTION_ARN: arn1 }))).stdout.trim())
    await sh(id, C(id, 'transform', 0)); await sh(id, C(id, 'transform', 1)); await sleep(4000)
    const arn2 = (await sh(id, C(id, 'transform', 2))).stdout.trim()
    must(arn2 && arn2 !== arn1, 'expected a newer execution after the transformer')
    log('   transformed input:', (await sh(id, sub(C(id, 'transform', 3), { EXECUTION_ARN: arn2 }))).stdout.trim())
    await sh(id, C(id, 'lambda', 0)); await sh(id, C(id, 'lambda', 1)); await sh(id, C(id, 'invoke-perm'))
    await sh(id, C(id, 'logs', 0)); await sleep(14000)
    log('   logs:', (await sh(id, C(id, 'logs', 1))).stdout.replace(/\s+/g, ' ').slice(0, 200))
    void json
  },
  'eb-scheduler': async (id, k) => {
    const { sh, C, sleep, log, edit } = k
    await sh(id, C(id, 'look', 0)); await sh(id, C(id, 'look', 1))
    await sh(id, C(id, 'break'), true)
    edit(id, 'schedule.json', (t) => t.replace(/at\([^)]*\)/, `at(${iso(Date.now() + 8000)})`))
    await sh(id, C(id, 'create')); await sh(id, C(id, 'get'))
    await sleep(15000)
    const got = (await sh(id, C(id, 'receive'))).stdout
    log('   queue:', got.replace(/\s+/g, ' ').slice(0, 120))
    must(got.includes('scheduled-hello'), 'the scheduled message should have arrived')
    await sh(id, C(id, 'rate', 0)); await sh(id, C(id, 'rate', 1)); await sh(id, C(id, 'rate', 2))
  },
  'eb-archive-replay': async (id, k) => {
    const { sh, C, sleep, log } = k
    await sh(id, C(id, 'look'))
    await sh(id, C(id, 'archive'))
    await sh(id, C(id, 'send')); await sleep(2500)
    log('   archive:', (await sh(id, C(id, 'count'))).stdout.replace(/\s+/g, ''))
    log('   live before:', (await sh(id, C(id, 'before', 0))).stdout.replace(/\s+/g, ''), 'backfill before:', (await sh(id, C(id, 'before', 1))).stdout.replace(/\s+/g, ''))
    await sh(id, C(id, 'replay', 0)); await sleep(3000)
    log('   replay:', (await sh(id, C(id, 'replay', 1))).stdout.replace(/\s+/g, ''))
    const msg = (await sh(id, C(id, 'replay', 2))).stdout
    must(msg.includes('replay-name'), 'replayed message should carry replay-name')
    await sh(id, C(id, 'break', 0)); await sleep(3000)
    const live = (await sh(id, C(id, 'break', 1))).stdout.replace(/\s+/g, '')
    log('   live after unfiltered replay:', live)
    must(live.includes('"6"'), 'live should have 6 messages after the unfiltered replay')
  },
}
