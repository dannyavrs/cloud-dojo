import { createFunction, createTable } from './kit2'
import { CHARGE_SOURCE, PLAIN_ASL } from '../../shared/lessons/sfn-retry'
import { item, ranFail, type LessonServer } from '../lesson-kit'
import { count, definition, executions, seedSfnRoles } from './sfn-kit'

export const sfnRetry: LessonServer = {
  id: 'sfn-retry',
  files: { 'workflow.asl.json': PLAIN_ASL, 'charge.mjs': CHARGE_SOURCE },
  zips: { 'charge.zip': { 'charge.mjs': CHARGE_SOURCE } },
  async fixture(ctx) {
    await seedSfnRoles(ctx, ['dynamodb:UpdateItem'])
    await createTable(ctx, 'attempts', { pk: 'id' })
    await createFunction(ctx, 'charge', 'charge.handler', 'charge.zip', 'lambda-exec')
  },
  async check(ctx) {
    const h = ctx.history
    const d = await definition(ctx, 'payment')
    const rules: any[] = Object.values<any>(d?.def?.States ?? {}).flatMap((s) => s.Retry ?? [])
    const retry = rules.some((r) => (r.ErrorEquals ?? []).some((e: string) => ['Transient', 'States.ALL', 'States.TaskFailed'].includes(e)) && (r.MaxAttempts ?? 3) >= 2)
    const ex = d ? await executions(ctx, 'payment') : []
    const recovered = ex.find((e) => e.status === 'SUCCEEDED' && count(e, 'TaskFailed') >= 1)
    const exhausted = ex.find((e) => e.status === 'FAILED' && count(e, 'TaskFailed') >= 3)
    return [
      item('machine', 'State machine `payment` exists', Boolean(d), 'Run the create-state-machine step.'),
      item('retry', 'The Charge state retries Transient at least twice', retry, 'Edit workflow.asl.json to add the Retry block, then run update-state-machine.'),
      item('recovered', 'An execution failed, retried and then SUCCEEDED', Boolean(recovered), 'Start an execution with failFirst 2 after the update and wait about five seconds.', recovered ? `${recovered.name}: ${count(recovered, 'TaskFailed')} failed attempt(s) then success` : `${ex.length} execution(s) so far`),
      item('exhausted', 'An execution used up its retries (3 failed attempts) and FAILED', Boolean(exhausted), 'Start an execution with failFirst 5 and wait about five seconds.', exhausted ? `${exhausted.name}: error ${exhausted.error}` : undefined),
      item('breakit', 'You saw create-state-machine reject a broken definition', ranFail(h, /create-state-machine/, /InvalidDefinition|MISSING_TRANSITION_TARGET/), 'Run the break-it command.'),
    ]
  },
}
