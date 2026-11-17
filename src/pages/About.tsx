import { useEffect, useRef } from 'react'
import { ARCH_DIAGRAM, COMPARE_DIAGRAM } from '@shared/explainer'
import { Check, X } from 'lucide-react'
import { LESSONS, modulesOf, shortTitle } from '@shared/lessons'
import { TRACKS } from '@shared/tracks'
import type { Honesty } from '@shared/types'
import { HonestyBadge, HonestyLegend } from '@/components/Honesty'
import { effectiveHonesty, useCapabilities } from '@/lib/capabilities'
import { useTheme } from '@/lib/theme'
import { DISCLAIMER, EMULATOR_CREDIT, GAPS_DOC_URL, TAGLINE } from '@shared/disclaimer'
import { GAPS } from '@shared/gaps'
import { Inline } from '@/components/Inline'

const MERMAID_VARS = {
  dark: { fontFamily: 'Geist Variable, system-ui, sans-serif', darkMode: true, background: '#111f31', primaryColor: '#16273b', primaryBorderColor: '#3b5578', primaryTextColor: '#e6edf6', lineColor: '#7a8ea6', secondaryColor: '#1a2f47', tertiaryColor: '#0f1b2a', clusterBkg: '#0f1b2a', clusterBorder: '#2c4263', edgeLabelBackground: '#111f31', textColor: '#e6edf6' },
  light: { fontFamily: 'Geist Variable, system-ui, sans-serif', primaryColor: '#eef3fa', primaryBorderColor: '#9db3cf', primaryTextColor: '#0f1b2a', lineColor: '#5f6f84', secondaryColor: '#fff3df', tertiaryColor: '#f7f9fc', clusterBkg: '#f7f9fc', clusterBorder: '#c3d0e2', edgeLabelBackground: '#ffffff' },
}

function Mermaid({ code, label }: { code: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const theme = useTheme()
  useEffect(() => {
    let dead = false
    void import('mermaid').then(async ({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, theme: 'base', securityLevel: 'strict', themeVariables: MERMAID_VARS[theme] })
      const { svg } = await mermaid.render('m' + Math.random().toString(36).slice(2), code)
      if (!dead && ref.current) ref.current.innerHTML = svg
    })
    return () => { dead = true }
  }, [code, theme])
  return <div className="diagram" ref={ref} role="img" aria-label={label}>Drawing diagram…</div>
}

