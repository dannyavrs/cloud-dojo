import { CircleCheck, CircleSlash, ShieldAlert } from 'lucide-react'
import type { Row } from '@/lib/simulation'

const LABEL: Record<string, { word: string; cls: string; Icon: typeof CircleCheck }> = {
  allowed: { word: 'Allowed', cls: 'ok', Icon: CircleCheck },
  explicitDeny: { word: 'Explicit deny', cls: 'bad', Icon: ShieldAlert },
  implicitDeny: { word: 'Implicit deny', cls: 'warn', Icon: CircleSlash },
}

/** The decision, one row per action: the thing the raw JSON makes you hunt for. */
export function SimulationTable({ rows }: { rows: Row[] }) {
  return (
    <div className="sim" role="table" aria-label="Policy simulator result">
      <div className="simhead" role="row"><span role="columnheader">Action</span><span role="columnheader">Resource</span><span role="columnheader">Decision</span></div>
      {rows.map((r, i) => {
        const d = LABEL[r.decision] ?? { word: r.decision || 'Unknown', cls: 'warn', Icon: CircleSlash }
        return (
          <div className="simrow" role="row" key={i}>
            <span className="mono" role="cell">{r.action}</span>
            <span className="mono dim" role="cell" title={r.resource}>{r.resource}</span>
            <span role="cell" className="simdec">
              <span className={`sd ${d.cls}`}><d.Icon size={13} aria-hidden="true" />{d.word}</span>
              {r.boundary === false && <span className="simnote">blocked by the permissions boundary</span>}
              {r.context.length > 0 && <span className="simnote">needs context: {r.context.join(', ')}</span>}
              {r.decision === 'allowed' && r.matched > 0 && <span className="simnote">{r.matched} matching statement{r.matched > 1 ? 's' : ''}</span>}
            </span>
          </div>
        )
      })}
    </div>
  )
}
