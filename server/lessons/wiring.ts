import { GetBucketNotificationConfigurationCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { CreateBucketCommand } from '@aws-sdk/client-s3'
import { GetQueueAttributesCommand, DeleteMessageCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs'
import { ListSubscriptionsByTopicCommand, PublishCommand } from '@aws-sdk/client-sns'
import { ListEventSourceMappingsCommand, GetPolicyCommand } from '@aws-sdk/client-lambda'
import { GetApisCommand } from '@aws-sdk/client-apigatewayv2'
import { arn, item, LAMBDA_TRUST, queueUrl, type Ctx, type LessonServer } from '../lesson-kit'
import { createFunction, createQueue, createRole, logsContain, policyAllows, sendPolicy, sources, waitFor } from './kit2'

const attrsFile = (q: string, topic: string) => JSON.stringify({ Policy: sendPolicy('sns.amazonaws.com', arn.queue(q), 'ArnEquals', arn.topic(topic)) }, null, 2)

async function receiveTagged(ctx: Ctx, url: string, tag: string, ms = 6000): Promise<boolean> {
  return waitFor(async () => {
    const r = await ctx.c.sqs.send(new ReceiveMessageCommand({ QueueUrl: url, MaxNumberOfMessages: 10, WaitTimeSeconds: 1, VisibilityTimeout: 1 }))
    const hit = (r.Messages ?? []).filter((m) => m.Body?.includes(tag))
    for (const m of hit) await ctx.c.sqs.send(new DeleteMessageCommand({ QueueUrl: url, ReceiptHandle: m.ReceiptHandle! }))
    return hit.length > 0
  }, ms, 200)
}

export const snsSqs: LessonServer = {
  id: 'sns-sqs',
  files: { 'attrs-a.json': attrsFile('orders-a', 'order-events'), 'attrs-b.json': attrsFile('orders-b', 'order-events') },
  async check(ctx, { probe }) {
    const attr = async (q: string) => (await ctx.c.sqs.send(new GetQueueAttributesCommand({ QueueUrl: queueUrl(q), AttributeNames: ['All'] })).catch(() => undefined))?.Attributes
    const [a, b] = [await attr('orders-a'), await attr('orders-b')]
    const subs = (await ctx.c.sns.send(new ListSubscriptionsByTopicCommand({ TopicArn: arn.topic('order-events') })).catch(() => undefined))?.Subscriptions ?? []
    const sqsSubs = subs.filter((s) => s.Protocol === 'sqs')
    const t = arn.topic('order-events')
    const pol = policyAllows(a?.Policy, 'sns.amazonaws.com', t) && policyAllows(b?.Policy, 'sns.amazonaws.com', t)
    let delivery: boolean | null = null
    if (probe) {
      delivery = false
      if (sqsSubs.length >= 2) {
        const tag = `probe-${Date.now()}`
        await ctx.c.sns.send(new PublishCommand({ TopicArn: t, Message: JSON.stringify({ tag }) }))
        const [x, y] = await Promise.all([receiveTagged(ctx, queueUrl('orders-a'), tag), receiveTagged(ctx, queueUrl('orders-b'), tag)])
        delivery = x && y
      }
    }
    return [
      item('queues', 'Queues `orders-a` and `orders-b` exist', Boolean(a && b), 'Step 1.'),
      item('subs', 'Topic `order-events` has 2 SQS subscriptions', sqsSubs.length >= 2, 'Steps 2 and 3.', `${sqsSubs.length} sqs subscription(s)`),
      item('policies', 'Both queue policies allow SNS from this topic', pol, 'Apply attrs-a.json and attrs-b.json.'),
      item('delivery', 'A probe message reaches both queues', delivery, 'Press Check after applying the policies.'),
    ]
  },
}

export const s3SqsLambda: LessonServer = {
  id: 's3-sqs-lambda',
  files: {
    'notification.json': JSON.stringify({ QueueConfigurations: [{ QueueArn: arn.queue('photo-jobs'), Events: ['s3:ObjectCreated:*'] }] }, null, 2),
    'queue-policy.json': JSON.stringify({ Policy: sendPolicy('s3.amazonaws.com', arn.queue('photo-jobs'), 'ArnLike', 'arn:aws:s3:::snap-photos') }, null, 2),
    'photo.txt': 'pretend this is a photo\n',
  },
  zips: { 'worker.zip': { 'worker.mjs': sources.photoWorker } },
  async fixture(ctx) {
    await ctx.c.s3.send(new CreateBucketCommand({ Bucket: 'snap-photos' }))
    await createQueue(ctx, 'photo-jobs')
    await createRole(ctx, 'lambda-exec', LAMBDA_TRUST)
    await createFunction(ctx, 'photo-worker', 'worker.handler', 'worker.zip', 'lambda-exec')
  },
  async check(ctx, { probe }) {
    const qa = (await ctx.c.sqs.send(new GetQueueAttributesCommand({ QueueUrl: queueUrl('photo-jobs'), AttributeNames: ['Policy'] })).catch(() => undefined))?.Attributes
    const n = await ctx.c.s3.send(new GetBucketNotificationConfigurationCommand({ Bucket: 'snap-photos' })).catch(() => undefined)
    const notified = (n?.QueueConfigurations ?? []).some((q) => q.QueueArn === arn.queue('photo-jobs'))
    const esms = (await ctx.c.lambda.send(new ListEventSourceMappingsCommand({ FunctionName: 'photo-worker' })).catch(() => undefined))?.EventSourceMappings ?? []
    const esm = esms.some((e) => e.EventSourceArn === arn.queue('photo-jobs') && e.State === 'Enabled')
    let e2e: boolean | null = null
    if (probe) {
      e2e = false
      if (notified && esm) {
        const key = `probe/${Date.now()}.txt`
        await ctx.c.s3.send(new PutObjectCommand({ Bucket: 'snap-photos', Key: key, Body: 'probe' }))
        e2e = await waitFor(() => logsContain(ctx, '/aws/lambda/photo-worker', key), 20000, 1000)
      }
    }
    return [
      item('policy', 'Queue `photo-jobs` allows S3 to send', policyAllows(qa?.Policy, 's3.amazonaws.com', 'arn:aws:s3:::snap-photos'), 'Apply queue-policy.json.'),
      item('notify', 'The bucket notifies `photo-jobs` on object creation', notified, 'Apply notification.json after the queue policy.'),
      item('esm', 'Event source mapping to `photo-worker` is Enabled', esm, 'Attach the SQS execution policy, then create the mapping.', esms.map((e) => e.State).join(',')),
      item('e2e', "A probe upload reaches the worker's logs", e2e, 'Press Check; give the mapping a few seconds to start polling.'),
    ]
  },
}

export const httpApi: LessonServer = {
  id: 'http-api',
  zips: { 'hello-api.zip': { 'hello-api.mjs': sources.helloApi }, 'broken-api.zip': { 'broken-api.mjs': sources.brokenApi } },
  async fixture(ctx) {
    await createRole(ctx, 'lambda-exec', LAMBDA_TRUST)
    await createFunction(ctx, 'hello-api', 'hello-api.handler', 'hello-api.zip', 'lambda-exec')
    await createFunction(ctx, 'broken-api', 'broken-api.handler', 'broken-api.zip', 'lambda-exec')
  },
  async check(ctx, { probe }) {
    let perm = false
    try { perm = JSON.stringify(JSON.parse((await ctx.c.lambda.send(new GetPolicyCommand({ FunctionName: 'hello-api' }))).Policy ?? '{}')).includes('apigateway.amazonaws.com') } catch { /* none */ }
    const apis = (await ctx.c.apigw.send(new GetApisCommand({}))).Items ?? []
    const api = apis.find((a) => a.ProtocolType === 'HTTP' && a.Name !== 'broken-api')
    const brokenApi = apis.find((a) => a.Name === 'broken-api')
    let call: boolean | null = null
    let broken: boolean | null = brokenApi ? null : false
    let detail: string | undefined
    if (probe) {
      if (brokenApi?.ApiEndpoint) broken = await ctx.httpGet(brokenApi.ApiEndpoint + '/').then((r) => r.status === 500, () => false)
      call = false
      if (api?.ApiEndpoint) {
        try {
          const r = await ctx.httpGet(api.ApiEndpoint + '/')
          detail = `${r.status} ${r.body.slice(0, 120)}`
          call = r.status === 200 && r.body.includes('Hello from hello-api')
        } catch (e) { detail = String(e) }
      }
    }
    return [
      item('perm', 'Lambda allows apigateway.amazonaws.com to invoke `hello-api`', perm, 'Step 1.'),
      item('api', 'An HTTP API with a $default stage targets `hello-api`', Boolean(api), 'Step 2.', api?.ApiEndpoint),
      item('call', 'GET on the endpoint returns 200 with JSON', call, 'Press Check after creating the API.', detail),
      item('broken', 'You saw API Gateway answer 500 for the broken function', broken, 'Run the break-it step and GET its endpoint in the probe.'),
    ]
  },
}