/** How each probed behaviour is taught when it is, or is not, enforced. */
const CAP_INFO: Record<string, { teach: Honesty; on: string; off: string }> = {
  's3-bucket-policy': { teach: 'live', on: 'Bucket policy Deny beats an identity Allow (AccessDenied).', off: 'Taught as a concept.' },
  'sqs-queue-policy': { teach: 'live', on: 'Queue policies gate senders, including SNS and S3 delivery.', off: 'Taught as a concept.' },
  'lambda-resource-policy': { teach: 'live', on: 'add-permission grants invokes and function URLs.', off: 'Taught as a concept.' },
  'kms-key-policy': { teach: 'live', on: 'A key policy Deny blocks Encrypt for an identity that is allowed.', off: 'Taught as a concept.' },
  'dynamodb-resource-policy': { teach: 'concept', on: 'Resource policies grant access.', off: 'Accepted but not enforced. Mentioned as the exception; no hands-on step.' },
  'permission-boundary': { teach: 'simulated', on: 'Boundaries limit real calls.', off: 'simulate-principal-policy evaluates them, real calls ignore them. Taught as Simulated.' },
  'abac-principal-tag': { teach: 'concept', on: 'Tag conditions match.', off: 'Tag conditions and ${aws:username} are denied even when they should match. Taught as Concept.' },
  'iam-session-policy': { teach: 'concept', on: 'A session policy on AssumeRole narrows the session.', off: 'The --policy on assume-role does not narrow the session. Taught as Concept inside module 1.4.' },
  'iam-policy-variable': { teach: 'concept', on: '${aws:username} resolves in resource ARNs.', off: 'The variable never matches. Taught as Concept (module 1.7).' },
  'iam-source-ip': { teach: 'live', on: 'aws:SourceIp conditions evaluate against the caller address.', off: 'The key is missing from the request context, so IpAddress allows never match and NotIpAddress denies always fire. Shown with a warning in module 1.3.' },
  's3-lifecycle-validation': { teach: 'simulated', on: 'S3 rejects lifecycle rules AWS would reject.', off: 'Invalid rules (IA before 30 days) are accepted and rules never run. The app validates them itself (module 2.5, Simulated).' },
  's3-kms-disabled-key': { teach: 'live', on: 'A disabled key blocks SSE-KMS reads.', off: 'Reads still work with the key disabled. Documented in module 2.6, no hands-on claim.' },
  'lambda-async-destination': { teach: 'concept', on: 'Failed async invokes reach the OnFailure destination.', off: 'Config accepted, nothing delivered. Taught as Concept (module 4.7); SQS redrive covers the hands-on part.' },
  'ddb-gsi-eventual-only': { teach: 'live', on: 'Consistent reads on a GSI are refused, as on AWS (module 3.3).', off: 'Not rejected.' },
  'ddb-transaction-atomic': { teach: 'live', on: 'A failed condition cancels the whole transaction (module 3.5).', off: 'Not atomic.' },
  'sqs-fifo-dedup': { teach: 'live', on: 'Duplicate deduplication ids are dropped (module 5.4).', off: 'Not deduplicated.' },
  'sqs-dlq-redrive': { teach: 'live', on: 'Messages move to the DLQ after maxReceiveCount (module 5.3).', off: 'Not moved.' },
  'sns-filter-policy': { teach: 'live', on: 'Subscription filter policies drop non-matching messages (module 5.5).', off: 'Not filtered.' },
}

