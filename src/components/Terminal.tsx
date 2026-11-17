import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { RunRecord } from '@shared/types'
import { Pencil, SquareTerminal } from 'lucide-react'
import { api } from '@/lib/api'
import { useLocal } from '@/lib/store'
import { parseSimulation } from '@/lib/simulation'
import { SimulationTable } from './Simulation'

/** CLI progress meters redraw with \r; keep only the final state of each line. */
const settle = (t: string) => t.split('\n').map((l) => l.split('\r').filter(Boolean).pop() ?? '').join('\n')

export interface TerminalHandle { prefill(cmd: string): void; clear(): void; log: RunRecord[] }

export const Terminal = forwardRef<TerminalHandle, { lessonId: string; ready: boolean; onRan: () => void; files: string[]; editable?: string[]; onViewFile: (n: string) => void }>(function Terminal({ lessonId, ready, onRan, files, editable = [], onViewFile }, ref) {
  const [log, setLog] = useLocal<RunRecord[]>(`term:${lessonId}`, [])
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [hist, setHist] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const outRef = useRef<HTMLDivElement>(null)
  useImperativeHandle(ref, () => ({ prefill: (c) => { setValue(c); setHist(-1); inputRef.current?.focus() }, clear: () => setLog([]), log }), [log, setLog])
  useEffect(() => { outRef.current?.scrollTo({ top: outRef.current.scrollHeight }) }, [log, busy])

  async function run() {
    const command = value.trim()
    if (!command || busy || !ready) return
    setBusy(true)
    try {
      const r = await api.run(lessonId, command)
      setLog((l) => [...l, r].slice(-40))
    } catch (e) {
      setLog((l) => [...l, { command, exitCode: 1, stdout: '', stderr: String(e instanceof Error ? e.message : e), ms: 0, at: Date.now() }])
    } finally { setBusy(false); setValue(''); setHist(-1); onRan(); inputRef.current?.focus() }
  }
  const cmds = log.map((l) => l.command)
  const hasPlaceholder = /<[A-Z_]+>/.test(value)
  return (
    <section className="term" aria-label="Terminal">
      <header>
        <h2><SquareTerminal size={15} />Terminal</h2>
        <span className="chip mono">aws-cli · us-east-1</span>
        <span className="grow" />
        {files.length > 0 && <span className="folder">Files</span>}
        {files.slice(0, 8).map((f) => <button key={f} className="btn sm mono" onClick={() => onViewFile(f)} title={editable.includes(f) ? 'Open in the editor' : 'View file'}>{editable.includes(f) && <Pencil size={11} />}{f}</button>)}
      </header>
      <div className="termout" ref={outRef} tabIndex={0} aria-live="polite">
        {log.length === 0 && <p className="termempty">Type an <code>aws</code> command, or choose <b>Send to terminal</b> on a step. Each command runs the real AWS CLI against the emulator. There is no shell, so no pipes: one command at a time.</p>}
        {log.map((r, i) => (
          <div key={i} className="run">
            <div className="cmdline"><span className="ps">$</span>{r.command}</div>
            {r.stdout && <pre>{settle(r.stdout)}</pre>}
            {(() => { const sim = r.exitCode === 0 ? parseSimulation(r.command, r.stdout) : null; return sim ? <SimulationTable rows={sim} /> : null })()}
            {r.stderr && <pre className={r.rejected ? 'rej' : 'err'}>{settle(r.stderr)}</pre>}
            <div className={`meta ${r.exitCode === 0 && !r.rejected ? 'okx' : 'badx'}`}>{r.rejected ? 'refused by the runner' : `exit ${r.exitCode} · ${r.ms} ms`}</div>
          </div>
        ))}
        {busy && <div className="meta">running…</div>}
      </div>
      <div className="termin">
        <span className="ps" aria-hidden="true">$</span>
        <input ref={inputRef} value={value} disabled={!ready} spellCheck={false} autoComplete="off" aria-label="aws command" placeholder={ready ? 'aws sts get-caller-identity' : 'waiting for the emulator…'}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void run()
            else if (e.key === 'ArrowUp' && cmds.length) { const n = Math.min(hist + 1, cmds.length - 1); setHist(n); setValue(cmds[cmds.length - 1 - n]); e.preventDefault() }
            else if (e.key === 'ArrowDown') { const n = hist - 1; setHist(n); setValue(n < 0 ? '' : cmds[cmds.length - 1 - n]); e.preventDefault() }
          }} />
        {hasPlaceholder && <span className="hint">replace the &lt;PLACEHOLDER&gt; first</span>}
        <button className="btn primary sm" disabled={busy || !ready || !value.trim()} onClick={() => void run()}>Run</button>
      </div>
    </section>
  )
})
