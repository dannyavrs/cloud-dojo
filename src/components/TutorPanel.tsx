import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Bot, KeyRound, PanelRightClose, PanelRightOpen, Settings, Square, Trash2 } from 'lucide-react'
import type { CheckResult, LessonContent, ResourceMap } from '@shared/types'
import { streamTutor, type TutorMsg } from '@/lib/api'
import { OPEN_SETTINGS } from '@/lib/llm'
import { useLocal } from '@/lib/store'
import { CommandBlock } from './CommandBlock'
import { Inline } from './Inline'

const openSettings = () => window.dispatchEvent(new Event(OPEN_SETTINGS))
const PROMPTS = ['Explain this step', 'Why did my last command fail?', 'Give me a hint', 'How does this differ on real AWS?']

function Rich({ text, onSend }: { text: string; onSend: (c: string) => void }) {
  const parts = text.split(/```(?:bash|sh|shell)?\n?([\s\S]*?)(?:```|$)/g)
  return <>{parts.map((p, i) => i % 2 === 1 ? (p.trim() ? <CommandBlock key={i} command={p.trim()} onSend={onSend} /> : null) : p.trim() ? p.trim().split(/\n{2,}/).map((para, j) => <p key={`${i}-${j}`}><Inline text={para} /></p>) : null)}</>
}

interface Props { lesson: LessonContent; enabled: boolean; model: string; checks: CheckResult[]; map: ResourceMap | null; commandCount: number; onSend: (c: string) => void; open: boolean; onToggle: () => void }

export function TutorPanel({ lesson, enabled, model, checks, map, commandCount, onSend, open, onToggle }: Props) {
  const [msgs, setMsgs] = useLocal<TutorMsg[]>(`tutor:${lesson.id}`, [])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => { ref.current?.scrollTo({ top: ref.current.scrollHeight }) }, [msgs, open])
  useEffect(() => () => abort.current?.abort(), [lesson.id])

  async function ask(q: string) {
    const question = q.trim()
    if (!question || busy || !enabled) return
    const history: TutorMsg[] = [...msgs.filter((m) => !m.error), { role: 'user', content: question }]
    setMsgs([...history, { role: 'assistant', content: '' }])
    setText('')
    setBusy(true)
    abort.current = new AbortController()
    let acc = ''
    try {
      await streamTutor(lesson.id, history, (e) => {
        if (e.type === 'text') { acc += e.delta; setMsgs([...history, { role: 'assistant', content: acc }]) }
        else if (e.type === 'usage') setMsgs([...history, { role: 'assistant', content: acc, usage: { input: e.input_tokens, output: e.output_tokens } }])
        else setMsgs([...history, { role: 'assistant', content: e.message, error: true }])
      }, abort.current.signal)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setMsgs([...history, { role: 'assistant', content: 'The assistant request failed. Try again.', error: true }])
    } finally { setBusy(false) }
  }

  if (!open) {
    return (
      <aside className="rail closed" aria-label="Assistant (collapsed)">
        <button className="iconbtn" onClick={onToggle} aria-expanded="false" aria-label="Open the assistant"><PanelRightOpen size={18} /></button>
        <Bot size={16} className="railbot" aria-hidden="true" />
        <span className="vlabel">Assistant</span>
      </aside>
    )
  }
  const passed = checks.filter((c) => c.pass === true).length
  const ctx = [`Lesson ${lesson.n}: ${lesson.title.split(':')[0]}`, `Checks ${passed}/${checks.length}`, `Last ${Math.min(commandCount, 10)} commands`, `${map?.nodes.length ?? 0} ${map?.nodes.length === 1 ? 'resource' : 'resources'}`]
  return (
    <aside className="rail" aria-label="Assistant">
      <header>
        <span className="botmark" aria-hidden="true"><Bot size={16} /></span>
        <div className="rtitle"><h2>Tutor</h2><small>{enabled ? model : 'Not connected'}</small></div>
        <span className="grow" />
        {busy && <span className="streaming" role="status"><i /><i /><i />Responding</span>}
        <button className="iconbtn" onClick={openSettings} aria-label="Tutor settings" title="Tutor settings"><Settings size={15} /></button>
        {msgs.length > 0 && <button className="iconbtn" onClick={() => setMsgs([])} aria-label="Clear conversation" title="Clear conversation"><Trash2 size={15} /></button>}
        <button className="iconbtn" onClick={onToggle} aria-expanded="true" aria-label="Collapse the assistant" title="Collapse"><PanelRightClose size={16} /></button>
      </header>
      <div className="ctxbar" aria-label="What the tutor can see">
        <span className="ctxlabel">Context</span>
        {ctx.map((c) => <span key={c} className="chip">{c}</span>)}
      </div>
      <div className="convo" ref={ref} aria-live="polite">
        {!enabled && msgs.length === 0 && (
          <div className="container pad nokey">
            <h3><KeyRound size={15} />Tutor is not connected</h3>
            <p>Bring your own key. Pick a provider (Anthropic, OpenAI, Gemini, OpenRouter, or a local model such as Ollama) in settings. The key stays in this browser and is sent only to the local Dojo server.</p>
            <button className="btn primary sm" onClick={openSettings}><Settings size={13} />Open settings</button>
            <p>Self-hosting? Set <code>LLM_PROVIDER</code>, <code>LLM_API_KEY</code> and <code>LLM_MODEL</code> in <code>.env.local</code> and restart. Everything else in the lesson works without a key.</p>
          </div>
        )}
        {enabled && msgs.length === 0 && <p className="emptyconv">Ask anything about lesson {lesson.n}. The tutor sees the lesson, your checks, your last ten commands and the resource map. It suggests commands; you decide whether to run them.</p>}
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role} ${m.error ? 'err' : ''}`}>
            {m.role === 'user' ? <div className="body">{m.content}</div> : (
              <div className="body">{!m.error ? (m.content ? <Rich text={m.content} onSend={onSend} /> : <span className="think">Thinking…</span>) : m.content}</div>
            )}
            {m.usage && <div className="usage">{m.usage.input.toLocaleString()} in · {m.usage.output.toLocaleString()} out tokens</div>}
          </div>
        ))}
      </div>
      <div className="suggest" aria-label="Suggested prompts">
        {PROMPTS.map((c) => <button key={c} className="btn sm" disabled={!enabled || busy} onClick={() => void ask(c)}>{c}</button>)}
      </div>
      <form className="ask" onSubmit={(e) => { e.preventDefault(); void ask(text) }}>
        <textarea value={text} disabled={!enabled} onChange={(e) => setText(e.target.value)} placeholder={enabled ? 'Ask about this lesson…' : 'Add a key in settings to ask questions'} aria-label="Ask the tutor" rows={2}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(text) } }} />
        <div className="askbar">
          <small>{enabled ? 'Enter to send · Shift+Enter for a new line' : 'AI-generated answers can be wrong; check the checker'}</small>
          <button className="btn primary sm iconsend" disabled={!enabled || busy || !text.trim()} aria-label="Send">{busy ? <Square size={12} fill="currentColor" /> : <ArrowUp size={15} strokeWidth={2.4} />}</button>
        </div>
      </form>
    </aside>
  )
}
