import { useEffect, useRef, useState } from 'react'
import { FlaskConical, RotateCw } from 'lucide-react'
import type { ServerInfo } from '@shared/types'

/**
 * Two honest warnings above the page:
 *  - this server writes to a custom (test/throwaway) data folder, so what you see is not your real progress;
 *  - the server restarted while this tab was open (new instance id): the sandbox was reset, recorded progress is safe.
 * `server` is null while the server is unreachable; the last seen instance is kept so a restart is still noticed.
 */
export function Notices({ server }: { server: ServerInfo | null | undefined }) {
  const first = useRef<string | null>(null)
  const [restarted, setRestarted] = useState<ServerInfo | null>(null)
  useEffect(() => {
    if (!server) return
    if (first.current === null) first.current = server.instanceId
    else if (first.current !== server.instanceId) { first.current = server.instanceId; setRestarted(server) }
  }, [server])
  return (
    <div className="notices">
      {server?.customDataDir && (
        <div className="notice warn" role="status">
          <FlaskConical size={15} aria-hidden="true" />
          <span><b>Test data folder.</b> This server saves to <code>{server.dataDir}</code>, not your real progress. Anything you do here is thrown away with that folder. Your own session runs on port 4747.</span>
        </div>
      )}
      {restarted && (
        <div className="notice info" role="status">
          <RotateCw size={15} aria-hidden="true" />
          <span><b>The server restarted.</b> The sandbox was reset, so live checks may read empty. Your recorded progress is safe; use <b>Reset module</b> to rebuild the sandbox.</span>
          <button className="btn sm" onClick={() => setRestarted(null)}>Dismiss</button>
        </div>
      )}
    </div>
  )
}
