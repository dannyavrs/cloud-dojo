import { useEffect, useId, useRef, useState } from 'react'
import { CheckCircle2, Eye, EyeOff, Loader2, ShieldCheck, TriangleAlert, X } from 'lucide-react'
import { PROVIDERS, providerInfo, type ProviderId, type TestResult } from '@shared/llm'
import type { EmulatorStatus } from '@shared/types'
import { api } from '@/lib/api'
import { forgetKey, readLlm, saveLlm, useLlm, type LlmSettings } from '@/lib/llm'

const CLASS_LABEL: Record<string, string> = { auth: 'Key rejected', rate_limit: 'Rate limited', model: 'Model not found', network: 'Endpoint unreachable', bad_request: 'Request rejected', config: 'Incomplete settings', unknown: 'Request failed' }

export function SettingsDialog({ open, onClose, tutor }: { open: boolean; onClose: () => void; tutor?: EmulatorStatus['tutor'] }) {
  const ref = useRef<HTMLDialogElement>(null)
  const saved = useLlm()
  const uid = useId()
  const [provider, setProvider] = useState<ProviderId>(saved.provider)
  const [model, setModel] = useState(saved.model)
  const [baseUrl, setBaseUrl] = useState(saved.baseUrl)
  const [keyDraft, setKeyDraft] = useState('')
  const [reveal, setReveal] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)
  const [note, setNote] = useState('')

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) {
      // load the saved values each time the dialog opens; the key itself is never loaded into a field
      const s = readLlm()
      setProvider(s.provider); setModel(s.model); setBaseUrl(s.baseUrl); setKeyDraft(''); setReveal(false); setResult(null); setNote('')
      d.showModal()
    } else if (!open && d.open) d.close()
  }, [open])

  const info = providerInfo(provider)
  const keySaved = Boolean(saved.key)
  const draft = (): LlmSettings => ({ provider, model, baseUrl: info.baseUrl === 'required' ? baseUrl : '', key: keyDraft.trim() || saved.key })
  const needsUrl = info.baseUrl === 'required'
  const missing = (!draft().key && !info.keyOptional) ? 'Add an API key to continue.' : needsUrl && !baseUrl.trim() ? 'Add the base URL of your endpoint.' : ''

  async function test() {
    setTesting(true); setResult(null); setNote('')
    try { setResult(await api.testLlm(draft())) } catch { setResult({ ok: false, errorClass: 'network', message: 'Could not reach the local Dojo server.' }) } finally { setTesting(false) }
  }
  function save() {
    saveLlm(draft())
    setKeyDraft('')
    setNote('Saved on this device.')
  }
  function forget() {
    forgetKey()
    setKeyDraft(''); setResult(null); setNote('Key removed from this browser.')
  }

  const sourceLine = tutor?.source === 'browser' ? `Using your saved settings (${tutor.model}).` : tutor?.source === 'env' ? `Using server environment variables (${tutor.model}). Saving a key here overrides them.` : 'Not connected yet.'

  return (
    <dialog ref={ref} className="dlg" aria-labelledby={`${uid}-t`} onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose() }}>
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); save() }} autoComplete="off">
        <header>
          <div><h2 id={`${uid}-t`}>Tutor settings</h2><p className="muted">{sourceLine}</p></div>
          <button type="button" className="iconbtn" onClick={onClose} aria-label="Close settings"><X size={16} /></button>
        </header>

        <fieldset className="providers">
          <legend>Provider</legend>
          <div role="radiogroup" aria-label="Provider">
            {PROVIDERS.map((p) => (
              <label key={p.id} className={provider === p.id ? 'on' : ''}>
                <input type="radio" name={`${uid}-p`} value={p.id} checked={provider === p.id} onChange={() => { setProvider(p.id); setResult(null); setNote('') }} />
                {p.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="field">
          <label htmlFor={`${uid}-m`}>Model</label>
          <input id={`${uid}-m`} className="mono" value={model} onChange={(e) => setModel(e.target.value)} placeholder={info.defaultModel} spellCheck={false} autoCapitalize="off" />
          <small>Any model id your provider accepts. Blank uses <code>{info.defaultModel}</code>.</small>
        </div>

        {needsUrl && (
          <div className="field">
            <label htmlFor={`${uid}-u`}>Base URL</label>
            <input id={`${uid}-u`} className="mono" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:11434/v1" spellCheck={false} inputMode="url" />
            <small>Any OpenAI-compatible server: Ollama, LM Studio, vLLM, a proxy. Only <code>/chat/completions</code> is called.</small>
          </div>
        )}
        {info.baseUrl === 'fixed' && <p className="muted fixedurl">Requests go to <code>{info.fixedBaseUrl}</code>.</p>}

        <div className="field">
          <label htmlFor={`${uid}-k`}>API key{info.keyOptional && <span className="optl"> optional</span>}</label>
          <div className="keyrow">
            <input id={`${uid}-k`} className="mono" type={reveal ? 'text' : 'password'} value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)}
              placeholder={keySaved ? 'A key is saved. Paste a new one to replace it.' : info.keyHint} autoComplete="new-password" spellCheck={false} data-1p-ignore data-lpignore="true" />
            <button type="button" className="iconbtn" onClick={() => setReveal((r) => !r)} aria-label={reveal ? 'Hide the key you are typing' : 'Show the key you are typing'} aria-pressed={reveal} disabled={!keyDraft}>{reveal ? <EyeOff size={15} /> : <Eye size={15} />}</button>
          </div>
          <small className="store"><ShieldCheck size={13} aria-hidden="true" />Stored on this device only (this browser&rsquo;s localStorage). Sent to the local server with each request, used once, never logged or saved.</small>
        </div>

        <div className="actions">
          <button type="button" className="btn" onClick={() => void test()} disabled={testing || Boolean(missing)}>{testing ? <><Loader2 size={14} className="spin" />Testing</> : 'Test connection'}</button>
          <button type="submit" className="btn primary" disabled={Boolean(missing)}>Save</button>
          <span className="grow" />
          <button type="button" className="btn sm danger" onClick={forget} disabled={!keySaved}>Forget key</button>
        </div>

        <div className="result" role="status" aria-live="polite">
          {missing && !result && !note && <span className="muted">{missing}</span>}
          {result?.ok && <span className="status pass"><CheckCircle2 size={14} />Connected in {result.ms.toLocaleString()} ms</span>}
          {result && !result.ok && <span className="status fail"><TriangleAlert size={14} />{CLASS_LABEL[result.errorClass] ?? 'Request failed'}<em>{result.message}</em></span>}
          {note && !result && <span className="muted">{note}</span>}
        </div>

        <p className="muted selfhost">Self-hosting? Set <code>LLM_PROVIDER</code>, <code>LLM_API_KEY</code>, <code>LLM_MODEL</code> (and <code>LLM_BASE_URL</code>) in <code>.env.local</code> instead. A key saved here takes precedence. See <code>docs/BYOK.md</code>.</p>
      </form>
    </dialog>
  )
}
