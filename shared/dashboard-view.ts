/** What GET /api/dashboard/:name returns: a stored CloudWatch dashboard body, resolved against live metric and alarm data. */
export interface DashPoint { t: number; v: number }
export interface DashSeries { label: string; points: DashPoint[]; stat?: string; unit?: string }

interface Box { x: number; y: number; w: number; h: number }

export type DashWidget = Box & (
  | { kind: 'text'; markdown: string }
  | { kind: 'metric'; title: string; view: 'timeSeries' | 'singleValue' | 'bar'; stat: string; period: number; series: DashSeries[]; threshold?: { value: number; label?: string }[]; error?: string }
  | { kind: 'alarm'; title: string; alarms: { name: string; state: string; detail?: string }[] }
  | { kind: 'unsupported'; type: string }
)

export interface DashboardView {
  name: string
  exists: boolean
  /** why the dashboard could not be drawn (not found, unparsable, emulator not ready) */
  error?: string
  widgets: DashWidget[]
  /** time range the series cover (epoch ms) */
  from?: number
  to?: number
  at: number
}
