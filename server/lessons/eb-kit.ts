import { CreateEventBusCommand, DescribeEventBusCommand, DescribeRuleCommand, ListTargetsByRuleCommand } from '@aws-sdk/client-eventbridge'
import { GetQueueAttributesCommand, DeleteMessageCommand, ReceiveMessageCommand, SetQueueAttributesCommand } from '@aws-sdk/client-sqs'
import { ACCOUNT, queueUrl, type Ctx } from '../lesson-kit'
import { createQueue, sendPolicy, waitFor } from './kit2'

export const trust = (service: string) => JSON.stringify({
  Version: '2012-10-17',
  Statement: [{ Effect: 'Allow', Principal: { Service: service }, Action: 'sts:AssumeRole' }],
}, null, 2)

export const busArn = (bus: string) => `arn:aws:events:us-east-1:${ACCOUNT}:event-bus/${bus}`
export const ruleArn = (bus: string, rule: string) => `arn:aws:events:us-east-1:${ACCOUNT}:rule/${bus}/${rule}`
export const archiveArn = (name: string) => `arn:aws:events:us-east-1:${ACCOUNT}:archive/${name}`
export const sfnArn = (name: string) => `arn:aws:states:us-east-1:${ACCOUNT}:stateMachine:${name}`

export const safe = async <T,>(p: Promise<T>): Promise<T | undefined> => p.catch(() => undefined)

export async function createBus(ctx: Ctx, name: string) {
  await ctx.c.events.send(new CreateEventBusCommand({ Name: name }))
}

export const busExists = async (ctx: Ctx, name: string) => Boolean(await safe(ctx.c.events.send(new DescribeEventBusCommand({ Name: name }))))

export const getRule = (ctx: Ctx, bus: string, rule: string) => safe(ctx.c.events.send(new DescribeRuleCommand({ EventBusName: bus, Name: rule })))

export async function targetsOf(ctx: Ctx, bus: string, rule: string) {
  return (await safe(ctx.c.events.send(new ListTargetsByRuleCommand({ EventBusName: bus, Rule: rule }))))?.Targets ?? []
}

/** Create a queue that EventBridge may send to, only from the given rule (the access policy real AWS needs). */
export async function createEventsQueue(ctx: Ctx, name: string, bus: string, rule: string) {
  const url = await createQueue(ctx, name)
  await ctx.c.sqs.send(new SetQueueAttributesCommand({
    QueueUrl: url,
    Attributes: { Policy: sendPolicy('events.amazonaws.com', `arn:aws:sqs:us-east-1:${ACCOUNT}:${name}`, 'ArnEquals', ruleArn(bus, rule)) },
  }))
  return url
}

/** Messages in a queue, visible plus in flight. */
export async function queueCount(ctx: Ctx, name: string): Promise<number> {
  const a = (await safe(ctx.c.sqs.send(new GetQueueAttributesCommand({ QueueUrl: queueUrl(name), AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'] }))))?.Attributes
  return Number(a?.ApproximateNumberOfMessages ?? 0) + Number(a?.ApproximateNumberOfMessagesNotVisible ?? 0)
}

/** Wait for a message containing `tag`; delete it when found. */
export async function receiveTagged(ctx: Ctx, name: string, tag: string, ms = 8000): Promise<boolean> {
  const url = queueUrl(name)
  return waitFor(async () => {
    const r = await ctx.c.sqs.send(new ReceiveMessageCommand({ QueueUrl: url, MaxNumberOfMessages: 10, WaitTimeSeconds: 1, VisibilityTimeout: 1 }))
    const hit = (r.Messages ?? []).filter((m) => m.Body?.includes(tag))
    for (const m of hit) await ctx.c.sqs.send(new DeleteMessageCommand({ QueueUrl: url, ReceiptHandle: m.ReceiptHandle! }))
    return hit.length > 0
  }, ms, 200)
}
