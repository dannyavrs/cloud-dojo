import { GraduationCap } from 'lucide-react'
import { DOMAIN_NAME } from '@shared/exam-mode'
import type { DomainReadiness } from '@shared/types'

/**
 * Per-domain exam readiness. Half from modules finished, half from exam answers, where each exam question counts once
 * as its latest result across track exams and exam mode (the server does the counting).
 */
export function Readiness({ rows, title = 'Exam readiness' }: { rows: DomainReadiness[]; title?: string }) {
  const groups = [['SAA', 'Solutions Architect Associate'], ['DVA', 'Developer Associate']] as const
  return (
    <section className="container readiness" aria-label={title}>
      <header><h2><GraduationCap size={16} />{title}</h2><span className="count">half modules finished, half exam answers (each question counted once, latest result)</span></header>
      <div className="rgrid">
        {groups.map(([code, name]) => (
          <div key={code}>
            <h3>{name}</h3>
            <ul>
              {rows.filter((r) => r.domain.startsWith(`${code}:`)).map((r) => (
                <li key={r.domain}>
                  <span className="dname">{DOMAIN_NAME[r.domain.split(':')[1]] ?? r.domain}</span>
                  <span className="meter" role="img" aria-label={`${r.percent} percent ready`}><i style={{ width: `${r.percent}%` }} /></span>
                  <span className="dnum" title={`${r.modulesDone} of ${r.modulesTotal} modules done${r.examTotal ? `, ${r.examCorrect} of ${r.examTotal} exam answers right` : ', no exam questions yet'}`}>{r.percent}%</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
