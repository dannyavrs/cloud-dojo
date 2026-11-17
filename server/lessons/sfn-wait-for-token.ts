import { CreateQueueCommand } from '@aws-sdk/client-sqs'
import { APPROVAL_ASL } from '../../shared/lessons/sfn-wait-for-token'
import { item, ranFail, ranOk, type LessonServer } from '../lesson-kit'
import { count, definition, executions, seedSfnRoles } from './sfn-kit'

export const sfnWaitForToken: LessonServer = {
  id: 'sfn-wait-for-token',
  files: { 'workflow.asl.json': APPROVAL_ASL },
  async fixture(ctx) {
    await seedSfnRoles(ctx)
    await ctx.c.sqs.send(new CreateQueueCommand({ QueueName: 'approvals' }))
  },
  async check(ctx) {
    const h = ctx.history
    const d = await definition(ctx, 'approval')
    const ex = d ? await executions(ctx, 'approval') : []
    const approved = ex.find((e) => e.status === 'SUCCEEDED' && count(e, 'TaskSubmitted') >= 1 && /"approved"\s*:\s*true/.test(e.output ?? ''))
    const rejected = ex.find((e) => e.status === 'FAILED' && e.error === 'Rejected')
    return [
      item('machine', 'State machine `approval` exists', Boolean(d), 'Run the create-state-machine step.'),
      item('inbox', 'You read a task token message from the approvals queue', ranOk(h, /sqs receive-message/, (o) => /taskToken/.test(o)), 'Start an execution, then run the receive-message command.'),
      item('approved', 'An execution resumed with send-task-success and SUCCEEDED with your answer', Boolean(approved), 'Send the token you copied with send-task-success and the JSON output.', approved ? `${approved.name}: ${approved.output}` : undefined),
      item('rejected', 'An execution was failed with send-task-failure and ended FAILED with `Rejected`', Boolean(rejected), 'Start a second approval and send-task-failure with --error Rejected.'),
      item('breakit', 'You saw Step Functions refuse a made-up token', ranFail(h, /send-task-(success|failure)/, /InvalidToken|TaskDoesNotExist/), 'Run the break-it command.'),
    ]
  },
}
