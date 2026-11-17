import { PutMetricDataCommand, PutMetricAlarmCommand, GetDashboardCommand } from '@aws-sdk/client-cloudwatch'
import { item, ranFail, ranOk, type LessonServer } from '../lesson-kit'
import { CW_DASH_STARTER } from '../../shared/lessons/cw-dashboards'
import { clearRender, lastRender } from '../dashboard-api'

// 45 minutes of data in 5-minute steps, newest last
const ERRORS = [1, 0, 2, 1, 4, 6, 3, 2, 5]
const LATENCY = [120, 95, 110, 180, 260, 310, 240, 150, 130]

type Widget = { type?: string; properties?: { region?: string } }
async function stored(ctx: Parameters<LessonServer['check']>[0]): Promise<Widget[] | undefined> {
  try {
    const r = await ctx.c.cw.send(new GetDashboardCommand({ DashboardName: 'checkout' }))
    const w = JSON.parse(r.DashboardBody ?? '{}').widgets
    return Array.isArray(w) ? w : undefined
  } catch { return undefined }
}

export const cwDashboards: LessonServer = {
  id: 'cw-dashboards',
  files: { 'dashboard.json': CW_DASH_STARTER + '\n' },
  async fixture(ctx) {
    clearRender()
    const now = Date.now()
    const at = (i: number) => new Date(now - (ERRORS.length - 1 - i) * 5 * 60_000)
    await ctx.c.cw.send(new PutMetricDataCommand({
      Namespace: 'Dojo',
      MetricData: [
        ...ERRORS.map((v, i) => ({ MetricName: 'Errors', Value: v, Unit: 'Count' as const, Timestamp: at(i) })),
        // two samples per slot, so Average and Maximum differ
        ...LATENCY.flatMap((v, i) => [Math.round(v * 0.8), Math.round(v * 1.2)].map((x) => ({ MetricName: 'Latency', Value: x, Unit: 'Milliseconds' as const, Timestamp: at(i) }))),
      ],
    }))
    await ctx.c.cw.send(new PutMetricAlarmCommand({ AlarmName: 'checkout-errors', Namespace: 'Dojo', MetricName: 'Errors', Statistic: 'Sum', Period: 300, EvaluationPeriods: 1, Threshold: 3, ComparisonOperator: 'GreaterThanThreshold', TreatMissingData: 'notBreaching' }))
    await ctx.c.cw.send(new PutMetricAlarmCommand({ AlarmName: 'checkout-latency', Namespace: 'Dojo', MetricName: 'Latency', Statistic: 'Maximum', Period: 300, EvaluationPeriods: 1, Threshold: 300, ComparisonOperator: 'GreaterThanThreshold', TreatMissingData: 'notBreaching' }))
  },
  async check(ctx) {
    const h = ctx.history
    const w = await stored(ctx)
    const metric = (w ?? []).filter((x) => x.type === 'metric')
    const okStored = Boolean(w) && metric.length > 0 && metric.every((x) => Boolean(x.properties?.region))
    const full = Boolean(w) && w!.length >= 5 && w!.some((x) => x.type === 'text') && metric.length >= 3 && w!.some((x) => x.type === 'alarm')
    const r = lastRender('checkout')
    return [
      item('breakit', 'You saw put-dashboard reject a metric widget without a region', ranFail(h, /put-dashboard/, /InvalidParameterInput/) && h.some((x) => /put-dashboard/.test(x.command) && /region/i.test(x.stderr)), 'Run `put-dashboard` on the unedited `dashboard.json`.'),
      item('stored', 'Dashboard checkout is stored and every metric widget names a region', okStored, 'Add `"region": "us-east-1"` to the metric widget, save, and run `put-dashboard` again.'),
      item('get', 'You read the dashboard back with get-dashboard', ranOk(h, /get-dashboard/, (o) => /DashboardBody/.test(o)), 'Run `aws cloudwatch get-dashboard --dashboard-name checkout`.'),
      item('full', 'The dashboard has a text widget, two metric charts, a number and an alarm tile', full, 'Replace `dashboard.json` with the five-widget body and store it again.', w ? `${w.length} widget${w.length === 1 ? '' : 's'} stored` : undefined),
      item('rendered', 'The mini dashboard drew your five widgets', full && (r?.widgets ?? 0) >= 5 && !r?.error, 'Keep this page open after storing the full body; it draws within a few seconds.'),
    ]
  },
}
