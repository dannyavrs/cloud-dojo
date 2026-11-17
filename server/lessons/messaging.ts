import { PutRolePolicyCommand } from '@aws-sdk/client-iam'
import { GetFunctionCommand, ListEventSourceMappingsCommand } from '@aws-sdk/client-lambda'
import { CreateQueueCommand, DeleteMessageCommand, GetQueueAttributesCommand, ListMessageMoveTasksCommand, ReceiveMessageCommand, SendMessageCommand, SetQueueAttributesCommand } from '@aws-sdk/client-sqs'
import { CreateTopicCommand, GetSubscriptionAttributesCommand, ListSubscriptionsByTopicCommand, PublishCommand } from '@aws-sdk/client-sns'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { arn, item, queueUrl, ranFail, ranOk, type Ctx, type LessonServer } from '../lesson-kit'
import { createRole, policyDoc, sendPolicy, waitFor } from './kit2'

const qattrs = async (ctx: Ctx, name: string, names: string[] = ['All']) =>
  (await ctx.c.sqs.send(new GetQueueAttributesCommand({ QueueUrl: queueUrl(name), AttributeNames: names as never })).catch(() => undefined))?.Attributes
const total = (a?: Record<string, string>) => ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible', 'ApproximateNumberOfMessagesDelayed'].reduce((n, k) => n + Number(a?.[k] ?? 0), 0)
const mkQueue = async (ctx: Ctx, name: string, attributes?: Record<string, string>) => (await ctx.c.sqs.send(new CreateQueueCommand({ QueueName: name, Attributes: attributes }))).QueueUrl!
const redrive = (dlq: string, max: number) => JSON.stringify({ deadLetterTargetArn: arn.queue(dlq), maxReceiveCount: String(max) })
const urlRe = (name: string) => new RegExp(`/${name.replace('.', '\\.')}(\\s|$)`)

/* ---------- 5.2 visibility, long polling, delay ---------- */
export const sqsVisibility: LessonServer = {
  id: 'sqs-visibility',
  async fixture(ctx) {
    const q = await mkQueue(ctx, 'jobs', { VisibilityTimeout: '8' })
    await ctx.c.sqs.send(new SendMessageCommand({ QueueUrl: q, MessageBody: 'job1' }))
  },
  async check(ctx) {
    const h = ctx.history
    const later = await qattrs(ctx, 'later', ['DelaySeconds'])
    const extended = h.some((r) => r.exitCode === 0 && /change-message-visibility/.test(r.command) && Number(r.command.match(/--visibility-timeout\s+(\d+)/)?.[1] ?? 0) >= 30)
    return [
      item('dup', 'You saw the same message again with ApproximateReceiveCount 2', ranOk(h, /receive-message/, (o) => /"ApproximateReceiveCount":\s*"2"/.test(o)), 'Receive (step 1), wait about 10 seconds without deleting, receive again (step 3) with --attribute-names ApproximateReceiveCount.'),
      item('deleted', 'You deleted a message with delete-message', ranOk(h, /sqs delete-message/), 'Run step 4 with the newest receipt handle.'),
      item('extended', 'A message is hidden by an extended visibility timeout (30 s or more)', extended, 'Run step 5: send job2, receive it and change-message-visibility to 60.'),
      item('delayq', 'Queue `later` exists with a delay of at least 1 second', Number(later?.DelaySeconds ?? 0) >= 1, 'Create it with --attributes DelaySeconds=5.'),
      item('longpoll', 'You long-polled the delay queue and got the message', ranOk(h, /receive-message[\s\S]*\/later\b[\s\S]*--wait-time-seconds\s+[1-9]|receive-message[\s\S]*--wait-time-seconds\s+[1-9][\s\S]*\/later\b/, (o) => o.includes('hello-later')), 'Run step 7 with --wait-time-seconds 10.'),
    ]
  },
}

