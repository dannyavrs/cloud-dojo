import { DescribeAlarmsCommand, GetDashboardCommand, GetMetricDataCommand, type MetricDataQuery } from '@aws-sdk/client-cloudwatch'
import type { DashboardView, DashWidget } from '../shared/dashboard-view'
import type { Clients } from './clients'

const MAX_WIDGETS = 40
const MAX_SERIES = 12
const NAME = /^[A-Za-z0-9_-]{1,255}$/
const SYMBOL: Record<string, string> = { GreaterThanThreshold: '>', GreaterThanOrEqualToThreshold: '>=', LessThanThreshold: '<', LessThanOrEqualToThreshold: '<=' }

/** The last dashboard this server drew for each name: lets the module checker know the app really rendered it. */
const rendered = new Map<string, { widgets: number; at: number; error?: string }>()
export const lastRender = (name: string) => rendered.get(name)
export const clearRender = () => rendered.clear()

const num = (v: unknown, d: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : d))

/** "-PT3H", "PT0H", "-P1D" or an ISO timestamp, relative to `now`. */
function when(v: unknown, now: number, fallback: number): number {
  if (typeof v !== 'string' || !v) return fallback
  const m = v.match(/^(-?)P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/)
  if (m) {
    const ms = (Number(m[2] ?? 0) * 86400 + Number(m[3] ?? 0) * 3600 + Number(m[4] ?? 0) * 60 + Number(m[5] ?? 0)) * 1000
    return m[1] ? now - ms : now + ms
  }
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : fallback
}

type Row = unknown[]
const isOpts = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

/** Turn the CloudWatch widget `metrics` rows into GetMetricData queries (metric rows and math expressions). */
function toQueries(rows: Row[], props: Record<string, unknown>) {
  const defStat = typeof props.stat === 'string' ? props.stat : 'Average'
  const defPeriod = num(props.period, 300, 1, 86400 * 30)
  const labels = new Map<string, string>()
  const queries: MetricDataQuery[] = []
  let prev: Row = []
  rows.slice(0, MAX_SERIES).forEach((raw, i) => {
    if (!Array.isArray(raw)) return
    const row: Row = raw.map((x, k) => (x === '.' ? prev[k] : x))
    prev = row
    const opts = isOpts(row[row.length - 1]) ? (row[row.length - 1] as Record<string, unknown>) : {}
    const strs = row.filter((x): x is string => typeof x === 'string')
    const given = typeof opts.id === 'string' && /^[a-z][A-Za-z0-9_]*$/.test(opts.id) ? opts.id : undefined
    const id = given ?? `m${i}`
    if (opts.visible === false && !given) return
    if (typeof opts.expression === 'string') {
      queries.push({ Id: id, Expression: opts.expression, Label: typeof opts.label === 'string' ? opts.label : undefined, ReturnData: opts.visible !== false })
      labels.set(id, typeof opts.label === 'string' ? opts.label : opts.expression)
      return
    }
    if (strs.length < 2) return
    const [namespace, metricName, ...dimParts] = strs
    const dims = []
    for (let k = 0; k + 1 < dimParts.length; k += 2) dims.push({ Name: dimParts[k], Value: dimParts[k + 1] })
    const stat = typeof opts.stat === 'string' ? opts.stat : defStat
    const label = typeof opts.label === 'string' ? opts.label : metricName
    queries.push({ Id: id, Label: label, ReturnData: opts.visible !== false, MetricStat: { Metric: { Namespace: namespace, MetricName: metricName, Dimensions: dims }, Period: num(opts.period, defPeriod, 1, 86400 * 30), Stat: stat } })
    labels.set(id, label)
  })
  return { queries, labels, defStat, defPeriod }
}

async function metricWidget(c: Clients, box: { x: number; y: number; w: number; h: number }, props: Record<string, unknown>, now: number): Promise<DashWidget> {
  const title = typeof props.title === 'string' ? props.title : 'Metrics'
  const view = props.view === 'singleValue' ? 'singleValue' : props.view === 'bar' ? 'bar' : 'timeSeries'
  const rows = Array.isArray(props.metrics) ? (props.metrics as Row[]) : []
  const { queries, labels, defStat, defPeriod } = toQueries(rows, props)
  const horizontal = isOpts(props.annotations) && Array.isArray(props.annotations.horizontal) ? (props.annotations.horizontal as unknown[]) : []
  const threshold = horizontal.filter(isOpts).filter((a) => Number.isFinite(Number(a.value))).map((a) => ({ value: Number(a.value), label: typeof a.label === 'string' ? a.label : undefined }))
  const base = { ...box, kind: 'metric' as const, title, view: view as 'timeSeries', stat: defStat, period: defPeriod, threshold: threshold.length ? threshold : undefined }
  if (!queries.length) return { ...base, series: [], error: 'No metrics in this widget.' }
  const end = when(props.end, now, now)
  const start = Math.min(when(props.start, now, now - 3 * 3600_000), end - 60_000)
  try {
    const r = await c.cw.send(new GetMetricDataCommand({ MetricDataQueries: queries, StartTime: new Date(start), EndTime: new Date(end), ScanBy: 'TimestampAscending' }))
    const series = (r.MetricDataResults ?? []).filter((m) => m.Id && (queries.find((q) => q.Id === m.Id)?.ReturnData ?? true)).map((m) => ({
      label: m.Label ?? labels.get(m.Id!) ?? m.Id!,
      points: (m.Timestamps ?? []).map((t, i) => ({ t: t.getTime(), v: m.Values?.[i] ?? 0 })),
    }))
    return { ...base, series }
  } catch (e) {
    return { ...base, series: [], error: e instanceof Error ? e.message.slice(0, 200) : 'Could not read metric data.' }
  }
}

