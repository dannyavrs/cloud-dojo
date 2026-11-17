import { ListMetricsCommand } from '@aws-sdk/client-cloudwatch'
import { item, ranFail, ranOk, type LessonServer } from '../lesson-kit'
import { datapoints, flagOf, sumOf, windowJson } from './cw-kit'

const METRIC_DATA = JSON.stringify([
  { MetricName: 'Latency', Unit: 'Milliseconds', Value: 120 },
  { MetricName: 'Latency', Unit: 'Milliseconds', Value: 80 },
  { MetricName: 'Latency', Unit: 'Milliseconds', Value: 400 },
], null, 2) + '\n'

const queries = () => {
  const w = JSON.parse(windowJson())
  return JSON.stringify({
    StartTime: w.StartTime, EndTime: w.EndTime,
    MetricDataQueries: [
      { Id: 'errors', MetricStat: { Metric: { Namespace: 'Dojo', MetricName: 'Errors' }, Period: 60, Stat: 'Sum' }, ReturnData: false },
      { Id: 'latency', Label: 'Average latency (ms)', MetricStat: { Metric: { Namespace: 'Dojo', MetricName: 'Latency' }, Period: 60, Stat: 'Average' } },
      { Id: 'slowest', Label: 'Slowest request (ms)', MetricStat: { Metric: { Namespace: 'Dojo', MetricName: 'Latency' }, Period: 60, Stat: 'Maximum' } },
      { Id: 'errors_x2', Label: 'Errors doubled', Expression: 'errors * 2' },
    ],
  }, null, 2) + '\n'
}

export const cwMetrics: LessonServer = {
  id: 'cw-metrics',
  // evaluated on every module start so the time window is always "now"
  get files() { return { 'window.json': windowJson(), 'metric-data.json': METRIC_DATA, 'queries.json': queries() } },
  async check(ctx) {
    const h = ctx.history
    const errs = await datapoints(ctx, 'Dojo', 'Errors', { stats: ['Sum', 'SampleCount'] })
    const sum = sumOf(errs)
    const lat = await datapoints(ctx, 'Dojo', 'Latency', { stats: ['SampleCount'] })
    const metrics = (await ctx.c.cw.send(new ListMetricsCommand({ Namespace: 'Dojo', MetricName: 'Errors' })).catch(() => undefined))?.Metrics ?? []
    const plain = metrics.some((m) => !(m.Dimensions ?? []).length)
    const sliced = metrics.some((m) => (m.Dimensions ?? []).some((d) => d.Name === 'Service' && d.Value === 'checkout'))
    const read = ranOk(h, /get-metric-statistics/, (o) => /"Sum":\s*5(\.0)?\b/.test(o) && !/"Datapoints":\s*\[\]/.test(o))
    const pct = ranOk(h, /get-metric-statistics.*--extended-statistics/, (o) => /"p99"/.test(o))
    const math = ranOk(h, /get-metric-data/, (o) => /"StatusCode":\s*"Complete"/.test(o) && /"Values":\s*\[\s*[\d-]/.test(o))
    const wrongNs = h.some((r) => !r.rejected && r.exitCode === 0 && /get-metric-statistics/.test(r.command) && (flagOf(r.command, '--namespace') ?? 'Dojo') !== 'Dojo' && /"Datapoints":\s*\[\]/.test(r.stdout))
    return [
      item('put', 'Dojo/Errors has one datapoint with Sum 5', sum === 5, 'Publish the value 5 once with `put-metric-data`. If you published it twice, Reset module.', sum > 0 && sum !== 5 ? `Sum is ${sum}` : undefined),
      item('read', 'You read Errors back with get-metric-statistics and saw Sum 5', read, 'Run the statistics command with `--cli-input-json file://window.json`.'),
      item('batch', 'Dojo/Latency holds three samples and you read its percentiles', sumOf(lat, 'SampleCount') >= 3 && pct, 'Publish `metric-data.json`, then run the `--extended-statistics p50 p99` command.'),
      item('dims', 'Errors exists with and without the Service=checkout dimension', plain && sliced, 'Publish a second Errors datapoint with `--dimensions Service=checkout`.'),
      item('math', 'A metric-math query returned a computed series', math, 'Run `get-metric-data` with `file://queries.json`.'),
      item('breakit', 'You saw an empty result for a mistyped namespace', wrongNs, 'Query Errors with `--namespace dojo` (lower case) and read the empty Datapoints list.'),
      item('limits', 'You saw both input limits (AWS/ namespace, timestamp too old)', ranFail(h, /put-metric-data.*--namespace AWS\//, /InvalidParameterValue/) && ranFail(h, /put-metric-data.*--timestamp/, /InvalidParameterValue/), 'Run both commands in the last step; each should fail with InvalidParameterValue.'),
    ]
  },
}
