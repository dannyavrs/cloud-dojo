import { DescribeAlarmHistoryCommand, DescribeAlarmsCommand } from '@aws-sdk/client-cloudwatch'
import { CreateTopicCommand, ListSubscriptionsByTopicCommand } from '@aws-sdk/client-sns'
import { CreateQueueCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs'
import { item, queueUrl, type Ctx, type LessonServer } from '../lesson-kit'
import { policyDoc } from './kit2'
import { ALARM_TOPIC_ARN } from './cw-kit'

const INBOX_ARN = 'arn:aws:sqs:us-east-1:000000000000:alarm-inbox'
const POLICY_FILE = JSON.stringify({
  Policy: policyDoc([{ Effect: 'Allow', Principal: { Service: 'sns.amazonaws.com' }, Action: 'sqs:SendMessage', Resource: INBOX_ARN, Condition: { ArnEquals: { 'aws:SourceArn': ALARM_TOPIC_ARN } } }]),
}, null, 2) + '\n'

const alarm = async (ctx: Ctx, name: string) =>
  (await ctx.c.cw.send(new DescribeAlarmsCommand({ AlarmNames: [name] })).catch(() => undefined))?.MetricAlarms?.[0]

/** StateUpdate history entries as { at, newState }. */
async function transitions(ctx: Ctx) {
  const r = await ctx.c.cw.send(new DescribeAlarmHistoryCommand({ AlarmName: 'checkout-errors', HistoryItemType: 'StateUpdate', MaxRecords: 50 })).catch(() => undefined)
  return (r?.AlarmHistoryItems ?? []).map((i) => {
    let ns: { stateValue?: string; stateReasonData?: unknown } = {}
    try { ns = JSON.parse(i.HistoryData ?? '{}').newState ?? {} } catch { /* ignore */ }
    return { at: i.Timestamp?.getTime() ?? 0, state: ns.stateValue, evaluated: Boolean(ns.stateReasonData) }
  })
}

export const cwAlarmsSns: LessonServer = {
  id: 'cw-alarms-sns',
  files: { 'queue-policy.json': POLICY_FILE },
  async fixture(ctx) {
    await ctx.c.sns.send(new CreateTopicCommand({ Name: 'alarms' }))
    await ctx.c.sqs.send(new CreateQueueCommand({ QueueName: 'alarm-inbox' }))
  },
  async check(ctx) {
    const h = ctx.history
    const a = await alarm(ctx, 'checkout-errors')
    const configured = Boolean(a && a.Namespace === 'Dojo' && a.MetricName === 'Errors' && a.Statistic === 'Sum' && a.Threshold === 3 && a.ComparisonOperator === 'GreaterThanThreshold' && a.AlarmActions?.includes(ALARM_TOPIC_ARN))
    const subs = (await ctx.c.sns.send(new ListSubscriptionsByTopicCommand({ TopicArn: ALARM_TOPIC_ARN })).catch(() => undefined))?.Subscriptions ?? []
    const subscribed = subs.some((s) => s.Protocol === 'sqs' && s.Endpoint === INBOX_ARN)
    const tr = await transitions(ctx)
    const tripped = tr.filter((t) => t.state === 'ALARM' && t.evaluated)
    const first = tripped.length ? Math.min(...tripped.map((t) => t.at)) : Infinity
    const pol = (await ctx.c.sqs.send(new GetQueueAttributesCommand({ QueueUrl: queueUrl('alarm-inbox'), AttributeNames: ['Policy'] })).catch(() => undefined))?.Attributes?.Policy ?? ''
    const policyOk = /sns\.amazonaws\.com/.test(pol) && /sqs:SendMessage/.test(pol) && /"Allow"/.test(pol)
    const emptySeen = h.some((r) => !r.rejected && r.exitCode === 0 && /sqs receive-message/.test(r.command) && /alarm-inbox/.test(r.command) && r.stdout.trim() === '' && r.at >= first)
    const gotMail = h.some((r) => !r.rejected && r.exitCode === 0 && /sqs receive-message/.test(r.command) && /alarm-inbox/.test(r.command) && /checkout-errors/.test(r.stdout) && /ALARM/.test(r.stdout))
    const want: [string, string][] = [['tmd-breaching', 'ALARM'], ['tmd-notbreaching', 'OK'], ['tmd-missing', 'INSUFFICIENT_DATA']]
    const states = await Promise.all(want.map(async ([n]) => (await alarm(ctx, n))?.StateValue))
    const tmd = want.every(([, s], i) => states[i] === s)
    return [
      item('alarm', 'Alarm checkout-errors watches Dojo/Errors (Sum > 3) and notifies the topic', configured, 'Create it with `put-metric-alarm`, including `--alarm-actions` with the topic ARN.'),
      item('subscribed', 'The alarm-inbox queue is subscribed to the alarms topic', subscribed, 'Run `aws sns subscribe` with `--protocol sqs`.'),
      item('self', 'The alarm entered ALARM by itself, from a real datapoint', tripped.length > 0, 'Publish Errors = 9 with `put-metric-data` and wait. `set-alarm-state` does not count.'),
      item('breakit', 'You saw the inbox empty while the alarm was in ALARM', emptySeen, 'Run `receive-message` on alarm-inbox after the alarm trips and before fixing the queue policy.'),
      item('policy', 'The queue policy lets SNS send messages', policyOk, 'Apply `queue-policy.json` with `set-queue-attributes`.'),
      item('delivered', 'The alarm notification arrived in the inbox', policyOk && gotMail, 'Replay the transition with `set-alarm-state`, then `receive-message`.'),
      item('tmd', 'The three tmd- alarms settled in ALARM, OK and INSUFFICIENT_DATA', tmd, 'Create tmd-breaching, tmd-notbreaching and tmd-missing, then wait about fifteen seconds.', states.every((s) => s === undefined) ? undefined : `now: ${states.map((s) => s ?? 'missing').join(', ')}`),
    ]
  },
}
