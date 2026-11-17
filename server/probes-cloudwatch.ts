import { CreateLogGroupCommand, CreateLogStreamCommand, GetQueryResultsCommand, PutLogEventsCommand, PutMetricFilterCommand, StartQueryCommand } from '@aws-sdk/client-cloudwatch-logs'
import { GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch'
import type { Probe } from './capabilities'
import type { Clients } from './clients'

/** One log group per probe: the probes may run concurrently on the same emulator. */
async function seedLogs(c: Clients, GROUP: string) {
  await c.logs.send(new CreateLogGroupCommand({ logGroupName: GROUP }))
  await c.logs.send(new CreateLogStreamCommand({ logGroupName: GROUP, logStreamName: 's' }))
}

const put = (c: Clients, GROUP: string, ...messages: string[]) => c.logs.send(new PutLogEventsCommand({
  logGroupName: GROUP, logStreamName: 's', logEvents: messages.map((message, i) => ({ timestamp: Date.now() + i, message })),
}))

/** Capability probes for the CloudWatch track (run once per emulator image; set honesty badges). */
export const CW_PROBES: Probe[] = [
  { key: 'cw-metric-filter-emits', label: 'A CloudWatch Logs metric filter turns new log events into metric data', async run(root) {
    const GROUP = '/probe/cw-filter'
    await seedLogs(root, GROUP)
    await root.logs.send(new PutMetricFilterCommand({ logGroupName: GROUP, filterName: 'errs', filterPattern: '"ERROR"', metricTransformations: [{ metricName: 'ProbeErrors', metricNamespace: 'Probe', metricValue: '1' }] }))
    await put(root, GROUP, 'INFO ok', 'ERROR one', 'ERROR two')
    for (let i = 0; i < 20; i++) {
      const r = await root.cw.send(new GetMetricStatisticsCommand({ Namespace: 'Probe', MetricName: 'ProbeErrors', StartTime: new Date(Date.now() - 3600_000), EndTime: new Date(Date.now() + 3600_000), Period: 60, Statistics: ['Sum'] }))
      const sum = (r.Datapoints ?? []).reduce((s, d) => s + (d.Sum ?? 0), 0)
      if (sum === 2) return { enforced: true, detail: 'Two ERROR events produced Sum 2.' }
      if (sum > 0) return { enforced: false, detail: `Unexpected Sum ${sum} for two matching events.` }
      await Bun.sleep(500)
    }
    return { enforced: false, detail: 'No metric data appeared after 10 s.' }
  } },
  { key: 'cw-insights-rows', label: 'Logs Insights start-query / get-query-results return real rows', async run(root) {
    const GROUP = '/probe/cw-insights'
    await seedLogs(root, GROUP)
    await put(root, GROUP, 'ERROR alpha', 'INFO beta', 'ERROR gamma')
    const now = Math.floor(Date.now() / 1000)
    const { queryId } = await root.logs.send(new StartQueryCommand({ logGroupName: GROUP, startTime: now - 3600, endTime: now + 600, queryString: 'filter @message like /ERROR/ | stats count(*) as n' }))
    for (let i = 0; i < 20; i++) {
      const r = await root.logs.send(new GetQueryResultsCommand({ queryId }))
      if (r.status === 'Complete') {
        const n = r.results?.[0]?.find((f) => f.field === 'n')?.value
        return { enforced: n === '2', detail: `status Complete, count(*) = ${n ?? 'no row'}` }
      }
      if (r.status === 'Failed' || r.status === 'Cancelled') return { enforced: false, detail: `query ${r.status}` }
      await Bun.sleep(500)
    }
    return { enforced: false, detail: 'Query did not complete in 10 s.' }
  } },
]
