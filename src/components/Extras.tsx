import { useEffect, useRef, useState } from 'react'
import { Pencil, RotateCcw, Save } from 'lucide-react'
import { api } from '@/lib/api'

/** Starter-file editor. The server only ever writes inside this module's working folder. */
export function FileEditor({ lessonId, name, editable, onClose, onSaved }: { lessonId: string; name: string; editable: boolean; onClose: () => void; onSaved: (files: string[]) => void }) {
  const [saved, setSaved] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const ta = useRef<HTMLTextAreaElement>(null)
  const gutter = useRef<HTMLPreElement>(null)
  const canEdit = editable && !name.endsWith('.zip')
  const dirty = saved !== null && text !== saved

  useEffect(() => {
    let alive = true
    setSaved(null); setNote(null)
    api.file(lessonId, name).then((f) => { if (alive) { setSaved(f.text); setText(f.text) } }).catch(() => { if (alive) { setSaved('(could not read file)'); setText('(could not read file)') } })
    return () => { alive = false }
  }, [lessonId, name])

  async function save() {
    if (!canEdit || !dirty || busy) return
    setBusy(true)
    try {
      const r = await api.saveFile(lessonId, name, text)
      setSaved(text); onSaved(r.files)
      setNote({ kind: 'ok', text: r.rebuilt.length ? `Saved. ${r.rebuilt.join(', ')} rebuilt from your source.` : 'Saved.' })
    } catch (e) { setNote({ kind: 'err', text: e instanceof Error ? e.message : 'Could not save.' }) } finally { setBusy(false) }
  }
  const lines = Math.max(1, text.split('\n').length)

  return (
    <div className="drawer editor" role="region" aria-label={`${canEdit ? 'Editor' : 'File'} ${name}`}>
      <div className="fl">
        <b className="mono">{name}</b>
        {canEdit ? <span className={`edstate${dirty ? ' dirty' : ''}`}><Pencil size={11} />{dirty ? 'Unsaved changes' : 'Editable'}</span> : <span className="edstate">Read only</span>}
        <span className="grow" />
        {note && <span className={`ednote ${note.kind}`} role="status">{note.text}</span>}
        {canEdit && <button className="btn sm" disabled={!dirty || busy} onClick={() => setText(saved ?? '')}><RotateCcw size={12} />Revert</button>}
        {canEdit && <button className="btn sm primary" disabled={!dirty || busy} onClick={() => void save()}><Save size={12} />{busy ? 'Saving…' : 'Save'}</button>}
        <button className="btn sm" onClick={onClose}>Close</button>
      </div>
      <div className="edbody">
        <pre className="gutter" aria-hidden="true" ref={gutter}>{Array.from({ length: lines }, (_, i) => i + 1).join('\n')}</pre>
        <textarea ref={ta} value={saved === null ? 'loading…' : text} readOnly={!canEdit || saved === null} spellCheck={false} wrap="off" aria-label={`Contents of ${name}`}
          onScroll={(e) => { if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop }}
          onChange={(e) => { setText(e.target.value); setNote(null) }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); void save() }
            if (e.key === 'Tab' && canEdit) { e.preventDefault(); const t = e.currentTarget; const s = t.selectionStart; setText(text.slice(0, s) + '  ' + text.slice(t.selectionEnd)); requestAnimationFrame(() => t.setSelectionRange(s + 2, s + 2)) }
          }} />
      </div>
    </div>
  )
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

/** HTTP probe: any method, headers and body, but only ever to the emulator's own origin (the server enforces it). */
export function HttpProbe({ lessonId, onDone }: { lessonId: string; onDone: () => void }) {
  const [url, setUrl] = useState('')
  const [method, setMethod] = useState<(typeof METHODS)[number]>('GET')
  const [headers, setHeaders] = useState('')
  const [body, setBody] = useState('{"text":"hello from Cloud Dojo"}')
  const [res, setRes] = useState<{ status: number; headers?: Record<string, string>; body: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const canBody = method !== 'GET' && method !== 'HEAD'
  async function go() {
    setBusy(true)
    const hdrs: Record<string, string> = {}
    for (const line of headers.split('\n')) { const i = line.indexOf(':'); if (i > 0) hdrs[line.slice(0, i).trim()] = line.slice(i + 1).trim() }
    try { setRes(await api.http(lessonId, { url: url.trim(), method, headers: hdrs, body: canBody ? body : undefined })) }
    catch (e) { setRes({ status: 0, body: e instanceof Error ? e.message : String(e) }) }
    finally { setBusy(false); onDone() }
  }
  return (
    <section className="container probe" aria-label="HTTP probe">
      <header><h2>HTTP probe</h2><span className="count">sends a request to the emulator only</span></header>
      <div className="probe-row">
        <label className="sr" htmlFor="probe-method">Method</label>
        <select id="probe-method" value={method} onChange={(e) => setMethod(e.target.value as (typeof METHODS)[number])}>{METHODS.map((m) => <option key={m}>{m}</option>)}</select>
        <label className="sr" htmlFor="probe-url">HTTP probe URL</label>
        <input id="probe-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste ApiEndpoint, e.g. https://127.0.0.1:9297/_aws/execute-api/abc123/" spellCheck={false} />
        <button className="btn sm primary" disabled={busy || !url} onClick={() => void go()}>{busy ? 'Sending…' : 'Send'}</button>
      </div>
      <div className="probe-row">
        <label className="sr" htmlFor="probe-headers">Headers, one Name: value per line</label>
        <textarea id="probe-headers" rows={2} value={headers} onChange={(e) => setHeaders(e.target.value)} placeholder={'Headers, one per line\nAuthorization: Bearer <token>'} spellCheck={false} />
        <label className="sr" htmlFor="probe-body">Request body</label>
        <textarea id="probe-body" rows={2} value={body} disabled={!canBody} onChange={(e) => setBody(e.target.value)} placeholder={canBody ? 'Request body' : `${method} has no body`} spellCheck={false} />
      </div>
      {res && (
        <div className="probe-res" aria-live="polite">
          <b className={res.status >= 200 && res.status < 400 ? 'okc' : 'badc'}>{method} → {res.status || 'no response'}</b>
          {res.headers && Object.keys(res.headers).length > 0 && <div className="rh">{Object.entries(res.headers).slice(0, 8).map(([k, v]) => `${k}: ${v}`).join('\n')}</div>}
          {res.body && <div>{res.body}</div>}
        </div>
      )}
    </section>
  )
}
