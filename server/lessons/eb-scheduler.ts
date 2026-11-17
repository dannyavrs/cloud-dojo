import { GetScheduleCommand, ListSchedulesCommand } from '@aws-sdk/client-scheduler'
import { PutRolePolicyCommand } from '@aws-sdk/client-iam'
import { ChangeMessageVisibilityCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs'
import { arn, historyHas, item, queueUrl, ranFail, ranOk, type Ctx, type LessonServer } from '../lesson-kit'
import { createQueue, createRole, policyDoc } from './kit2'
import { safe, trust } from './eb-kit'

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19)
const schedule = (name: string, expression: string, role: string, input: string) => ({
  Name: name,
  ScheduleExpression: expression,
  FlexibleTimeWindow: { Mode: 'OFF' },
  Target: { Arn: arn.queue('jobs'), RoleArn: arn.role(role), Input: input },
})

export const ebScheduler: LessonServer = {
  id: 'eb-scheduler',
  /** Computed when the module starts, so the one-off time is just ahead of "now". */
  get files() {
    return {
      'schedule.json': JSON.stringify(schedule('hello-once', `at(${iso(Date.now() + 90_000)})`, 'sched-exec', 'scheduled-hello'), null, 2),
      'schedule-wrong.json': JSON.stringify(schedule('hello-wrong-role', 'at(2030-01-01T00:00:00)', 'events-exec', 'never'), null, 2),
      'schedule-rate.json': JSON.stringify(schedule('hello-every-minute', 'rate(1 minute)', 'sched-exec', 'tick'), null, 2),
    }
  },
  async fixture(ctx) {
    await createQueue(ctx, 'jobs')
    await createRole(ctx, 'sched-exec', trust('scheduler.amazonaws.com'))
    await ctx.c.iam.send(new PutRolePolicyCommand({ RoleName: 'sched-exec', PolicyName: 'send-to-jobs', PolicyDocument: policyDoc([{ Effect: 'Allow', Action: 'sqs:SendMessage', Resource: arn.queue('jobs') }]) }))
    await createRole(ctx, 'events-exec', trust('events.amazonaws.com'))
    await ctx.c.iam.send(new PutRolePolicyCommand({ RoleName: 'events-exec', PolicyName: 'send-to-jobs', PolicyDocument: policyDoc([{ Effect: 'Allow', Action: 'sqs:SendMessage', Resource: arn.queue('jobs') }]) }))
  },
  async check(ctx) {
    const h = ctx.history
    const once = await safe(ctx.c.scheduler.send(new GetScheduleCommand({ Name: 'hello-once' })))
    const onceOk = Boolean(once) && /^at\(/.test(once?.ScheduleExpression ?? '') && once?.Target?.RoleArn === arn.role('sched-exec') && once?.Target?.Arn === arn.queue('jobs')
    // The message is visible, in flight, or was already received by the learner.
    const received = ranOk(h, /receive-message.*\/jobs/, (o) => o.includes('scheduled-hello'))
    const delivered = onceOk && (received || await sawHello(ctx))
    const list = (await safe(ctx.c.scheduler.send(new ListSchedulesCommand({}))))?.Schedules ?? []
    const rateExists = list.some((s) => s.Name === 'hello-every-minute')
    const rateCreated = rateExists || ranOk(h, /create-schedule.*schedule-rate/)
    const deleted = !rateExists && ranOk(h, /delete-schedule.*hello-every-minute/)
    return [
      item('breakit', 'You saw Scheduler refuse a role it cannot assume', ranFail(h, /create-schedule.*schedule-wrong/, /assume the role|ValidationException/i) && historyHas(h, /create-schedule/), 'Run create-schedule with schedule-wrong.json.'),
      item('schedule', 'The schedule `hello-once` exists with an `at()` expression and the `sched-exec` role', onceOk, 'create-schedule with schedule.json (the time must be in the future).', once?.ScheduleExpression),
      item('delivered', 'The message `scheduled-hello` reached the queue', delivered, 'Wait for the time in schedule.json, then receive-message on `jobs`.'),
      item('rate', 'You created a recurring `rate()` schedule', rateCreated, 'create-schedule with schedule-rate.json.'),
      item('cleanup', 'The recurring schedule was deleted', deleted, 'delete-schedule --name hello-every-minute.'),
    ]
  },
}

/** Peek at the queue without consuming: look for the body, then make the message visible again. */
async function sawHello(ctx: Ctx): Promise<boolean> {
  const r = await safe(ctx.c.sqs.send(new ReceiveMessageCommand({ QueueUrl: queueUrl('jobs'), MaxNumberOfMessages: 10, VisibilityTimeout: 1 })))
  const msgs = r?.Messages ?? []
  for (const m of msgs) await safe(ctx.c.sqs.send(new ChangeMessageVisibilityCommand({ QueueUrl: queueUrl('jobs'), ReceiptHandle: m.ReceiptHandle!, VisibilityTimeout: 0 })))
  return msgs.some((m) => m.Body === 'scheduled-hello')
}
