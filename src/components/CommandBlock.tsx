import { useState } from 'react'
import { Check } from 'lucide-react'
import { Copy, Send } from './Icons'

export function CommandBlock({ command, onSend }: { command: string; onSend?: (c: string) => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="cmd">
      <pre><span className="ps" aria-hidden="true">$</span>{command}</pre>
      <div className="acts">
        <button className="btn sm" onClick={() => { void navigator.clipboard?.writeText(command); setCopied(true); setTimeout(() => setCopied(false), 1200) }}>{copied ? <Check size={13} /> : <Copy />}{copied ? 'Copied' : 'Copy'}</button>
        {onSend && <button className="btn sm" onClick={() => onSend(command)}><Send />Send to terminal</button>}
      </div>
    </div>
  )
}
