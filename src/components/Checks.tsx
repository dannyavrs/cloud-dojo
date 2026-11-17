import { useState } from 'react'
import { Check, ChevronRight, CircleDashed, ListChecks, X } from 'lucide-react'
import type { CheckResult } from '@shared/types'
import { Inline } from './Inline'
import { Status } from './Status'

type Sub = NonNullable<CheckResult['sub']>[number]

const SUB_WORD = { true: 'Passed', false: 'Failing', null: 'Not checked' } as const

function SubItem({ s }: { s: Sub }) {
  const kind = s.pass === true ? 'p' : s.pass === false ? 'f' : 't'
  const Icon = s.pass === true ? Check : s.pass === false ? X : CircleDashed
  return (
    <li className={`sub ${kind}`}>
      <Icon size={13} strokeWidth={s.pass === null ? 2 : 2.6} aria-hidden="true" />
      <span className="sub-label"><Inline text={s.label} /></span>
      <span className="sub-word">{SUB_WORD[String(s.pass) as 'true' | 'false' | 'null']}</span>
    </li>
  )
}

/** One Well-Architected pillar: name, pass count, segmented meter and an expandable list of sub-checks. */
function PillarRow({ c }: { c: CheckResult }) {
  const subs = c.sub ?? []
  const passed = subs.filter((s) => s.pass === true).length
  const [open, setOpen] = useState<boolean | null>(null)
  const expanded = open ?? c.pass !== true
  const kind = c.pass === true ? 'p' : c.pass === false ? 'f' : 't'
  const listId = `pillar-${c.id}`
  return (
    <li className={`pillar ${kind}`}>
      <button type="button" className="pillar-head" aria-expanded={expanded} aria-controls={listId} onClick={() => setOpen(!expanded)}>
        <Status kind={c.pass === true ? 'pass' : c.pass === false ? 'fail' : 'todo'} />
        <span className="ctext">
          <span className="pillar-name">{c.pillar ?? c.label}</span>
          {c.pass !== true && c.hint && <small><Inline text={c.hint} /></small>}
        </span>
        <span className="pillar-count" aria-label={`${passed} of ${subs.length} sub-checks passed`}>
          <span className="n"><b>{passed}</b>/{subs.length}</span>
          <span className="segs" aria-hidden="true">{subs.map((s, i) => <i key={i} className={s.pass === true ? 'p' : s.pass === false ? 'f' : 't'} />)}</span>
        </span>
        <ChevronRight size={15} className="chev" aria-hidden="true" />
      </button>
      {expanded && <ul id={listId} className="subs" aria-label={`${c.pillar ?? c.label} sub-checks`}>{subs.map((s, i) => <SubItem key={i} s={s} />)}</ul>}
    </li>
  )
}

export function Checks({ checks, probeNote, onCheck, checking, done }: { checks: CheckResult[]; probeNote?: string; onCheck: () => void; checking: boolean; done: boolean }) {
  const passed = checks.filter((c) => c.pass === true).length
  const failed = checks.filter((c) => c.pass === false).length
  const review = checks.some((c) => c.sub)
  return (
    <section className={`container checks${review ? ' review' : ''}`} aria-label={review ? 'Well-Architected review' : 'Checker'}>
      <header>
        <h2><ListChecks size={16} />{review ? 'Well-Architected review' : 'Checker'}</h2>
        {done ? <span className="count ok"><Check size={14} strokeWidth={2.6} />Lesson completed</span> : <span className="count">{passed} of {checks.length} {review ? 'pillars' : 'passed'}{review ? ' passing' : ''}{failed ? ` · ${failed} failing` : ''}</span>}
        <span className="grow" />
        <button className="btn" onClick={onCheck} disabled={checking}>{checking ? 'Checking…' : 'Run checks'}</button>
      </header>
      <div className="meter wide" role="progressbar" aria-valuemin={0} aria-valuemax={checks.length} aria-valuenow={passed} aria-label="Checks passed"><i style={{ width: `${checks.length ? (passed / checks.length) * 100 : 0}%` }} /></div>
      <ul>
        {checks.map((c) => c.sub ? <PillarRow key={c.id} c={c} /> : (
          <li key={c.id} className={c.pass === true ? 'p' : c.pass === false ? 'f' : 't'}>
            <Status kind={c.pass === true ? 'pass' : c.pass === false ? 'fail' : 'todo'} />
            <span className="ctext">
              <Inline text={c.label} />
              {c.pass !== true && <small>{c.pass === null ? 'Press Run checks to evaluate this one (it sends test traffic).' : c.hint}</small>}
            </span>
          </li>
        ))}
      </ul>
      {probeNote && <p className="note">{probeNote}</p>}
    </section>
  )
}
