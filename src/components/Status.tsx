import { Check, CircleDashed, Loader, X } from 'lucide-react'

export type StatusKind = 'pass' | 'fail' | 'todo' | 'progress'
const LABEL: Record<StatusKind, string> = { pass: 'Passed', fail: 'Failed', todo: 'Not checked', progress: 'In progress' }

/** Console-style status indicator: glyph plus word, never color alone. */
export function Status({ kind, label }: { kind: StatusKind; label?: string }) {
  const Icon = kind === 'pass' ? Check : kind === 'fail' ? X : kind === 'progress' ? Loader : CircleDashed
  return <span className={`status ${kind}`}><Icon size={14} strokeWidth={kind === 'todo' ? 2 : 2.6} />{label ?? LABEL[kind]}</span>
}