function Capabilities() {
  const caps = useCapabilities()
  return (
    <>
      <h2>What the emulator enforces, probed</h2>
      <p>The first time this app starts a given emulator image it runs a <b>capability probe</b>: a few seconds of real calls (a user the bucket policy denies, a queue the policy blocks, a transaction that must cancel) that record what is enforced. The result is stored per image, never re-run, and drives the badges: when a newer emulator starts enforcing something, a Simulated or Concept module flips to Live on its own.</p>
      <HonestyLegend />
      {caps.report ? (
        <div className="tablewrap container" tabIndex={0}>
          <table className="dt">
            <thead><tr><th>Behaviour</th><th>Probe result</th><th>What it means here</th></tr></thead>
            <tbody>
              {caps.report.capabilities.map((c) => {
                const info = CAP_INFO[c.key]
                return (
                  <tr key={c.key}>
                    <td>{c.label}</td>
                    <td><span className={`status ${c.enforced ? 'pass' : 'fail'}`}>{c.enforced ? <Check size={14} strokeWidth={2.6} /> : <X size={14} strokeWidth={2.6} />}{c.enforced ? 'Enforced' : 'Not enforced'}</span></td>
                    <td className="muted">{info ? (c.enforced ? info.on : info.off) : c.detail}{!c.enforced && info && <> <HonestyBadge honesty={info.teach} compact /></>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="count" role="status">{caps.pending ? 'The probe has not finished yet. It runs once, the first time the emulator starts, and takes about half a minute.' : ''}</p>}
      {caps.report && <p className="count">Probed on <code>{caps.report.image}</code>, {new Date(caps.report.at).toLocaleString()}.</p>}
    </>
  )
}

function EmulatorGaps() {
  return (
    <>
      <h2 id="emulator-gaps">Emulator gaps, by service</h2>
      <p>What works live, what is simulated or missing, and how each lesson handles it, derived from the probe above and each module&rsquo;s badge. Also in <a href={GAPS_DOC_URL} target="_blank" rel="noreferrer">docs/EMULATOR-GAPS.md</a>.</p>
      <div className="tablewrap container" tabIndex={0}>
        <table className="dt gaps">
          <thead><tr><th>Service</th><th>What works live</th><th>What&rsquo;s simulated or missing</th><th>How the lesson handles it</th></tr></thead>
          <tbody>
            {GAPS.map((r) => {
              const badges = (['live', 'simulated', 'concept'] as const).filter((b) => r.lessons.some((l) => l.badge === b))
              return (
                <tr key={r.service}>
                  <th scope="row">{r.service}</th>
                  <td><Inline text={r.live} /></td>
                  <td><Inline text={r.missing} /></td>
                  <td>{badges.map((b) => <HonestyBadge key={b} honesty={b} compact />)} <Inline text={r.handling} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

function TracksList() {
  const caps = useCapabilities()
  return (
    <>
      <h2>Tracks and modules</h2>
      <p>{LESSONS.length} modules in {TRACKS.length} tracks. Each module is labelled by how honestly the emulator can show it. Every track goes deep (IAM, S3, DynamoDB, Lambda, SQS + SNS, API Gateway, Step Functions, EventBridge, CloudWatch, KMS and secrets): intermediate to advanced, SAA/DVA exam-aligned, and each ends with a track exam. A timed mixed exam mode and a capstone scored as a mini Well-Architected review sit on top. Simulated and Concept modules say up front what is real and what is not.</p>
      <div className="tablewrap container" tabIndex={0}>
        <table className="dt">
          <thead><tr><th>Track</th><th>Module</th><th>Level</th><th>Honesty</th><th>Exam tags</th></tr></thead>
          <tbody>
            {TRACKS.flatMap((t) => modulesOf(t.id).map((m, i) => (
              <tr key={m.id}>
                <td>{i === 0 ? <b>{t.n === '★' ? '' : `${t.n} `}{t.title}</b> : ''}</td>
                <td><a className="rowlink" href={`#/lesson/${m.id}`}><span className="lnum">{m.n}</span>{shortTitle(m)}</a></td>
                <td className="muted">{m.level}</td>
                <td><HonestyBadge honesty={effectiveHonesty(m, caps.report)} note={m.honestyNote} compact /></td>
                <td className="muted mono">{m.examTags.join(' ')}</td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>
      <h2>Emulator gaps, tested on v1.0.341</h2>
      <ul>
        <li><b>Permission boundaries</b> and <b>session policies</b> are not applied to real calls (<code>simulate-principal-policy</code> does evaluate boundaries). <b>Tag conditions</b> (<code>aws:PrincipalTag</code>, <code>aws:ResourceTag</code>) and <code>{'${aws:username}'}</code> are not honoured. Taught as Simulated or Concept.</li>
        <li><b>DynamoDB resource policies</b> are accepted but not enforced. S3 bucket policies, Lambda resource policies, SQS queue policies and KMS key policies <b>are</b> enforced.</li>
        <li><b>S3 lifecycle</b> rules are stored but never run, and the emulator accepts rules AWS would reject, so module 2.5 validates them in the app. Disabling a KMS key does not block S3 reads, and replication is same-Region only.</li>
        <li><b>aws:SourceIp</b> conditions are unreliable (module 1.3 flags it).</li>
        <li><b>Lambda</b> async destinations and DLQs are configured but nothing is delivered. Every invoke gets a fresh sandbox, so warm starts and cold-start latency cannot be shown. Provisioned concurrency is cosmetic.</li>
        <li><b>Timing</b> is not AWS timing: DynamoDB TTL deletes in about 15 seconds (AWS: up to days), S3 lifecycle rules never run, a new GSI is ACTIVE almost immediately.</li>
        <li><b>Single account and Region</b>: no cross-account access, multi-Region DR, SCPs or VPC networking. CloudFormation is 16% and EC2 45% in the published scores.</li>
      </ul>
    </>
  )
}

export function About() {
  return (
    <div className="page doc">
      <div className="doc-in">
        <div className="pagehead"><div><h1>About Cloud Dojo</h1></div></div>
        <p className="lead">{TAGLINE}</p>
        <p className="disclaimer" role="note">{DISCLAIMER}</p>
        <p>{EMULATOR_CREDIT} Service names such as Amazon S3 or AWS Lambda are used only to say what a lesson is about; the interface uses its own icons.</p>
        <h2>AWS Emulator, and why this course runs on it</h2>
        <p className="lead">AWS Emulator is AWS&rsquo;s own local copy of the AWS APIs. You point the AWS CLI or an SDK at <code>https://127.0.0.1:9297</code> and it answers like AWS: no account, no card, no bill, nothing left running. This app turns it into a classroom: real commands, a checker that inspects the emulator&rsquo;s state, and a live map of what you built.</p>
        <div className="cta"><a className="btn primary" href="#/">Open the tracks</a><a className="btn" href="https://aws.amazon.com/products/developer-tools/emulator/" target="_blank" rel="noreferrer">AWS product page</a><a className="btn" href="https://github.com/aws/aws-emulator" target="_blank" rel="noreferrer">GitHub</a></div>

        <section className="container kv" aria-label="At a glance">
          <header><h2>At a glance</h2></header>
          <dl>
            <div><dt>Built by</dt><dd>AWS, generated from the SDK API models</dd></div>
            <div><dt>License</dt><dd>CC0-1.0 (vendored parts Apache-2.0)</dd></div>
            <div><dt>Pinned version</dt><dd><code>v1.0.341</code></dd></div>
            <div><dt>Endpoint</dt><dd><code>https://127.0.0.1:9297</code></dd></div>
            <div><dt>Account / Region</dt><dd><code>000000000000</code> / <code>us-east-1</code></dd></div>
            <div><dt>State</dt><dd>In memory, wiped on restart</dd></div>
          </dl>
        </section>

        <h2>What makes it unique</h2>
        <ul>
          <li><b>AWS builds it, from the same API models as the SDKs.</b> Each service is generated from the Smithy model that also produces the AWS SDKs, so new APIs show up automatically and responses have the exact shape SDKs expect. Hand-written emulators drift from AWS; this one starts from AWS&rsquo;s own definitions.</li>
          <li><b>It returns AWS&rsquo;s real errors.</b> <code>InvalidBucketName</code>, <code>ConditionalCheckFailedException</code>, <code>AccessDenied</code> naming the exact action. That is what teaches you how AWS thinks.</li>
          <li><b>Fidelity is published, not claimed.</b> Every release ships per-service pass/fail scores from tests checked against real AWS. For v1.0.341: SQS 89%, S3 84%, SNS 84%, EventBridge 86%, IAM 73%, DynamoDB 71%, HTTP APIs 56%, Lambda 50%, CloudFormation 16%. Each lesson shows its services&rsquo; scores.</li>
          <li><b>Free and open.</b> CC0-1.0 (its vendored parts are Apache-2.0), no account, no auth token, starts in about a second here, and a restart is a clean slate.</li>
        </ul>

        <h2>The problem it solves</h2>
        <p>Learning or testing AWS normally means a real account (a credit card, surprise bills, cleanup, slow deploys), mocks that quietly drift from how AWS behaves, or a third-party emulator. Beginners are the most afraid of the first one and get the least from the second. AWS Emulator gives AWS-shaped behavior on a laptop, with fast reset, so you can break things on purpose and try again in a second. AWS itself lists workshops and onboarding among its use cases.</p>

        <h2>How it compares</h2>
        <div className="tablewrap container" tabIndex={0}>
          <table className="dt">
            <thead><tr><th></th><th>Real AWS sandbox account</th><th>LocalStack</th><th>moto</th><th>AWS Emulator</th></tr></thead>
            <tbody>
              <tr><td>Who builds it</td><td>AWS (the real thing)</td><td>LocalStack GmbH, hand-written</td><td>Open-source community, hand-written Python</td><td>AWS, generated from SDK API models</td></tr>
              <tr><td>Cost / signup</td><td>Account, card, real bills</td><td>Since March 2026 an account and auth token are required; free tier is non-commercial, paid tiers for teams</td><td>Free, Apache-2.0</td><td>Free, CC0, no account</td></tr>
              <tr><td>How you run it</td><td>Cloud</td><td>Docker</td><td>Python decorators in-process, or a mock server</td><td>Native Linux binary; Docker on macOS and Windows (you build the image)</td></tr>
              <tr><td>Fidelity evidence</td><td>It is AWS</td><td>Docs and parity notes</td><td>Per-service coverage lists</td><td>Published per-release scores vs real AWS</td></tr>
              <tr><td>IAM enforcement</td><td>Real</td><td>Listed under paid plans</td><td>Limited, opt-in</td><td>Identity policies, S3 bucket, Lambda, SQS and KMS key policies enforced; DynamoDB resource policies, permission boundaries and tag conditions not; not a security test</td></tr>
              <tr><td>Persistence</td><td>Durable</td><td>Snapshots in paid plans</td><td>None</td><td>None: in-memory, restart to reset</td></tr>
              <tr><td>Best for</td><td>Final verification, security</td><td>Broad local dev on Docker</td><td>Python unit tests</td><td>Learning, CI, AWS-accurate errors</td></tr>
            </tbody>
          </table>
        </div>
        <Mermaid code={COMPARE_DIAGRAM} label="Diagram comparing the usual ways to test AWS with AWS Emulator" />

        <h2>Honest limits</h2>
        <div className="limits">
          <div><b>In-memory only</b>State is gone when the emulator stops. There is no reset API; this app resets by starting a fresh container.</div>
          <div><b>Not a security test</b>Identity policies and the S3, Lambda, SQS and KMS resource policies are enforced; DynamoDB resource policies, permission boundaries and tag conditions are not on real calls, and the emulator&rsquo;s own root key is never denied.</div>
          <div><b>One account, one Region</b>Account <code>000000000000</code>; resources are not separated by Region.</div>
          <div><b>Lambda is about 50%</b>Handlers run in an in-process engine; for example the bundled SNS SDK has no <code>PublishCommand</code>. Lessons keep handlers tiny.</div>
          <div><b>Testing, not production</b>Not built for long-running or load use; 2 GiB memory cap here. Docker is required on macOS.</div>
          <div><b>Version-pinned</b>It ships many releases a day. This app pins v1.0.341 and telemetry is turned off.</div>
        </div>

        <TracksList />
        <Capabilities />
        <EmulatorGaps />

        <h2>How this app works</h2>
        <Mermaid code={ARCH_DIAGRAM} label="Architecture of the Cloud Dojo app" />
        <ul>
          <li>The Bun server builds a pinned Docker image once, starts the emulator, waits for health and reads that run&rsquo;s generated keys and certificate. The certificate is trusted only for the emulator connection; TLS verification is never disabled globally.</li>
          <li>The terminal runs only the <code>aws</code> binary, with no shell and an environment built from scratch, so your real AWS credentials can never reach a lesson. <code>--profile</code> and <code>--endpoint-url</code> are refused.</li>
          <li>Every module starts from a known baseline that its own fixture builds, including its prerequisites, so you can start anywhere. <b>Reset module</b> restarts the emulator and rebuilds that baseline. Each module opens with predict-then-run questions, and the deep tracks end with an exam, graded locally with fixed answer keys (no model).</li>
          <li>Progress (checks passed, break-it, quiz answers, time, per-track completion and exam-domain readiness) is a JSON file in the data folder, so it survives restarts (written atomically, with a rolling backup). Checks you passed stay recorded even when the sandbox is reset, and you can mark a module done yourself or undo it; the app tells <b>Verified</b> from <b>Marked by you</b>. Starter files open in a small editor that can only write inside the module&rsquo;s own working folder, and an edited Lambda handler is zipped again by the server.</li>
          <li>The tutor panel talks to the model provider you choose (bring your own key) from the local server only. It sees the lesson, your checks, your last ten commands and the resource map, and it only suggests commands; you press run.</li>
        </ul>
        <div className="cta"><a className="btn primary" href="#/">Start with module 0.1</a></div>
      </div>
    </div>
  )
}