/* ---------- 5.3 DLQ and redrive ---------- */
export const sqsDlqRedrive: LessonServer = {
  id: 'sqs-dlq-redrive',
  files: { 'redrive.json': JSON.stringify({ RedrivePolicy: redrive('orders-dlq', 5) }, null, 2) },
  async fixture(ctx) {
    await mkQueue(ctx, 'orders-dlq')
    await mkQueue(ctx, 'orders', { VisibilityTimeout: '1' })
  },
  async check(ctx) {
    const h = ctx.history
    const o = await qattrs(ctx, 'orders')
    const d = await qattrs(ctx, 'orders-dlq')
    let policyOk = false
    try { const p = JSON.parse(o?.RedrivePolicy ?? ''); policyOk = String(p.deadLetterTargetArn).endsWith(':orders-dlq') && Number(p.maxReceiveCount) <= 3 } catch { /* none */ }
    const receives = h.filter((r) => r.exitCode === 0 && /sqs receive-message/.test(r.command) && urlRe('orders').test(r.command)).length
    const inDlq = Number(d?.ApproximateNumberOfMessages ?? 0) + Number(d?.ApproximateNumberOfMessagesNotVisible ?? 0) >= 1 || ranOk(h, /receive-message[\s\S]*orders-dlq/, (out) => out.includes('poison'))
    const tasks = (await ctx.c.sqs.send(new ListMessageMoveTasksCommand({ SourceArn: arn.queue('orders-dlq') })).catch(() => undefined))?.Results ?? []
    const moved = tasks.some((t) => t.Status === 'COMPLETED') && (total(o) >= 1 || tasks.some((t) => (t.ApproximateNumberOfMessagesMoved ?? 0) >= 1))
    return [
      item('policy', 'Queue `orders` redrives to `orders-dlq` after 3 receives or fewer', policyOk, 'Set maxReceiveCount to 2 in redrive.json, Save, then run set-queue-attributes.'),
      item('breakit', 'You received the poison message three times without deleting it', receives >= 3, 'Send `poison`, then run the receive command three times.', `${receives} receive(s) on orders`),
      item('dlq', 'The poison message reached `orders-dlq`', inDlq, 'After the third receive it moves. Peek at the DLQ with --visibility-timeout 0.'),
      item('moved', 'A message move task completed and the message is back in `orders`', moved, 'Run start-message-move-task from the DLQ to orders, then check again.'),
    ]
  },
}

/* ---------- 5.4 FIFO ---------- */
export const sqsFifo: LessonServer = {
  id: 'sqs-fifo',
  async check(ctx) {
    const h = ctx.history
    const f = await qattrs(ctx, 'orders.fifo', ['FifoQueue'])
    const g = await qattrs(ctx, 'groups.fifo', ['FifoQueue'])
    return [
      item('queue', 'Queue `orders.fifo` exists as a FIFO queue', f?.FifoQueue === 'true', 'Create it with --attributes FifoQueue=true (step 1).'),
      item('order', 'You received o1, o2, o3 in order with no duplicate', h.some((r) => r.exitCode === 0 && urlRe('orders.fifo').test(r.command) && /^o1\s+o2\s+o3$/.test(r.stdout.trim())), 'Send the four messages (step 2), then run the receive in step 3.'),
      item('groups', 'You saw group B get through while group A was blocked', g?.FifoQueue === 'true' && h.some((r) => r.exitCode === 0 && urlRe('groups.fifo').test(r.command) && r.stdout.trim() === 'b1'), 'Do step 4 and run both receives in step 5.'),
      item('breakit', 'You saw MissingParameter for a send without a group id', ranFail(h, /sqs send-message/, /MissingParameter/), 'Run the break-it command.'),
    ]
  },
}

