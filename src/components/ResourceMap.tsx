import { useEffect, useRef } from 'react'
import { Network } from 'lucide-react'
import type { MapNode, ResourceMap as RM } from '@shared/types'
import { SERVICE_BY_KIND } from '@/lib/services'

const COL: Record<MapNode['kind'], number> = { bucket: 0, api: 0, user: 0, topic: 1, queue: 2, function: 3, role: 3, table: 4, statemachine: 3, bus: 1, alarm: 4, key: 4, secret: 4, pool: 0 }
const ORDER: MapNode['kind'][] = ['api', 'bucket', 'user', 'topic', 'queue', 'function', 'role', 'table', 'statemachine', 'bus', 'alarm', 'key', 'secret', 'pool']
const W = 156, H = 52, GX = 44, GY = 14, PAD = 16, TOP = 40

export function ResourceMapView({ map }: { map: RM | null }) {
  const seen = useRef(new Set<string>())
  const fresh = new Set<string>()
  if (map) for (const n of map.nodes) if (!seen.current.has(n.id)) fresh.add(n.id)
  useEffect(() => { if (map) for (const n of map.nodes) seen.current.add(n.id) }, [map])
  const count = map?.nodes.length ?? 0
  const head = (
    <header>
      <h2><Network size={16} />Resource map</h2>
      <span className="count">{count} {count === 1 ? 'resource' : 'resources'}{map && map.edges.length ? ` · ${map.edges.length} connections` : ''}</span>
    </header>
  )
  if (!map || count === 0) {
    return (
      <section className="container mapwrap" aria-label="Resource map">
        {head}
        <div className="mapempty"><p>{map?.error ? 'Waiting for the emulator…' : 'No resources yet.'}<br />Resources you create appear here, with the wiring between them.</p></div>
      </section>
    )
  }
  const sorted = [...map.nodes].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.label.localeCompare(b.label))
  // compact: only columns that hold something
  const usedCols = [...new Set(sorted.map((n) => COL[n.kind]))].sort()
  const colIdx = new Map(usedCols.map((c, i) => [c, i]))
  const rows: Record<number, MapNode[]> = {}
  for (const n of sorted) (rows[colIdx.get(COL[n.kind])!] ??= []).push(n)
  const pos = new Map<string, { x: number; y: number }>()
  let maxRows = 0
  for (const [c, list] of Object.entries(rows)) { list.forEach((n, i) => pos.set(n.id, { x: PAD + Number(c) * (W + GX), y: TOP + i * (H + GY) })); maxRows = Math.max(maxRows, list.length) }
  const width = Math.max(PAD * 2 + usedCols.length * W + (usedCols.length - 1) * GX, 400)
  const height = TOP + maxRows * (H + GY) - GY + PAD
  return (
    <section className="container mapwrap" aria-label="Resource map">
      {head}
      <div className="mapscroll">
        <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={`${count} resources, ${map.edges.length} connections`}>
          <defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1 9 5 1 9z" className="arrowhead" /></marker></defs>
          <rect className="boundary" x="1" y="1" width={width - 2} height={height - 2} rx="10" />
          <text className="blabel" x={PAD} y="24">AWS Emulator · account 000000000000 · us-east-1</text>
          {map.edges.map((e, i) => {
            const a = pos.get(e.from), b = pos.get(e.to)
            if (!a || !b) return null
            const sameCol = Math.abs(a.x - b.x) < 5
            const x1 = sameCol ? a.x + W / 2 : a.x < b.x ? a.x + W : a.x, y1 = sameCol ? (a.y < b.y ? a.y + H : a.y) : a.y + H / 2
            const x2 = sameCol ? b.x + W / 2 : a.x < b.x ? b.x : b.x + W, y2 = sameCol ? (a.y < b.y ? b.y : b.y + H) : b.y + H / 2
            const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
            const d = sameCol ? `M${x1} ${y1} C${x1 + 40} ${my} ${x2 + 40} ${my} ${x2} ${y2}` : `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`
            const label = e.label && !sameCol ? (e.label.length > 20 ? e.label.slice(0, 19) + '…' : e.label) : ''
            return (
              <g key={i}>
                <path className={`edge ${e.from.startsWith('role:') ? 'weak' : ''}`} d={d} markerEnd="url(#arrow)" />
                {label && <g transform={`translate(${mx} ${my})`}><rect className="elabel-bg" x={-label.length * 3.1 - 6} y="-9" width={label.length * 6.2 + 12} height="18" rx="9" /><text className="elabel" textAnchor="middle" y="3.5">{label}</text></g>}
              </g>
            )
          })}
          {sorted.map((n) => {
            const p = pos.get(n.id)!
            const svc = SERVICE_BY_KIND[n.kind]
            const Icon = svc.Icon
            const sub = [n.status, n.detail].filter(Boolean).join(' · ')
            return (
              <g key={n.id} className={`node ${fresh.has(n.id) ? 'new' : ''}`} transform={`translate(${p.x} ${p.y})`}>
                <title>{`${svc.name}: ${n.label}${n.detail ? ' · ' + n.detail : ''}${n.status ? ' · ' + n.status : ''}`}</title>
                <rect className="card" width={W} height={H} rx="8" />
                <rect x="8" y="8" width="36" height="36" rx="7" fill={svc.color} />
                <Icon x="17" y="17" size={18} strokeWidth={2} color="#fff" />
                <text className="t" x="54" y={sub ? 23 : 31}>{n.label.length > 14 ? n.label.slice(0, 13) + '…' : n.label}</text>
                <text className="d" x="54" y={sub ? 38 : 31}>{sub ? sub.slice(0, 19) : ''}</text>
              </g>
            )
          })}
        </svg>
      </div>
    </section>
  )
}
