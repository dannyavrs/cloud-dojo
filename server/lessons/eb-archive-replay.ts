import { DescribeArchiveCommand, DescribeReplayCommand, PutRuleCommand, PutTargetsCommand } from '@aws-sdk/client-eventbridge'
import { arn, item, ranOk, type LessonServer } from '../lesson-kit'
import { archiveArn, busArn, createBus, createEventsQueue, queueCount, ruleArn, safe } from './eb-kit'

const entry = (orderId: string, total: number) => ({ EventBusName: 'shop', Source: 'shop.orders', DetailType: 'OrderPlaced', Detail: JSON.stringify({ orderId, total }) })
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19) + 'Z'
const replay = (name: string, filter: boolean, from: string, to: string) => ({
  ReplayName: name,
  EventSourceArn: archiveArn('shop-archive'),
  Destination: { Arn: busArn('shop'), ...(filter ? { FilterArns: [ruleArn('shop', 'backfill')] } : {}) },
  EventStartTime: from,
  EventEndTime: to,
})

export const ebArchiveReplay: LessonServer = {
  id: 'eb-archive-replay',
  /** The replay window is written when the module starts: from a minute ago to an hour ahead. */
  get files() {
    const from = iso(Date.now() - 60_000)
    const to = iso(Date.now() + 3_600_000)
    return {
      'events.json': JSON.stringify([entry('o-1', 40), entry('o-2', 250), entry('o-3', 90)], null, 2),
      'replay.json': JSON.stringify(replay('backfill-run', true, from, to), null, 2),
      'replay-all.json': JSON.stringify(replay('replay-all-oops', false, from, to), null, 2),
    }
  },
  async fixture(ctx) {
    await createBus(ctx, 'shop')
    await createEventsQueue(ctx, 'live', 'shop', 'live-orders')
    await createEventsQueue(ctx, 'backfill', 'shop', 'backfill')
    await ctx.c.events.send(new PutRuleCommand({ Name: 'live-orders', EventBusName: 'shop', EventPattern: JSON.stringify({ source: ['shop.orders'] }) }))
    await ctx.c.events.send(new PutRuleCommand({ Name: 'backfill', EventBusName: 'shop', EventPattern: JSON.stringify({ source: ['shop.orders'], 'replay-name': [{ exists: true }] }) }))
    await ctx.c.events.send(new PutTargetsCommand({ Rule: 'live-orders', EventBusName: 'shop', Targets: [{ Id: 'live', Arn: arn.queue('live') }] }))
    await ctx.c.events.send(new PutTargetsCommand({ Rule: 'backfill', EventBusName: 'shop', Targets: [{ Id: 'backfill', Arn: arn.queue('backfill') }] }))
  },
  async check(ctx) {
    const h = ctx.history
    const a = await safe(ctx.c.events.send(new DescribeArchiveCommand({ ArchiveName: 'shop-archive' })))
    const archived = a?.State === 'ENABLED' && a.EventSourceArn === busArn('shop')
    const rp = await safe(ctx.c.events.send(new DescribeReplayCommand({ ReplayName: 'backfill-run' })))
    const filtered = rp?.State === 'COMPLETED' && (rp.Destination?.FilterArns ?? []).includes(ruleArn('shop', 'backfill'))
    const back = await queueCount(ctx, 'backfill')
    const live = await queueCount(ctx, 'live')
    return [
      item('archive', 'Archive `shop-archive` on bus `shop` is ENABLED', archived, 'create-archive with the bus ARN.', a?.State),
      item('captured', 'The archive captured at least 3 events', (a?.EventCount ?? 0) >= 3, 'Publish events.json after creating the archive, then wait a few seconds.', `${a?.EventCount ?? 0} event(s)`),
      item('replay', 'A replay restricted to the `backfill` rule COMPLETED', filtered, 'start-replay with replay.json, then describe-replay.', rp?.State),
      item('backfill', 'The `backfill` queue received the replayed orders', back >= 3, 'Wait a few seconds after the replay completes.', `${back} message(s)`),
      item('breakit', 'You saw the unfiltered replay duplicate orders into `live`', ranOk(h, /start-replay.*replay-all/) && live >= 6, 'Run start-replay with replay-all.json, then count the `live` queue (6).', `live has ${live}`),
    ]
  },
}
