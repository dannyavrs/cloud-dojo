import { useCallback, useEffect, useRef, useState } from 'react'
import { lessonById } from '@shared/lessons'
import type { CheckResult, EmulatorStatus, ResourceMap } from '@shared/types'
import { api } from '@/lib/api'
import { useCapabilities } from '@/lib/capabilities'
import { refreshProgress } from '@/lib/progress'
import { readLocal, useLocal } from '@/lib/store'
import { Checks } from '@/components/Checks'
import { FileEditor, HttpProbe } from '@/components/Extras'
import { Reset } from '@/components/Icons'
import { Status } from '@/components/Status'
import { Manual } from '@/components/Manual'
import { ResourceMapView } from '@/components/ResourceMap'
import { MiniDashboard } from '@/components/MiniDashboard'
import { Terminal, type TerminalHandle } from '@/components/Terminal'
import { TutorPanel } from '@/components/TutorPanel'

export function LessonPage({ id, status }: { id: string; status: EmulatorStatus | null }) {
  const lesson = lessonById(id)!
  const ready = status?.phase === 'ready'
  const [started, setStarted] = useState(false)
  const [startedMs, setStartedMs] = useState<number | null>(null)
  const [startErr, setStartErr] = useState<string | null>(null)
  const [files, setFiles] = useState<string[]>([])
  const [checks, setChecks] = useState<CheckResult[]>(lesson.checks.map((c) => ({ id: c.id, label: c.label, pass: null })))
  const [probeCache, setProbeCache] = useState<Record<string, CheckResult>>({})
  const [map, setMap] = useState<ResourceMap | null>(null)
  const [checking, setChecking] = useState(false)
  const [viewFile, setViewFile] = useState<string | null>(null)
  const [pane, setPane] = useState<'manual' | 'bench' | 'tutor'>('manual')
  const [railOpen, setRailOpen] = useLocal('rail-open', true)
  const caps = useCapabilities()
  const [showMe, setShowMe] = useState<{ step: number; total: number; title: string; explain: string } | null>(null)
  const [showBusy, setShowBusy] = useState(false)
  const allBuilt = showMe !== null && showMe.step === showMe.total
  const term = useRef<TerminalHandle>(null)
  const [ran, setRan] = useState(() => readLocal<unknown[]>(`term:${id}`, []).length)

  const doStart = useCallback(async (fresh: boolean) => {
    setStarted(false); setStartErr(null); setShowMe(null); setProbeCache({})
    if (fresh) { setViewFile(null); term.current?.clear() }
    try { const r = await api.start(id, fresh); setFiles(r.files); setStartedMs(r.ms); setStarted(true) } catch (e) { setStartErr(String(e instanceof Error ? e.message : e)) }
  }, [id])

  // start (or resume) when the emulator is ready
  useEffect(() => { if (ready) void doStart(false) }, [ready, doStart])

  const merged = checks.map((c) => (c.pass === null && probeCache[c.id] !== undefined ? { ...c, pass: probeCache[c.id].pass, ...(probeCache[c.id].sub ? { sub: probeCache[c.id].sub } : {}) } : c))
  const allGreen = merged.every((c) => c.pass === true)
  // time on module: a small heartbeat while the tab is visible
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') void api.tick(id, 15) }, 15000)
    return () => clearInterval(t)
  }, [id])

  const refresh = useCallback(async () => {
    try { setChecks(await api.checks(id, false)); void refreshProgress() } catch { /* emulator busy */ }
    try { setMap(await api.map()) } catch { /* ignore */ }
    try { setFiles((await api.files(id)).files) } catch { /* ignore */ }
  }, [id])
  useEffect(() => {
    if (!started) return
    void refresh()
    const t = setInterval(() => void refresh(), 2000)
    return () => clearInterval(t)
  }, [started, refresh])

  async function runChecks() {
    setChecking(true)
    try {
      const r = await api.checks(id, true)
      setChecks(r)
      void refreshProgress()
      setProbeCache(Object.fromEntries(r.filter((c) => c.pass !== null).map((c) => [c.id, c])))
    } finally { setChecking(false) }
  }

  const send = (c: string) => { term.current?.prefill(c); setPane('bench') }
  const busy = !started && !startErr

  return (
    <div className="lessonwrap">
      <div className="panes-tabs" role="tablist">
        {(['manual', 'bench', 'tutor'] as const).map((p) => <button key={p} role="tab" aria-selected={pane === p} onClick={() => setPane(p)}>{p === 'manual' ? 'Lesson' : p === 'bench' ? 'Workbench' : 'Tutor'}</button>)}
      </div>
      <div className={`lesson ${railOpen ? '' : 'rail-closed'}`} data-pane={pane}>
        <Manual lesson={lesson} report={caps.report} onSend={send} extra={
          lesson.id === 'capstone' ? (
            <div className="container pad">
              <p><b>Show me</b>: the server builds the solution one step at a time with the SDK. {showMe ? `Step ${showMe.step} of ${showMe.total} done.` : 'Nothing built yet.'}</p>
              {showMe && <p><b>{showMe.title}.</b> {showMe.explain}</p>}
              <button className="btn" disabled={!started || showBusy || allBuilt} onClick={async () => { setShowBusy(true); try { const r = await api.showMe(id); if (r.title) setShowMe({ step: r.step!, total: r.total, title: r.title, explain: r.explain! }); await refresh() } finally { setShowBusy(false) } }}>{showBusy ? 'Building…' : allBuilt ? 'All steps built' : 'Show me the next step'}</button>
            </div>
          ) : null
        } />
        <div className="bench">
          <div className="bench-top">
            <div className="envbar">
              <Status kind={startErr ? 'fail' : busy ? 'progress' : 'pass'} label={startErr ? 'Could not start' : busy ? 'Starting a fresh cloud…' : `Environment ready${startedMs != null ? ` in ${(startedMs / 1000).toFixed(1)} s` : ''}`} />
              <span className="envnote">Seeds what this module needs</span>
              <span className="grow" />
              <button className="btn sm" disabled={!ready || busy} onClick={() => void doStart(true)}><Reset />Reset module</button>
            </div>
            <Checks checks={merged} probeNote={lesson.probeNote} onCheck={() => void runChecks()} checking={checking} done={allGreen} />
            <ResourceMapView map={map} />
            {lesson.id === 'cw-dashboards' && <MiniDashboard name="checkout" active={started} />}
            {lesson.httpProbe && <HttpProbe lessonId={id} onDone={() => void refresh()} />}
          </div>
          <div className="bench-term">
            {viewFile && <FileEditor lessonId={id} name={viewFile} editable={Boolean(lesson.editable?.includes(viewFile))} onClose={() => setViewFile(null)} onSaved={setFiles} />}
            <Terminal ref={term} lessonId={id} ready={ready && started} onRan={() => { setRan((n) => n + 1); void refresh() }} files={files} editable={lesson.editable ?? []} onViewFile={setViewFile} />
          </div>
        </div>
        <TutorPanel lesson={lesson} enabled={Boolean(status?.tutor.enabled)} model={status?.tutor.model ?? ''} checks={merged} map={map} commandCount={ran} onSend={send} open={railOpen || pane === 'tutor'} onToggle={() => setRailOpen(!railOpen)} />
      </div>
      {(busy || startErr || (!ready && status)) && (
        <div className="pour container pad" role="status">
          {startErr ? (<><h2>Module did not start</h2><p>{startErr}</p><button className="btn primary" onClick={() => void doStart(true)}>Try again</button></>)
            : (<><h2>{status?.probing ? 'Probing what the emulator enforces' : status?.phase === 'docker-missing' ? 'Docker is not running' : status?.phase === 'error' ? 'Emulator problem' : status?.phase === 'building-image' ? 'Building the emulator image' : 'Starting a fresh cloud'}</h2><p>{status?.probing ? 'One-time capability probe for this emulator image: it records which permission and service behaviours are really enforced, so the Live, Simulated and Concept badges stay honest. It takes about half a minute and never runs again for this image.' : status?.message ?? 'Connecting to the server…'}</p>
              {(status?.phase === 'docker-missing' || status?.phase === 'error') && <button className="btn primary" onClick={() => void api.retry()}>Retry</button>}</>)}
        </div>
      )}
    </div>
  )
}
