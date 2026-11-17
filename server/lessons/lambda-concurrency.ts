import { GetFunctionConcurrencyCommand, GetProvisionedConcurrencyConfigCommand, InvokeCommand } from '@aws-sdk/client-lambda'
import { SLOW_HANDLER } from '../../shared/lessons/lambda-concurrency'
import { item, ranFail, ranOk, type LessonServer } from '../lesson-kit'
import { createFunction } from './kit2'
import { seedRole } from './lambda-kit'

export const lambdaConcurrency: LessonServer = {
  id: 'lambda-concurrency',
  files: { 'slow.mjs': SLOW_HANDLER },
  zips: { 'slow.zip': { 'slow.mjs': SLOW_HANDLER } },
  async fixture(ctx) {
    await seedRole(ctx)
    await createFunction(ctx, 'slow', 'slow.handler', 'slow.zip', 'lambda-exec')
  },
  async check(ctx, { probe }) {
    const h = ctx.history
    const reserved = (await ctx.c.lambda.send(new GetFunctionConcurrencyCommand({ FunctionName: 'slow' })).catch(() => undefined))?.ReservedConcurrentExecutions
    const prov = await ctx.c.lambda.send(new GetProvisionedConcurrencyConfigCommand({ FunctionName: 'slow', Qualifier: 'prod' })).catch(() => undefined)
    let parallel: boolean | null = null
    let detail = 'press Check'
    if (probe) {
      if (reserved !== 1) { parallel = false; detail = `reserved concurrency is ${reserved ?? 'not set'}, it must be 1` }
      else {
        const call = () => ctx.c.lambda.send(new InvokeCommand({ FunctionName: 'slow', Payload: Buffer.from('{}') })).then(() => 'ok', (e) => (e instanceof Error ? e.name : 'error'))
        const a = call()
        await Bun.sleep(600)
        const b = call()
        const res = await Promise.all([a, b])
        parallel = res.includes('ok') && res.includes('TooManyRequestsException')
        detail = res.join(' / ')
      }
    }
    const sawThrottle = ranFail(h, /lambda invoke[\s\S]*slow/, /TooManyRequestsException/)
    return [
      item('reserved', 'You set reserved concurrency of 1 on `slow`', ranOk(h, /put-function-concurrency[\s\S]*--reserved-concurrent-executions\s+1\b/), 'Run put-function-concurrency with --reserved-concurrent-executions 1.'),
      { ...item('parallel', 'Two parallel invokes: one ran, one got TooManyRequestsException', parallel, 'Keep reserved concurrency at 1 and press Check.', detail), pass: parallel },
      item('provisioned', 'Provisioned concurrency is configured on alias `prod` (cosmetic on the emulator)', (prov?.RequestedProvisionedConcurrentExecutions ?? 0) >= 1, 'Publish a version, create the alias, run put-provisioned-concurrency-config.'),
      item('breakit', 'You saw TooManyRequestsException with reserved concurrency 0', sawThrottle && ranOk(h, /put-function-concurrency[\s\S]*--reserved-concurrent-executions\s+0\b/), 'Set reserved concurrency to 0 and invoke.'),
      item('restored', 'Reserved concurrency is back to 1', reserved === 1 && sawThrottle, 'Run the restore step.', `reserved: ${reserved ?? 'none'}`),
    ]
  },
}
