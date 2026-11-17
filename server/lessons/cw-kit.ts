import { GetMetricStatisticsCommand, type Datapoint, type Dimension } from '@aws-sdk/client-cloudwatch'
import type { Ctx } from '../lesson-kit'

/** Topic and queue every CloudWatch alarm module wires to (account and region are fixed by the emulator). */
export const ALARM_TOPIC_ARN = 'arn:aws:sns:us-east-1:000000000000:alarms'

const nowS = () => Math.floor(Date.now() / 1000)

/** Time window the learner passes with --cli-input-json (the runner has no shell, so no $(date ...)). */
export const windowJson = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ StartTime: nowS() - 1800, EndTime: nowS() + 6 * 3600, Period: 60, ...extra }, null, 2) + '\n'

/** All datapoints of one metric over a generous window, read through the SDK. Never throws. */
export async function datapoints(ctx: Ctx, namespace: string, name: string, opts: { dims?: Dimension[]; stats?: ('Sum' | 'SampleCount' | 'Average' | 'Minimum' | 'Maximum')[] } = {}): Promise<Datapoint[]> {
  try {
    const r = await ctx.c.cw.send(new GetMetricStatisticsCommand({
      Namespace: namespace, MetricName: name, Dimensions: opts.dims,
      StartTime: new Date(Date.now() - 3 * 3600_000), EndTime: new Date(Date.now() + 3600_000), Period: 60,
      Statistics: opts.stats ?? ['Sum', 'SampleCount', 'Average', 'Minimum', 'Maximum'],
    }))
    return r.Datapoints ?? []
  } catch { return [] }
}

export const sumOf = (d: Datapoint[], k: 'Sum' | 'SampleCount' = 'Sum') => d.reduce((s, p) => s + (p[k] ?? 0), 0)

/** Poll until `fn` is true or the time runs out (alarms evaluate on their own schedule). */
export async function until(fn: () => Promise<boolean>, ms: number, every = 1000): Promise<boolean> {
  const end = Date.now() + ms
  for (;;) {
    try { if (await fn()) return true } catch { /* keep polling */ }
    if (Date.now() >= end) return false
    await Bun.sleep(every)
  }
}

/** Pull a single `--flag value` argument out of a command line. */
export const flagOf = (cmd: string, flag: string) => cmd.match(new RegExp(`${flag}[ =](?:'([^']*)'|"([^"]*)"|(\\S+))`))?.slice(1).find((x) => x !== undefined)
