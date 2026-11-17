import { useEffect, useRef, useState } from 'react'
import { Download, Upload, UserRound } from 'lucide-react'
import { api } from '@/lib/api'
import { refreshProgress } from '@/lib/progress'
import { readLocal } from '@/lib/store'

type Mode = 'merge' | 'replace'

/** Header menu: export learning progress as JSON, import it back (merge or replace). Learning progress only, never settings of the tutor. */
export function ProgressMenu({ onTheme }: { onTheme: (t: 'dark' | 'light') => void }) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('merge')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const file = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    addEventListener('mousedown', down); addEventListener('keydown', key)
    return () => { removeEventListener('mousedown', down); removeEventListener('keydown', key) }
  }, [open])

  async function doExport() {
    setBusy(true); setMsg(null)
    try {
      const data = await api.exportProgress()
      const theme = readLocal<string>('theme', 'dark')
      const out = { ...data, settings: { theme: theme === 'light' ? 'light' : 'dark' } }
      const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `cloud-dojo-progress-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
      setMsg({ ok: true, text: 'Exported. The file holds learning progress only.' })
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }) } finally { setBusy(false) }
  }

  async function doImport(f: File | undefined) {
    if (!f) return
    setBusy(true); setMsg(null)
    try {
      if (f.size > 2_000_000) throw new Error('That file is too large to be a progress export.')
      let data: unknown
      try { data = JSON.parse(await f.text()) } catch { throw new Error('That file is not valid JSON.') }
      const r = await api.importProgress(data, mode)
      if (r.settings.theme) onTheme(r.settings.theme)
      await refreshProgress()
      setMsg({ ok: true, text: `${mode === 'merge' ? 'Merged' : 'Replaced with'} the file: ${r.modules} modules, ${r.attempts} exam attempts.${r.skipped ? ` ${r.skipped} unknown entries skipped.` : ''}` })
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }) } finally { setBusy(false); if (file.current) file.current.value = '' }
  }

  return (
    <div className="pmenu" ref={root}>
      <button className="iconbtn" aria-haspopup="dialog" aria-expanded={open} aria-label="Progress: export or import" title="Progress: export or import" onClick={() => setOpen((o) => !o)}><UserRound size={16} /></button>
      {open && (
        <div className="pmenu-pop" role="dialog" aria-label="Progress">
          <h2>Your progress</h2>
          <p>Saved on this machine. Export it to back it up or move it to another one.</p>
          <button className="btn" disabled={busy} onClick={() => void doExport()}><Download size={14} />Export progress (JSON)</button>
          <fieldset>
            <legend>Import</legend>
            <label><input type="radio" name="imode" checked={mode === 'merge'} onChange={() => setMode('merge')} /><span><b>Merge</b> keep whichever is further along, per module</span></label>
            <label><input type="radio" name="imode" checked={mode === 'replace'} onChange={() => setMode('replace')} /><span><b>Replace</b> discard current progress and use the file</span></label>
          </fieldset>
          <button className="btn" disabled={busy} onClick={() => file.current?.click()}><Upload size={14} />Import from file…</button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => void doImport(e.target.files?.[0])} aria-label="Progress file" />
          <p className="pmsg" role="status" data-ok={msg?.ok ? 'yes' : msg ? 'no' : undefined}>{msg?.text}</p>
        </div>
      )}
    </div>
  )
}
