import { useState } from 'react'
import { Check, ChevronRight, CircleDashed, History, ListChecks, Undo2, UserCheck, X } from 'lucide-react'
import { passedCount, type DoneKind } from '@shared/history'
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
        <Status kind={c.pass === true || c.earlier ? 'pass' : c.pass === false ? 'fail' : 'todo'} label={c.earlier ? 'Passed earlier' : undefined} />
        <span className="ctext">
          <span className="pillar-name">{c.pillar ?? c.label}{c.earlier && <em className="earlier-tag">passed earlier</em>}</span>
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

interface ChecksProps {
  checks: CheckResult[]
  probeNote?: string
  onCheck: () => void
  checking: boolean
  /** How this module was finished, if it was: confirmed by its checks, or marked by the learner. */
  done: DoneKind
  onMark: () => void
  onUndo: () => void
  marking: boolean
}

export function Checks({ checks, probeNote, onCheck, checking, done, onMark, onUndo, marking }: ChecksProps) {
  const passed = passedCount(checks)
  const earlier = checks.filter((c) => c.earlier).length
  const failed = checks.filter((c) => c.pass === false).length
  const review = checks.some((c) => c.sub)
  return (
    <section className={`container checks${review ? ' review' : ''}`} aria-label={review ? 'Well-Architected review' : 'Checker'}>
      <header>
        <h2><ListChecks size={16} />{review ? 'Well-Architected review' : 'Checker'}</h2>
        {done === 'verified' && <span className="count ok"><Check size={14} strokeWidth={2.6} />Verified</span>}
        {done === 'manual' && <span className="count ok manual"><UserCheck size={14} strokeWidth={2.4} />Marked by you</span>}
        {!done && <span className="count">{passed} of {checks.length} {review ? 'pillars' : 'passed'}{review ? ' passing' : ''}{failed ? ` · ${failed} failing` : ''}</span>}
        <span className="grow" />
        {done ? <button className="btn sm" onClick={onUndo} disabled={marking} title="Clear the completed mark. Checks you passed stay recorded."><Undo2 size={13} />Undo</button>
          : <button className="btn sm" onClick={onMark} disabled={marking} title="Count this module as done without the checker confirming it">Mark as done</button>}
        <button className="btn sm" onClick={onCheck} disabled={checking}>{checking ? 'Checking…' : 'Run checks'}</button>
      </header>
      {earlier > 0 && (
        <p className="reset-note" role="status"><History size={14} aria-hidden="true" /><span>{earlier === 1 ? '1 check shows' : `${earlier} checks show`} <b>passed earlier</b>. The sandbox was reset (the emulator restarts when you switch lessons or the server restarts), so the live state is empty again. Your progress is safe. Use <b>Reset module</b> to rebuild the sandbox and run them live.</span></p>
      )}
      <div className="meter wide" role="progressbar" aria-valuemin={0} aria-valuemax={checks.length} aria-valuenow={passed} aria-label="Checks passed"><i style={{ width: `${checks.length ? (passed / checks.length) * 100 : 0}%` }} /></div>
      <ul>
        {checks.map((c) => c.sub ? <PillarRow key={c.id} c={c} /> : (
          <li key={c.id} className={c.pass === true ? 'p' : c.earlier ? 'p earlier' : c.pass === false ? 'f' : 't'}>
            <Status kind={c.pass === true || c.earlier ? 'pass' : c.pass === false ? 'fail' : 'todo'} label={c.earlier ? 'Passed earlier' : undefined} />
            <span className="ctext">
              <Inline text={c.label} />
              {c.pass !== true && !c.earlier && <small>{c.pass === null ? 'Press Run checks to evaluate this one (it sends test traffic).' : c.hint}</small>}
            </span>
          </li>
        ))}
      </ul>
      {probeNote && <p className="note">{probeNote}</p>}
    </section>
  )
}