/* ---------- 5.5 SNS filter policies ---------- */
const TOPIC = 'orders'
const FANOUT_QUEUES = ['billing', 'shipping', 'audit', 'bodyq']
export const snsFilterFanout: LessonServer = {
  id: 'sns-filter-fanout',
  files: {
    'filter-billing.json': JSON.stringify({ type: ['paid'] }, null, 2),
    'filter-shipping.json': JSON.stringify({ type: ['paid', 'shipped'] }, null, 2),
    'filter-body.json': JSON.stringify({ status: ['ok'] }, null, 2),
  },
  async fixture(ctx) {
    await ctx.c.sns.send(new CreateTopicCommand({ Name: TOPIC }))
    for (const n of FANOUT_QUEUES) {
      const u = await mkQueue(ctx, n)
      await ctx.c.sqs.send(new SetQueueAttributesCommand({ QueueUrl: u, Attributes: { Policy: sendPolicy('sns.amazonaws.com', arn.queue(n), 'ArnEquals', arn.topic(TOPIC)) } }))
    }
    await mkQueue(ctx, 'quarantine') // deliberately no access policy
  },
  async check(ctx, { probe }) {
    const h = ctx.history
    const subs = (await ctx.c.sns.send(new ListSubscriptionsByTopicCommand({ TopicArn: arn.topic(TOPIC) })).catch(() => undefined))?.Subscriptions ?? []
    const subFor = (q: string) => subs.find((s) => s.Endpoint === arn.queue(q))
    const attrsOf = async (q: string) => { const s = subFor(q); return s?.SubscriptionArn ? (await ctx.c.sns.send(new GetSubscriptionAttributesCommand({ SubscriptionArn: s.SubscriptionArn })).catch(() => undefined))?.Attributes : undefined }
    const [ab, as, abody] = await Promise.all([attrsOf('billing'), attrsOf('shipping'), attrsOf('bodyq')])
    const pol = (a?: Record<string, string>) => { try { return JSON.parse(a?.FilterPolicy ?? '') as Record<string, unknown> } catch { return undefined } }
    const pb = pol(ab); const ps = pol(as)
    const filters = JSON.stringify(pb?.type) === '["paid"]' && JSON.stringify(ps?.total ?? '').includes('numeric')
    let routing: boolean | null = null
    let detail: string | undefined
    if (probe) {
      routing = false
      if (subFor('billing') && subFor('shipping') && subFor('audit')) {
        const tag = `probe-${Date.now()}`
        const send = (label: string, type: string, totalN: number) => ctx.c.sns.send(new PublishCommand({ TopicArn: arn.topic(TOPIC), Message: `${tag} ${label}`, MessageAttributes: { type: { DataType: 'String', StringValue: type }, total: { DataType: 'Number', StringValue: String(totalN) } } }))
        await send('A', 'paid', 50); await send('B', 'shipped', 500); await send('C', 'refund', 5)
        const drain = async (q: string, want: number) => {
          const got = new Set<string>()
          await waitFor(async () => {
            const r = await ctx.c.sqs.send(new ReceiveMessageCommand({ QueueUrl: queueUrl(q), MaxNumberOfMessages: 10, WaitTimeSeconds: 1, VisibilityTimeout: 5 }))
            for (const m of r.Messages ?? []) {
              if (m.Body?.includes(tag)) { got.add(m.Body.match(/ ([ABC])\b/)?.[1] ?? '?'); await ctx.c.sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl(q), ReceiptHandle: m.ReceiptHandle! })) }
            }
            return got.size >= want
          }, 8000, 200)
          return [...got].sort().join('')
        }
        const audit = await drain('audit', 3)
        const billing = await drain('billing', 1)
        const shipping = await drain('shipping', 1)
        routing = audit === 'ABC' && billing === 'A' && shipping === 'B'
        detail = `audit ${audit || '-'}, billing ${billing || '-'}, shipping ${shipping || '-'} (expected ABC, A, B)`
      }
    }
    const quarantined = Boolean(subFor('quarantine')) && h.some((r) => r.exitCode === 0 && /sqs receive-message/.test(r.command) && /\/quarantine\b/.test(r.command) && ['', 'None'].includes(r.stdout.trim()))
    return [
      item('subs', 'Topic `orders` has SQS subscriptions for billing, shipping and audit', Boolean(subFor('billing') && subFor('shipping') && subFor('audit')), 'Run the three subscribe commands (step 2).'),
      item('filters', 'Billing filters on type = paid and shipping has a numeric total rule', filters, 'Fix filter-shipping.json, then attach both policies (steps 4 and 5).'),
      item('routing', 'Probe orders are routed correctly: billing paid only, shipping shipped over 100 only, audit all', routing, 'Press Run checks once the filters are attached.', detail),
      item('body', '`bodyq` filters on the message body (FilterPolicyScope = MessageBody)', abody?.FilterPolicyScope === 'MessageBody' && Boolean(pol(abody)), 'Do step 8: subscribe, set the scope, attach filter-body.json.'),
      item('breakit', 'You saw a subscribed queue stay empty because its policy blocks SNS', quarantined, 'Do step 9 and read `quarantine`.'),
    ]
  },
}

