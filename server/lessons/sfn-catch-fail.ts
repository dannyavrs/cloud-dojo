import { ScanCommand } from '@aws-sdk/client-dynamodb'
import { createFunction, createTable } from './kit2'
import { PAID_ASL, PAYMENT_SOURCE } from '../../shared/lessons/sfn-catch-fail'
import { item, ranOk, type LessonServer } from '../lesson-kit'
import { count, definition, executions, seedSfnRoles } from './sfn-kit'

export const sfnCatchFail: LessonServer = {
  id: 'sfn-catch-fail',
  files: { 'workflow.asl.json': PAID_ASL, 'payment.mjs': PAYMENT_SOURCE },
  zips: { 'payment.zip': { 'payment.mjs': PAYMENT_SOURCE } },
  async fixture(ctx) {
    await seedSfnRoles(ctx)
    await createTable(ctx, 'Orders', { pk: 'orderId' })
    await createFunction(ctx, 'payment', 'payment.handler', 'payment.zip', 'lambda-exec')
    // the emulator's Step Functions DynamoDB integration needs a few seconds before it sees a brand-new table
    await Bun.sleep(7000)
  },
  async check(ctx) {
    const h = ctx.history
    const d = await definition(ctx, 'checkout')
    const ex = d ? await executions(ctx, 'checkout') : []
    const rows = (await ctx.c.ddb.send(new ScanCommand({ TableName: 'Orders' })).catch(() => undefined))?.Items ?? []
    const declinedRow = rows.some((r) => r.status?.S === 'declined' && /PaymentDeclined/.test(r.reason?.S ?? ''))
    const paidRow = rows.some((r) => r.status?.S === 'paid')
    const uncaught = ex.find((e) => e.status === 'FAILED' && e.error === 'PaymentDeclined')
    const caught = ex.find((e) => e.status === 'FAILED' && e.error === 'OrderDeclined' && count(e, 'FailStateEntered') === 1)
    const paid = ex.find((e) => e.status === 'SUCCEEDED')
    const lost = ex.find((e) => e.status === 'FAILED' && e.error === 'States.Runtime' && /orderId/.test(e.cause ?? ''))
    const seen = ranOk(h, /describe-execution|get-execution-history/, (o) => /States\.Runtime/.test(o))
    const catches: any[] = d?.def?.States?.Charge?.Catch ?? []
    const fixed = catches.some((c) => c.ResultPath === '$.error' && (c.ErrorEquals ?? []).includes('PaymentDeclined'))
    return [
      item('machine', 'State machine `checkout` exists', Boolean(d), 'Run the create-state-machine step.'),
      item('uncaught', 'You saw a declined card fail the execution with the raw PaymentDeclined error', Boolean(uncaught), 'Run a declined order before adding the Catch.'),
      item('catch', 'A declined order was caught: execution FAILED with OrderDeclined and a `declined` row exists', Boolean(caught) && declinedRow, 'Add the Catch, update the machine and run a declined order.', caught ? `${caught.name}: ${caught.error}` : undefined),
      item('paid', 'A good card SUCCEEDED and left a `paid` row', Boolean(paid) && paidRow, 'Run an order with card "ok".'),
      item('breakit', 'You saw States.Runtime when the Catch lost the input', Boolean(lost) && seen, 'Remove ResultPath from the Catch, update, run a declined order and describe it.', lost ? `${lost.name}: ${lost.error}` : undefined),
      item('fixed', 'The Catch keeps the input again (ResultPath restored)', fixed && Boolean(lost), 'Put `"ResultPath": "$.error"` back in the Catch and update the machine.'),
    ]
  },
}
