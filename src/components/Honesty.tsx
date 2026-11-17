import { BookOpen, FlaskConical, Radio } from 'lucide-react'
import type { Honesty } from '@shared/types'
import { Inline } from './Inline'

const META: Record<Honesty, { label: string; Icon: typeof Radio; tip: string }> = {
  live: { label: 'Live', Icon: Radio, tip: 'Live: the emulator enforces this, and the checker probes the real behaviour.' },
  simulated: { label: 'Simulated', Icon: FlaskConical, tip: 'Simulated: taught through an AWS evaluation API (such as simulate-principal-policy) or static checks of your JSON. Real calls do not behave this way on the emulator.' },
  concept: { label: 'Concept', Icon: BookOpen, tip: 'Concept: explained with a diagram and a quiz. The emulator cannot show it honestly, so there is no hands-on claim.' },
}

/** Glyph plus word, never colour alone. */
export function HonestyBadge({ honesty, note, compact = false }: { honesty: Honesty; note?: string; compact?: boolean }) {
  const { label, Icon, tip } = META[honesty]
  return <span className={`hb ${honesty}${compact ? ' compact' : ''}`} title={note ? `${tip} ${note}` : tip}><Icon size={compact ? 12 : 13} strokeWidth={2.2} aria-hidden="true" />{label}</span>
}

export function HonestyLegend() {
  return (
    <ul className="hlegend" aria-label="Honesty badges">
      {(Object.keys(META) as Honesty[]).map((h) => <li key={h}><HonestyBadge honesty={h} /><span>{(t => t[0].toUpperCase() + t.slice(1))(META[h].tip.split(': ')[1])}</span></li>)}
    </ul>
  )
}

const STATE: Record<'simulated' | 'concept', { title: string; real: string; not: string }> = {
  simulated: { title: 'Simulated module', real: 'The checker asks an AWS evaluation API (or validates your JSON against AWS\u2019s own rules) and the answers are real.', not: 'The emulator does not apply this rule to live calls, so a real request can still succeed. Never take that as proof it is allowed on AWS.' },
  concept: { title: 'Concept module', real: 'You edit a starter file; a static check reads it and the quiz grades your understanding.', not: 'The emulator cannot show this behaviour, so nothing here claims a hands-on result.' },
}

/** What is real, what is not, said before the learner starts. Glyph + words, never colour alone. */
export function HonestyState({ honesty, note, flipped }: { honesty: Honesty; note?: string; flipped?: boolean }) {
  if (honesty === 'live') return null
  const s = STATE[honesty]
  const { Icon } = META[honesty]
  return (
    <section className={`hstate ${honesty}`} aria-label={s.title}>
      <div className="hs-head"><Icon size={15} strokeWidth={2.2} aria-hidden="true" /><b>{s.title}</b></div>
      <dl>
        <div><dt>What is real</dt><dd><Inline text={s.real} /></dd></div>
        <div><dt>What is not</dt><dd><Inline text={note ?? s.not} /></dd></div>
      </dl>
      {flipped && <p className="hs-flip">The capability probe found this enforced now, so the badge shows Live.</p>}
    </section>
  )
}
