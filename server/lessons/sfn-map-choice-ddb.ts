import { ScanCommand } from '@aws-sdk/client-dynamodb'
import { createFunction, createTable } from './kit2'
import { FULFIL_ASL, PRICE_SOURCE } from '../../shared/lessons/sfn-map-choice-ddb'
import { item, ranOk, type LessonServer } from '../lesson-kit'
import { count, definition, executions, seedSfnRoles } from './sfn-kit'

export const sfnMapChoiceDdb: LessonServer = {
  id: 'sfn-map-choice-ddb',
  files: { 'workflow.asl.json': FULFIL_ASL, 'price.mjs': PRICE_SOURCE },
  zips: { 'price.zip': { 'price.mjs': PRICE_SOURCE } },
  async fixture(ctx) {
    await seedSfnRoles(ctx)
    await createTable(ctx, 'Fulfilment', { pk: 'orderId' })
    await createFunction(ctx, 'price', 'price.handler', 'price.zip', 'lambda-exec')
    // the emulator's Step Functions DynamoDB integration needs a few seconds before it sees a brand-new table
    await Bun.sleep(7000)
  },
  async check(ctx) {
    const h = ctx.history
    const d = await definition(ctx, 'fulfil')
    const ex = d ? await executions(ctx, 'fulfil') : []
    const rows = (await ctx.c.ddb.send(new ScanCommand({ TableName: 'Fulfilment' })).catch(() => undefined))?.Items ?? []
    const okNames = new Set(ex.filter((e) => e.status === 'SUCCEEDED').map((e) => e.name))
    const tierOk = (tier: string, lines: number) => rows.some((r) => r.tier?.S === tier && Number(r.lines?.N) === lines && okNames.has(r.execution?.S ?? ''))
    const mapped = ex.some((e) => e.status === 'SUCCEEDED' && count(e, 'MapIterationSucceeded') >= 2)
    const waited = ex.some((e) => e.status === 'SUCCEEDED' && count(e, 'WaitStateEntered') >= 1)
    const lost = ex.find((e) => e.status === 'FAILED' && e.error === 'States.Runtime' && /Size/.test(e.cause ?? ''))
    const seen = ranOk(h, /describe-execution|get-execution-history/, (o) => /States\.Runtime/.test(o))
    const choice: any[] = d?.def?.States?.Size?.Choices ?? []
    const restored = choice.some((c) => c.Variable === '$.lineCount')
    return [
      item('machine', 'State machine `fulfil` exists', Boolean(d), 'Run the create-state-machine step.'),
      item('small', 'A 2-line order SUCCEEDED and was recorded as `small` with its execution name', tierOk('small', 2), 'Run the small order and wait about four seconds.'),
      item('bulk', 'A 3-line order SUCCEEDED through the Map, was recorded as `bulk` with its execution name', tierOk('bulk', 3) && mapped, 'Run the 3-line order and wait about four seconds.'),
      item('wait', 'The history shows the Wait state ran', waited, 'A successful run goes through the Cooldown Wait.'),
      item('breakit', 'You saw the runtime error from a Choice on a missing field', Boolean(lost) && seen, 'Point the Choice at $.total, update, run and describe the execution.', lost ? `${lost.name}: ${lost.error}` : undefined),
      item('fixed', 'The Choice reads $.lineCount again and a later order SUCCEEDED', restored && Boolean(lost) && ex.filter((e) => e.status === 'SUCCEEDED').length >= 3, 'Restore the Variable, update the machine and run a new order.'),
    ]
  },
}