/* ---------- 5.6 SQS to Lambda ---------- */
const NAIVE = `export const handler = async (event) => {
  for (const r of event.Records) {
    if (r.body.includes("bad")) throw new Error("cannot process " + r.body);
    console.log("ok", r.body);
  }
  return {};
};
`
export const sqsLambdaBatch: LessonServer = {
  id: 'sqs-lambda-batch',
  files: { 'handler.mjs': NAIVE },
  zips: { 'handler.zip': { 'handler.mjs': NAIVE } },
  async fixture(ctx) {
    await createRole(ctx, 'lambda-exec')
    await ctx.c.iam.send(new PutRolePolicyCommand({ RoleName: 'lambda-exec', PolicyName: 'sqs-and-logs', PolicyDocument: policyDoc([{ Effect: 'Allow', Action: ['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes', 'sqs:ChangeMessageVisibility', 'logs:*'], Resource: '*' }]) }))
    await mkQueue(ctx, 'jobs-dlq')
    await mkQueue(ctx, 'jobs', { VisibilityTimeout: '2', RedrivePolicy: redrive('jobs-dlq', 1) })
  },
  async check(ctx) {
    const h = ctx.history
    const fn = (await ctx.c.lambda.send(new GetFunctionCommand({ FunctionName: 'batch-worker' })).catch(() => undefined))?.Configuration
    const esms = (await ctx.c.lambda.send(new ListEventSourceMappingsCommand({ FunctionName: 'batch-worker' })).catch(() => undefined))?.EventSourceMappings ?? []
    const j = await qattrs(ctx, 'jobs', ['VisibilityTimeout'])
    let src = ''
    try { src = readFileSync(path.join(ctx.workdir, 'handler.mjs'), 'utf8') } catch { /* missing */ }
    let dlq: string[] = []
    if (esms.length) {
      const r = await ctx.c.sqs.send(new ReceiveMessageCommand({ QueueUrl: queueUrl('jobs-dlq'), MaxNumberOfMessages: 10, WaitTimeSeconds: 1, VisibilityTimeout: 0 })).catch(() => undefined)
      dlq = [...new Set((r?.Messages ?? []).map((m) => m.Body ?? ''))]
    }
    return [
      item('fn', 'Function `batch-worker` is Active with a 3 s timeout and your partial-failure handler', fn?.State === 'Active' && fn?.Timeout === 3 && src.includes('batchItemFailures'), 'Edit handler.mjs (step 2), save, then run step 3.', fn ? `${fn.State}, timeout ${fn.Timeout}s` : 'not created'),
      item('breakit', 'You saw Lambda reject a mapping with a too-short visibility timeout', ranFail(h, /create-event-source-mapping/, /visibility/i), 'Run the break-it command before fixing the queue.'),
      item('vis', 'Queue `jobs` visibility timeout is at least 18 seconds', Number(j?.VisibilityTimeout ?? 0) >= 18, 'Run step 5.', `${j?.VisibilityTimeout ?? '?'} s`),
      item('esm', 'The mapping uses ReportBatchItemFailures', esms.some((m) => m.FunctionResponseTypes?.includes('ReportBatchItemFailures')), 'Run step 6 with --function-response-types ReportBatchItemFailures.'),
      item('dlq', 'Only `bad2` is in `jobs-dlq`', dlq.length === 1 && dlq[0] === 'bad2', 'Send the batch (step 7), wait about 30 seconds, then run Check again.', dlq.length ? dlq.join(', ') : 'empty'),
    ]
  },
}

export const MESSAGING_SERVER_LESSONS: LessonServer[] = [sqsVisibility, sqsDlqRedrive, sqsFifo, snsFilterFanout, sqsLambdaBatch]
