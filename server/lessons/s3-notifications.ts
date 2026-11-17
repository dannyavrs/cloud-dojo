import { CreateBucketCommand, GetBucketNotificationConfigurationCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { DeleteMessageCommand, GetQueueAttributesCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs'
import { arn, item, queueUrl, ranFail, ranOk, type Ctx, type LessonServer } from '../lesson-kit'
import { createQueue, policyAllows, sendPolicy, waitFor } from './kit2'

const BUCKET = 'photo-intake'
const Q = 'thumb-jobs'

/** Keys reported by an S3 notification body (or an empty list for anything else, e.g. the TestEvent). */
const keysIn = (body: string): string[] => {
  try { return ((JSON.parse(body).Records ?? []) as { s3?: { object?: { key?: string } } }[]).map((r) => decodeURIComponent((r.s3?.object?.key ?? '').replace(/\+/g, ' '))) } catch { return [] }
}

async function drain(ctx: Ctx, ms: number): Promise<string[]> {
  const seen: string[] = []
  await waitFor(async () => {
    const r = await ctx.c.sqs.send(new ReceiveMessageCommand({ QueueUrl: queueUrl(Q), MaxNumberOfMessages: 10, WaitTimeSeconds: 1, VisibilityTimeout: 1 }))
    for (const m of r.Messages ?? []) {
      seen.push(...keysIn(m.Body ?? ''))
      // only remove messages produced by the checker's own probe uploads, so the learner's messages stay visible
      if ((m.Body ?? '').includes('chk-')) await ctx.c.sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl(Q), ReceiptHandle: m.ReceiptHandle! }))
    }
    return false
  }, ms, 100)
  return seen
}

export const s3Notifications: LessonServer = {
  id: 's3-notifications',
  files: {
    // the starter policy trusts S3 but for the wrong bucket: S3 will still refuse to wire it up
    'queue-policy.json': JSON.stringify({ Policy: sendPolicy('s3.amazonaws.com', arn.queue(Q), 'ArnLike', 'arn:aws:s3:::snap-intake') }, null, 2),
    'notification.json': JSON.stringify({ QueueConfigurations: [{ Id: 'thumbs', QueueArn: arn.queue(Q), Events: ['s3:ObjectCreated:*'] }] }, null, 2),
    'sample.txt': 'pretend this is an image\n',
  },
  async fixture(ctx) {
    await ctx.c.s3.send(new CreateBucketCommand({ Bucket: BUCKET }))
    await createQueue(ctx, Q)
  },
  async check(ctx, { probe }) {
    const h = ctx.history
    const attrs = (await ctx.c.sqs.send(new GetQueueAttributesCommand({ QueueUrl: queueUrl(Q), AttributeNames: ['Policy'] })).catch(() => undefined))?.Attributes
    const cfg = await ctx.c.s3.send(new GetBucketNotificationConfigurationCommand({ Bucket: BUCKET })).catch(() => undefined)
    const rule = (cfg?.QueueConfigurations ?? []).find((q) => q.QueueArn === arn.queue(Q))
    const fr = rule?.Filter?.Key?.FilterRules ?? []
    const val = (n: string) => fr.find((f) => f.Name?.toLowerCase() === n)?.Value
    const configOk = Boolean(rule) && (rule!.Events ?? []).some((e) => /^s3:ObjectCreated:(\*|Put)$/.test(e)) && val('prefix') === 'uploads/' && val('suffix') === '.jpg'
    const saw = ranOk(h, /sqs receive-message/, (o) => o.includes('uploads/cat.jpg') && !o.includes('readme.txt') && !o.includes('DOG.JPG') && !/"key\\?":\s*\\?"cat\.jpg/.test(o))
    let delivery: boolean | null = null
    if (probe) {
      delivery = false
      if (configOk) {
        const tag = `chk-${Date.now()}`
        const put = (Key: string) => ctx.c.s3.send(new PutObjectCommand({ Bucket: BUCKET, Key, Body: 'x' }))
        await put(`uploads/${tag}.jpg`); await put(`uploads/${tag}.txt`); await put(`${tag}.jpg`)
        const seen = (await drain(ctx, 8000)).filter((k) => k.includes(tag))
        delivery = seen.includes(`uploads/${tag}.jpg`) && seen.length === 1
      }
    }
    return [
      item('breakit', 'You saw InvalidArgument when no queue policy allowed S3', ranFail(h, /put-bucket-notification-configuration/, /InvalidArgument/), 'Run the first command before changing anything.'),
      item('policy', 'Queue `thumb-jobs` lets s3.amazonaws.com send from `photo-intake`', policyAllows(attrs?.Policy, 's3.amazonaws.com', 'arn:aws:s3:::photo-intake'), 'Fix the SourceArn in queue-policy.json, Save, then run set-queue-attributes.'),
      item('config', 'The bucket sends ObjectCreated events for prefix uploads/ and suffix .jpg to the queue', configOk, 'Add the Filter block to notification.json, Save, apply it.'),
      item('saw', 'You read the queue and saw uploads/cat.jpg but none of the three non-matching keys', saw, 'Upload the four keys, then run the receive command.'),
      item('delivery', 'A probe upload that matches arrives and the two that do not never do', delivery, 'Press Check after wiring the filter.'),
    ]
  },
}