async function alarmWidget(c: Clients, box: { x: number; y: number; w: number; h: number }, props: Record<string, unknown>): Promise<DashWidget> {
  const names = (Array.isArray(props.alarms) ? props.alarms : []).filter((a): a is string => typeof a === 'string').slice(0, 20).map((a) => a.split(':alarm:')[1] ?? a)
  const found = names.length ? (await c.cw.send(new DescribeAlarmsCommand({ AlarmNames: names })).catch(() => undefined))?.MetricAlarms ?? [] : []
  const alarms = names.map((n) => {
    const a = found.find((x) => x.AlarmName === n)
    return a
      ? { name: n, state: a.StateValue ?? 'INSUFFICIENT_DATA', detail: `${a.Statistic ?? a.ExtendedStatistic ?? ''} ${a.MetricName ?? ''} ${SYMBOL[a.ComparisonOperator ?? ''] ?? ''} ${a.Threshold ?? ''}`.replace(/\s+/g, ' ').trim() }
      : { name: n, state: 'NOT_FOUND', detail: 'No alarm with this name' }
  })
  return { ...box, kind: 'alarm', title: typeof props.title === 'string' ? props.title : 'Alarms', alarms }
}

/** Resolve a stored dashboard into drawable widgets. Never throws. */
export async function dashboardView(c: Clients, name: string): Promise<DashboardView> {
  const at = Date.now()
  const out = (v: Omit<DashboardView, 'name' | 'at'>): DashboardView => ({ name, at, ...v })
  if (!NAME.test(name)) return out({ exists: false, widgets: [], error: 'Dashboard names use letters, digits, dash and underscore.' })
  let body: string | undefined
  try { body = (await c.cw.send(new GetDashboardCommand({ DashboardName: name }))).DashboardBody } catch (e) {
    const n = (e as { name?: string })?.name ?? ''
    return out({ exists: false, widgets: [], error: /NotFound/i.test(n) ? undefined : e instanceof Error ? e.message.slice(0, 200) : 'Could not read the dashboard.' })
  }
  let doc: { widgets?: unknown }
  try { doc = JSON.parse(body ?? '{}') } catch { return out({ exists: true, widgets: [], error: 'The stored DashboardBody is not valid JSON.' }) }
  const list = Array.isArray(doc.widgets) ? doc.widgets.filter(isOpts).slice(0, MAX_WIDGETS) : []
  const widgets = await Promise.all(list.map(async (w): Promise<DashWidget> => {
    const box = { x: num(w.x, 0, 0, 23), y: num(w.y, 0, 0, 500), w: num(w.width, 6, 1, 24), h: num(w.height, 6, 1, 20) }
    const props = isOpts(w.properties) ? w.properties : {}
    if (w.type === 'text') return { ...box, kind: 'text', markdown: typeof props.markdown === 'string' ? props.markdown.slice(0, 2000) : '' }
    if (w.type === 'metric') return metricWidget(c, box, props, at)
    if (w.type === 'alarm') return alarmWidget(c, box, props)
    return { ...box, kind: 'unsupported', type: typeof w.type === 'string' ? w.type.slice(0, 40) : 'unknown' }
  }))
  const view = out({ exists: true, widgets, from: at - 3 * 3600_000, to: at })
  rendered.set(name, { widgets: widgets.length, at })
  return view
}

/** HTTP handler for GET /api/dashboard/:name (mounted by server/index.ts). */
export async function handleDashboard(clients: () => Clients, rawName: string): Promise<Response> {
  let name = rawName
  try { name = decodeURIComponent(rawName) } catch { /* keep raw */ }
  let view: DashboardView
  try { view = await dashboardView(clients(), name) } catch (e) {
    view = { name, at: Date.now(), exists: false, widgets: [], error: e instanceof Error ? e.message : 'emulator not ready' }
  }
  return new Response(JSON.stringify(view), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
}
