import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, CircleHelp, CircleSlash, LayoutDashboard } from 'lucide-react'
import type { DashboardView, DashSeries, DashWidget } from '@shared/dashboard-view'
import './mini-dashboard.css'

type Metric = Extract<DashWidget, { kind: 'metric' }>
type AlarmW = Extract<DashWidget, { kind: 'alarm' }>

const SERIES_STYLE = [
  { color: 'var(--md-accent, var(--accent))', dash: undefined },
  { color: 'var(--link)', dash: undefined },
  { color: 'var(--text2)', dash: '5 3' },
  { color: 'var(--warn)', dash: '1.5 3' },
]
const styleOf = (i: number) => SERIES_STYLE[i % SERIES_STYLE.length]

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
const fmt = (v: number) => {
  const a = Math.abs(v)
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}k`
  return Number.isInteger(v) ? String(v) : v.toFixed(a < 10 ? 2 : 1)
}

/** 1, 2, 5 steps: a few round y-axis ticks covering [0, max]. */
function niceTicks(max: number, n = 3) {
  if (!(max > 0)) return { top: 1, ticks: [0, 1] }
  const raw = max / n
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw
  const ticks: number[] = []
  for (let v = 0; v <= max + step * 0.999; v += step) ticks.push(Number(v.toFixed(6)))
  return { top: ticks[ticks.length - 1], ticks }
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

function Chart({ w }: { w: Metric }) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const uid = useId()
  const height = Math.max(110, w.h * 40 - 10 - 84)
  const all = w.series.flatMap((s) => s.points)
  const empty = all.length === 0
  const t0 = empty ? 0 : Math.min(...all.map((p) => p.t))
  const t1 = empty ? 1 : Math.max(...all.map((p) => p.t), t0 + 10 * 60_000)
  const yMax = Math.max(0, ...all.map((p) => p.v), ...(w.threshold ?? []).map((a) => a.value))
  const { top, ticks } = niceTicks(yMax)
  const L = 34, R = 10, T = 8, B = 20
  const iw = Math.max(40, width - L - R), ih = height - T - B
  const x = (t: number) => L + ((t - t0) / (t1 - t0)) * iw
  const y = (v: number) => T + ih - (v / top) * ih
  const stamps = [...new Set(all.map((p) => p.t))].sort((a, b) => a - b)
  const xt = [0, 1, 2, 3].map((i) => t0 + ((t1 - t0) * i) / 3)

  function move(e: React.PointerEvent<SVGSVGElement>) {
    if (!stamps.length) return
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left
    const t = t0 + ((px - L) / iw) * (t1 - t0)
    setHover(stamps.reduce((best, s) => (Math.abs(s - t) < Math.abs(best - t) ? s : best), stamps[0]))
  }
  const hoverVals = hover === null ? [] : w.series.map((s, i) => ({ s, i, p: s.points.find((p) => p.t === hover) })).filter((h) => h.p)
  const summary = `${w.title}: ${w.series.map((s) => `${s.label}, ${s.points.length} datapoints, latest ${s.points.length ? fmt(s.points[s.points.length - 1].v) : 'none'}`).join('; ')}`

  return (
    <div className="md-chart" ref={ref}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={summary} onPointerMove={move} onPointerLeave={() => setHover(null)}>
          {ticks.map((v) => (
            <g key={v}>
              <line className="md-grid" x1={L} x2={L + iw} y1={y(v)} y2={y(v)} />
              <text className="md-tick" x={L - 6} y={y(v) + 3.5} textAnchor="end">{fmt(v)}</text>
            </g>
          ))}
          {!empty && xt.map((t, i) => <text key={i} className="md-tick" x={x(t)} y={height - 5} textAnchor={i === 0 ? 'start' : i === 3 ? 'end' : 'middle'}>{clock(t)}</text>)}
          {(w.threshold ?? []).map((a, i) => (
            <g key={i}>
              <line className="md-threshold" x1={L} x2={L + iw} y1={y(a.value)} y2={y(a.value)} />
              <text className="md-tick md-threshold-label" x={L + iw - 2} y={y(a.value) - 4} textAnchor="end">{a.label ? `${a.label} ${fmt(a.value)}` : fmt(a.value)}</text>
            </g>
          ))}
          {w.series.map((s, i) => {
            const st = styleOf(i)
            if (!s.points.length) return null
            const d = s.points.map((p, k) => `${k ? 'L' : 'M'}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ')
            return (
              <g key={s.label + i}>
                <path d={d} fill="none" stroke={st.color} strokeWidth="1.75" strokeDasharray={st.dash} strokeLinejoin="round" strokeLinecap="round" />
                {s.points.length === 1 && <circle cx={x(s.points[0].t)} cy={y(s.points[0].v)} r="3" fill={st.color} />}
              </g>
            )
          })}
          {hover !== null && (
            <g pointerEvents="none">
              <line className="md-cursor" x1={x(hover)} x2={x(hover)} y1={T} y2={T + ih} />
              {hoverVals.map(({ s, i, p }) => <circle key={s.label + i} cx={x(hover)} cy={y(p!.v)} r="3.5" fill={styleOf(i).color} stroke="var(--raised)" strokeWidth="1.5" />)}
            </g>
          )}
          <title id={uid}>{summary}</title>
        </svg>
      )}
      {empty && <p className="md-nodata">No datapoints in this time range</p>}
      {hover !== null && hoverVals.length > 0 && (
        <div className="md-tip" style={{ left: Math.min(Math.max(x(hover) + 10, 0), Math.max(0, width - 150)) }}>
          <b>{clock(hover)}</b>
          {hoverVals.map(({ s, i, p }) => <span key={s.label + i}><i style={{ background: styleOf(i).color }} />{s.label}<em>{fmt(p!.v)}</em></span>)}
        </div>
      )}
      {w.series.length > 0 && (
        <ul className="md-legend">
          {w.series.map((s, i) => {
            const st = styleOf(i)
            const last = s.points[s.points.length - 1]
            return (
              <li key={s.label + i}>
                <svg width="18" height="8" aria-hidden="true"><line x1="1" x2="17" y1="4" y2="4" stroke={st.color} strokeWidth="2" strokeDasharray={st.dash} strokeLinecap="round" /></svg>
                <span>{s.label}</span>
                <em>{last ? fmt(last.v) : 'no data'}</em>
              </li>
            )
          })}
        </ul>
      )}
      <table className="sr">
        <caption>{w.title}</caption>
        <thead><tr><th>Time</th>{w.series.map((s) => <th key={s.label}>{s.label}</th>)}</tr></thead>
        <tbody>{stamps.map((t) => <tr key={t}><td>{clock(t)}</td>{w.series.map((s) => <td key={s.label}>{s.points.find((p) => p.t === t)?.v ?? ''}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

/** One number per series: the widget's statistic taken over the whole range (the console shows the latest datapoint). */
function aggregate(s: DashSeries, stat: string): number | null {
  const v = s.points.map((p) => p.v)
  if (!v.length) return null
  switch (stat) {
    case 'Maximum': return Math.max(...v)
    case 'Minimum': return Math.min(...v)
    case 'Average': return v.reduce((a, b) => a + b, 0) / v.length
    default: return v.reduce((a, b) => a + b, 0)
  }
}

function SingleValue({ w }: { w: Metric }) {
  const rows = w.series.map((s) => ({ label: s.label, v: aggregate(s, w.stat) }))
  if (!rows.length) return <p className="md-nodata">No metrics</p>
  return (
    <div className="md-single">
      {rows.map((r) => (
        <div key={r.label} className="md-num">
          <strong>{r.v === null ? '–' : fmt(r.v)}</strong>
          <span>{r.label}</span>
        </div>
      ))}
      <p>{w.stat} over the time range</p>
    </div>
  )
}

const ALARM: Record<string, { word: string; cls: string; Icon: typeof CheckCircle2 }> = {
  OK: { word: 'OK', cls: 'ok', Icon: CheckCircle2 },
  ALARM: { word: 'In alarm', cls: 'bad', Icon: AlertTriangle },
  INSUFFICIENT_DATA: { word: 'Insufficient data', cls: 'warn', Icon: CircleHelp },
  NOT_FOUND: { word: 'Not found', cls: 'dim', Icon: CircleSlash },
}

function Alarms({ w }: { w: AlarmW }) {
  if (!w.alarms.length) return <p className="md-nodata">No alarms in this widget</p>
  return (
    <ul className="md-alarms">
      {w.alarms.map((a) => {
        const s = ALARM[a.state] ?? ALARM.INSUFFICIENT_DATA
        return (
          <li key={a.name} className={s.cls}>
            <s.Icon size={15} aria-hidden="true" />
            <div><b>{a.name}</b><span className="md-state">{s.word}</span>{a.detail && <code>{a.detail}</code>}</div>
          </li>
        )
      })}
    </ul>
  )
}

/** The small Markdown subset a text widget needs: headings, bold, code, bullets. Everything is rendered as React nodes, never as HTML. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((p, i) =>
    p.startsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : p.startsWith('`') ? <code key={i}>{p.slice(1, -1)}</code> : p)
}
function Markdown({ text }: { text: string }) {
  const out: ReactNode[] = []
  let bullets: string[] = []
  const flush = () => { if (bullets.length) { out.push(<ul key={`u${out.length}`}>{bullets.map((b, i) => <li key={i}>{inline(b)}</li>)}</ul>); bullets = [] } }
  text.split('\n').forEach((line, i) => {
    const h = line.match(/^(#{1,3})\s+(.*)$/)
    const li = line.match(/^\s*[-*]\s+(.*)$/)
    if (li) { bullets.push(li[1]); return }
    flush()
    if (h) out.push(h[1].length === 1 ? <h3 key={i}>{inline(h[2])}</h3> : <h4 key={i}>{inline(h[2])}</h4>)
    else if (line.trim()) out.push(<p key={i}>{inline(line)}</p>)
  })
  flush()
  return <div className="md-text">{out}</div>
}

function Widget({ w }: { w: DashWidget }) {
  const box = { '--x': w.x, '--y': w.y, '--w': w.w, '--h': w.h } as React.CSSProperties
  if (w.kind === 'text') return <section className="md-w md-w-text" style={box}><Markdown text={w.markdown} /></section>
  if (w.kind === 'unsupported') return <section className="md-w" style={box}><h3 className="md-title">Widget type {w.type}</h3><p className="md-nodata">The mini dashboard draws text, metric and alarm widgets only.</p></section>
  return (
    <section className="md-w" style={box} aria-label={w.title}>
      <h3 className="md-title">{w.title}</h3>
      {w.kind === 'metric' ? (w.error ? <p className="md-error" role="alert">{w.error}</p> : w.view === 'singleValue' ? <SingleValue w={w} /> : <Chart w={w} />) : <Alarms w={w} />}
    </section>
  )
}

/**
 * Draws a CloudWatch dashboard stored in the emulator. The server (GET /api/dashboard/:name) reads the DashboardBody and resolves
 * every widget against live metric and alarm data; this component only lays it out on the 24-column grid.
 */
export function MiniDashboard({ name, active = true }: { name: string; active?: boolean }) {
  const [view, setView] = useState<DashboardView | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!active) return
    let alive = true
    const load = async () => {
      if (document.visibilityState === 'hidden') return
      try {
        const r = await fetch(`/api/dashboard/${encodeURIComponent(name)}`)
        const v = (await r.json()) as DashboardView
        if (alive) { setView(v); setFailed(false) }
      } catch { if (alive) setFailed(true) }
    }
    void load()
    const t = setInterval(() => void load(), 4000)
    return () => { alive = false; clearInterval(t) }
  }, [name, active])

  const widgets = useMemo(() => [...(view?.widgets ?? [])].sort((a, b) => a.y - b.y || a.x - b.x), [view])
  const count = widgets.length

  return (
    <section className="container md" aria-label={`Dashboard ${name}`}>
      <header>
        <h2><LayoutDashboard size={16} />Dashboard <span className="mono">{name}</span></h2>
        <span className="count">{view?.exists ? `${count} ${count === 1 ? 'widget' : 'widgets'}` : ''}</span>
      </header>
      {!view && <p className="md-empty">{failed ? 'Waiting for the emulator…' : 'Reading the dashboard…'}</p>}
      {view && !view.exists && (
        <div className="md-empty">
          <p><b>{view.error ? 'Could not read the dashboard' : `No dashboard named ${name} yet`}</b></p>
          <p>{view.error ?? <>Store one with <code>aws cloudwatch put-dashboard</code> and it is drawn here from the stored JSON.</>}</p>
        </div>
      )}
      {view?.exists && view.error && <p className="md-error pad" role="alert">{view.error}</p>}
      {view?.exists && !view.error && count === 0 && <p className="md-empty">The dashboard is stored but has no widgets.</p>}
      {count > 0 && <div className="md-grid-wrap"><div className="md-board">{widgets.map((w, i) => <Widget key={i} w={w} />)}</div></div>}
      {view?.exists && <p className="md-foot">Drawn by this app from the stored DashboardBody and live emulator data. The emulator has no console. Metric lines fit their time axis to the returned datapoints.</p>}
    </section>
  )
}
