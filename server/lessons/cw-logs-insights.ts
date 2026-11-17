import { DescribeLogGroupsCommand, DescribeMetricFiltersCommand, CreateLogGroupCommand, CreateLogStreamCommand, PutLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs'
import { item, ranOk, type LessonServer } from '../lesson-kit'
import { datapoints, sumOf, windowJson } from './cw-kit'

const GROUP = '/dojo/checkout'
const nowMs = () => Date.now()

const eventsFile = () => {
  const t = nowMs()
  const lines = ['INFO order 2001 placed', 'ERROR order 2002 payment declined', 'ERROR order 2003 timeout calling inventory', 'INFO order 2004 placed', 'ERROR order 2005 card expired', 'INFO order 2006 placed']
  return JSON.stringify(lines.map((message, i) => ({ timestamp: t + i, message })), null, 2) + '\n'
}
const queryFile = () => {
  const w = JSON.parse(windowJson())
  return JSON.stringify({ logGroupName: GROUP, startTime: Math.floor(nowMs() / 1000) - 3600, endTime: w.EndTime, queryString: 'fields @timestamp, @message | filter @message like /ERROR/ | sort @timestamp desc | limit 20' }, null, 2) + '\n'
}

const nonEmptyRows = (o: string) => /"status":\s*"Complete"/.test(o) && /"results":\s*\[\s*\[/.test(o)

export const cwLogsInsights: LessonServer = {
  id: 'cw-logs-insights',
  get files() { return { 'window.json': windowJson(), 'events.json': eventsFile(), 'query.json': queryFile() } },
  async fixture(ctx) {
    await ctx.c.logs.send(new CreateLogGroupCommand({ logGroupName: GROUP }))
    await ctx.c.logs.send(new CreateLogStreamCommand({ logGroupName: GROUP, logStreamName: 'web-1' }))
    const t = nowMs() - 5 * 60_000
    const past = ['INFO order 1001 placed', 'ERROR order 1002 payment declined', 'INFO order 1003 placed', 'ERROR order 1004 timeout calling inventory', 'INFO order 1005 placed']
    await ctx.c.logs.send(new PutLogEventsCommand({ logGroupName: GROUP, logStreamName: 'web-1', logEvents: past.map((message, i) => ({ timestamp: t + i * 1000, message })) }))
  },
  async check(ctx) {
    const h = ctx.history
    const g = (await ctx.c.logs.send(new DescribeLogGroupsCommand({ logGroupNamePrefix: GROUP })).catch(() => undefined))?.logGroups?.find((x) => x.logGroupName === GROUP)
    const filters = (await ctx.c.logs.send(new DescribeMetricFiltersCommand({ logGroupName: GROUP })).catch(() => undefined))?.metricFilters ?? []
    const filterOk = filters.some((f) => /ERROR/.test(f.filterPattern ?? '') && (f.metricTransformations ?? []).some((m) => m.metricName === 'CheckoutErrors' && m.metricNamespace === 'Dojo'))
    const sum = sumOf(await datapoints(ctx, 'Dojo', 'CheckoutErrors', { stats: ['Sum'] }))
    const caseSeen = ranOk(h, /test-metric-filter/, (o) => /"matches":\s*\[\]/.test(o))
    const rows = ranOk(h, /get-query-results/, (o) => nonEmptyRows(o) && /@message/.test(o)) && ranOk(h, /start-query/, (o) => /"queryId"/.test(o))
    const agg = ranOk(h, /get-query-results/, (o) => nonEmptyRows(o) && !/@ptr/.test(o))
    return [
      item('retention', 'The log group keeps events for 7 days', g?.retentionInDays === 7, 'Run `put-retention-policy` with `--retention-in-days 7`.'),
      item('breakit', 'You saw a lower-case pattern match nothing', caseSeen, 'Run the `test-metric-filter` command with `"error"` and read the empty matches list.'),
      item('filter', 'A metric filter on "ERROR" writes Dojo/CheckoutErrors', filterOk, 'Create it with `put-metric-filter` and `metricName=CheckoutErrors,metricNamespace=Dojo,metricValue=1`.'),
      item('emits', 'Your new ERROR events became metric data (Sum above 0)', sum > 0, 'Write `events.json` with `put-log-events` after the filter exists, then wait a moment.', sum > 0 ? `Sum ${sum}` : undefined),
      item('insights', 'An Insights query completed and returned log rows', rows, 'Run `start-query`, then `get-query-results` with the queryId until the status is Complete.'),
      item('stats', 'A stats query returned aggregated rows', agg, "Start the query with `--query-string 'stats count(*) as events by bin(5m)'` and fetch its results."),
    ]
  },
}
