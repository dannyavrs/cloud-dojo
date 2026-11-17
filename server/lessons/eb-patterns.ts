import { PutEventsCommand } from '@aws-sdk/client-eventbridge'
import { GetQueueAttributesCommand } from '@aws-sdk/client-sqs'
import { ACCOUNT, arn, historyHas, item, queueUrl, ranOk, type LessonServer } from '../lesson-kit'
import { createQueue, policyAllows, sendPolicy } from './kit2'
import { busExists, getRule, receiveTagged, ruleArn, safe, targetsOf } from './eb-kit'

const pattern = { source: ['shop.orders'], 'detail-type': ['OrderPlaced'], detail: { total: [{ numeric: ['>=', 100] }] } }
const patternString = { source: ['shop.orders'], 'detail-type': ['OrderPlaced'], detail: { total: ['>=100'] } }
const envelope = (id: string, total: number) => ({ id, source: 'shop.orders', 'detail-type': 'OrderPlaced', account: ACCOUNT, time: '2026-11-15T10:00:00Z', region: 'us-east-1', resources: [], detail: { orderId: id, total } })
const entry = (orderId: string, total: number) => ({ EventBusName: 'shop', Source: 'shop.orders', DetailType: 'OrderPlaced', Detail: JSON.stringify({ orderId, total }) })

export const ebPatterns: LessonServer = {
  id: 'eb-patterns',
  files: {
    'pattern.json': JSON.stringify(pattern, null, 2),
    'pattern-string.json': JSON.stringify(patternString, null, 2),
    'event-big.json': JSON.stringify(envelope('o-big', 250), null, 2),
    'event-small.json': JSON.stringify(envelope('o-small', 5), null, 2),
    'events.json': JSON.stringify([entry('o-big', 250), entry('o-small', 5)], null, 2),
    'queue-policy.json': JSON.stringify({ Policy: sendPolicy('events.amazonaws.com', arn.queue('order-alerts'), 'ArnEquals', ruleArn('shop', 'big-orders')) }, null, 2),
  },
  async fixture(ctx) {
    await createQueue(ctx, 'order-alerts')
  },
  async check(ctx, { probe }) {
    const h = ctx.history
    const bus = await busExists(ctx, 'shop')
    const rule = await getRule(ctx, 'shop', 'big-orders')
    const rulePattern = rule?.EventPattern ?? ''
    const numeric = /numeric/.test(rulePattern) && /total/.test(rulePattern)
    const qa = (await safe(ctx.c.sqs.send(new GetQueueAttributesCommand({ QueueUrl: queueUrl('order-alerts'), AttributeNames: ['Policy'] }))))?.Attributes
    const policy = policyAllows(qa?.Policy, 'events.amazonaws.com', 'rule/shop/big-orders')
    const targets = await targetsOf(ctx, 'shop', 'big-orders')
    const targeted = targets.some((t) => t.Arn === arn.queue('order-alerts'))
    const testedBig = ranOk(h, /test-event-pattern.*event-big/, (o) => /true/i.test(o))
    const testedSmall = ranOk(h, /test-event-pattern.*event-small/, (o) => /false/i.test(o))
    const sawBreak = ranOk(h, /test-event-pattern.*pattern-string/, (o) => /false/i.test(o))
    let delivery: boolean | null = null
    let detail: string | undefined
    if (probe) {
      delivery = false
      if (bus && rule && policy && targeted) {
        const tag = `probe-${Date.now()}`
        const r = await safe(ctx.c.events.send(new PutEventsCommand({ Entries: [entry(`${tag}-big`, 500), entry(`${tag}-small`, 1)] })))
        detail = `FailedEntryCount ${r?.FailedEntryCount}`
        const big = await receiveTagged(ctx, 'order-alerts', `${tag}-big`)
        const small = big ? await receiveTagged(ctx, 'order-alerts', `${tag}-small`, 2000) : false
        delivery = big && !small
        detail += big ? (small ? ', but the small order arrived too' : ', only the big order arrived') : ', the big order did not arrive'
      }
    }
    return [
      item('bus', 'The custom bus `shop` exists', bus, 'Run `aws events create-event-bus --name shop`.'),
      item('tested', '`test-event-pattern` said true for the big order and false for the small one', testedBig && testedSmall, 'Run both test-event-pattern commands from step 2.'),
      item('breakit', 'You saw the string-written numeric pattern fail to match', sawBreak && historyHas(h, /test-event-pattern/), 'Run test-event-pattern with pattern-string.json and event-big.json: the answer is false.'),
      item('rule', 'Rule `big-orders` on `shop` has a numeric `total` pattern', numeric, 'put-rule with pattern.json on bus shop.', rule?.State),
      item('policy', 'Queue `order-alerts` allows EventBridge to send', policy, 'Apply queue-policy.json.'),
      item('target', 'The rule targets `order-alerts`', targeted, 'put-targets with the queue ARN.', `${targets.length} target(s)`),
      item('delivery', 'A probe big order arrives and a probe small order does not', delivery, 'Press Check after the rule, policy and target are in place.', detail),
    ]
  },
}
