import type { Honesty } from './types'

/**
 * The honest emulator-gaps table. Single source for the About page, README and docs/EMULATOR-GAPS.md
 * (regenerate the two files with `bun scripts/gen-gaps.ts`; tests/gaps.test.ts keeps all of it honest).
 *
 * Derived, not guessed:
 *  - `probes` are keys of the capability probe (server/capabilities.ts, probes-*.ts). A test fails if a probe
 *    exists that no row mentions, or a row names a probe that does not exist.
 *  - `lessons` are modules whose declared badge (Live / Simulated / Concept) and honestyNote say what the
 *    lesson does about the gap. A test fails if the declared badge here drifts from the lesson.
 */
export interface GapRow {
  service: string
  live: string
  missing: string
  /** One sentence on what the lessons do about the gaps. */
  handling: string
  /** Declared badge per module involved, in module order. */
  lessons: { id: string; badge: Honesty }[]
  probes: string[]
}

export const GAPS: GapRow[] = [
  {
    service: 'AWS IAM and STS',
    live: 'Identity policies and explicit Deny, the `s3:prefix` condition, roles, trust policies and `AssumeRole`, and resource policies on S3, SQS, Lambda and KMS.',
    missing: 'Permission boundaries, session policies, `aws:PrincipalTag` / `aws:ResourceTag` conditions, policy variables such as `${aws:username}` and `aws:SourceIp` are not applied to real calls. DynamoDB resource policies are accepted but not enforced.',
    handling: 'Boundaries are taught through `simulate-principal-policy` (the checker uses the simulation only). ABAC is a concept module: you write the policy, a static check reads it, a quiz grades it. Session policies and DynamoDB resource policies are explained in text only.',
    lessons: [{ id: 'iam-evaluation', badge: 'live' }, { id: 'iam-conditions', badge: 'live' }, { id: 'iam-roles-sts', badge: 'live' }, { id: 'iam-resource-policies', badge: 'live' }, { id: 'iam-boundaries', badge: 'simulated' }, { id: 'iam-abac', badge: 'concept' }],
    probes: ['s3-bucket-policy', 'sqs-queue-policy', 'lambda-resource-policy', 'kms-key-policy', 'dynamodb-resource-policy', 'permission-boundary', 'abac-principal-tag', 'iam-session-policy', 'iam-policy-variable', 'iam-source-ip'],
  },
  {
    service: 'Amazon S3',
    live: 'Buckets, versioning, presigned URLs (a tampered signature is refused), multipart, event notifications, SSE-KMS, Block Public Access, Object Lock, same-region replication, conditional writes, bucket policies.',
    missing: 'Lifecycle rules are stored but never run, and transitions real S3 rejects are accepted. Disabling a KMS key does not block reads of SSE-KMS objects. Cross-region and cross-account replication and Replication Time Control are not testable. `CopyObject` with `If-None-Match` is not implemented.',
    handling: 'The lifecycle module validates your `lifecycle.json` against the real AWS rules inside the app (Simulated). The disabled-key case has no hands-on step and is explained in text.',
    lessons: [{ id: 's3-lifecycle', badge: 'simulated' }, { id: 's3-data-protection', badge: 'live' }, { id: 's3-replication-conditional', badge: 'live' }],
    probes: ['s3-lifecycle-validation', 's3-kms-disabled-key'],
  },
  {
    service: 'Amazon DynamoDB',
    live: 'Keys, Query and Scan, GSIs and LSIs (consistent reads on a GSI are refused), conditional writes, all-or-nothing transactions, streams with a Lambda trigger, TTL.',
    missing: 'Resource policies are not enforced. TTL deletes within about 15 seconds here; on AWS it takes hours to days.',
    handling: 'Hands-on and checked for real. The resource-policy exception and the real TTL delay are stated in the module and in IAM 1.5.',
    lessons: [{ id: 'ddb-indexes', badge: 'live' }, { id: 'ddb-transactions', badge: 'live' }, { id: 'ddb-streams-ttl', badge: 'live' }],
    probes: ['ddb-gsi-eventual-only', 'ddb-transaction-atomic'],
  },
  {
    service: 'AWS Lambda',
    live: 'Configuration, errors, timeouts and log tails, versions and weighted aliases (published versions are immutable), layers, reserved concurrency and throttling, function URLs, resource policies, SQS event source mappings with partial batch responses.',
    missing: 'Every invoke gets a fresh sandbox, so cold versus warm starts and real latency cannot be shown. Provisioned concurrency is cosmetic. Async destinations and DLQ settings are accepted but nothing is delivered. A function URL opens after one statement (AWS needs two) and is an emulator address. Invokes do not create CloudWatch log groups.',
    handling: 'Async destinations is a concept module (static review of your JSON plus a quiz); hands-on failure handling moves to the SQS redrive module. The other gaps are named in the module text.',
    lessons: [{ id: 'lambda-config-errors', badge: 'live' }, { id: 'lambda-concurrency', badge: 'live' }, { id: 'lambda-function-url', badge: 'live' }, { id: 'lambda-async-destinations', badge: 'concept' }],
    probes: ['lambda-resource-policy', 'lambda-async-destination'],
  },
  {
    service: 'Amazon SQS and SNS',
    live: 'Visibility timeouts, dead-letter queues with redrive, FIFO deduplication, SNS filter policies and fan-out, queue access policies.',
    missing: 'Scaling behaviour under heavy load is not representative.',
    handling: 'Hands-on and checked for real; load behaviour is not claimed anywhere.',
    lessons: [{ id: 'sqs-dlq-redrive', badge: 'live' }, { id: 'sqs-fifo', badge: 'live' }, { id: 'sns-filter-fanout', badge: 'live' }, { id: 'sqs-lambda-batch', badge: 'live' }],
    probes: ['sqs-fifo-dedup', 'sqs-dlq-redrive', 'sns-filter-policy', 'sqs-queue-policy'],
  },
  {
    service: 'Amazon API Gateway',
    live: 'HTTP API routes, stages and auto-deploy, Lambda authorizers, Cognito-style JWT authorizers (issuer, audience, scopes), stage throttling (429), CORS headers, REST API keys and usage-plan quotas.',
    missing: 'The Lambda invoke permission for API Gateway is not enforced. A missing stage answers 403, not 404, and a CORS preflight answers 404 where AWS answers 204. The JWT issuer is the emulator address. Fidelity for the REST API is not published.',
    handling: 'Hands-on. Each module says which status codes differ and tells you to read the headers, not the status.',
    lessons: [{ id: 'apigw-routes-stages', badge: 'live' }, { id: 'apigw-lambda-authorizer', badge: 'live' }, { id: 'apigw-jwt-cognito', badge: 'live' }, { id: 'apigw-throttle-cors', badge: 'live' }, { id: 'apigw-rest-keys-usage', badge: 'live' }],
    probes: [],
  },
  {
    service: 'AWS Step Functions',
    live: 'Standard executions, Retry and Catch, inline Map, Choice, Wait, the DynamoDB service integration, callbacks with task tokens, Express machines, JSONata.',
    missing: 'The state machine role\'s trust policy is not checked at create time. Distributed Map does not run. `test-state` on a Task state needs a mock. `TaskDoesNotExist` cannot be produced from the CLI.',
    handling: 'Hands-on. Distributed Map is described, not run; the `test-state` module tests Pass and Choice states only.',
    lessons: [{ id: 'sfn-retry', badge: 'live' }, { id: 'sfn-catch-fail', badge: 'live' }, { id: 'sfn-map-choice-ddb', badge: 'live' }, { id: 'sfn-wait-for-token', badge: 'live' }, { id: 'sfn-express-jsonata', badge: 'live' }],
    probes: [],
  },
  {
    service: 'Amazon EventBridge and Scheduler',
    live: 'Custom buses, patterns, `test-event-pattern`, targets with their role or resource-policy checks, one-off and recurring schedules that really fire, archive and replay.',
    missing: 'No gap found by the probe or while building the modules.',
    handling: 'Hands-on; archive and replay is re-checked by a probe on every emulator image.',
    lessons: [{ id: 'eb-patterns', badge: 'live' }, { id: 'eb-targets-sfn', badge: 'live' }, { id: 'eb-scheduler', badge: 'live' }, { id: 'eb-archive-replay', badge: 'live' }],
    probes: ['eventbridge-replay'],
  },
  {
    service: 'Amazon CloudWatch and Logs',
    live: 'Custom metrics, statistics, percentiles and metric math, alarms that evaluate on their own and publish to SNS, metric filters, Logs Insights queries, stored dashboards.',
    missing: 'There is no console, so the app draws the stored dashboard itself. Dashboard body validation is partial.',
    handling: 'The Logs module is declared Simulated and shows Live while both of its probes pass (they did on 1.0.341); if an emulator update breaks either probe it falls back to Simulated on its own.',
    lessons: [{ id: 'cw-metrics', badge: 'live' }, { id: 'cw-alarms-sns', badge: 'live' }, { id: 'cw-logs-insights', badge: 'simulated' }, { id: 'cw-dashboards', badge: 'live' }],
    probes: ['cw-metric-filter-emits', 'cw-insights-rows'],
  },
  {
    service: 'AWS KMS, Secrets Manager and Parameter Store',
    live: 'Symmetric keys, aliases, data keys, encryption context, key policies and grants, secret versions and staging labels, rotation that really invokes your Lambda, SecureString parameters.',
    missing: 'Rotation only records settings and does not age keys; the deletion window never elapses. A rotated secret keeps its `AWSPENDING` label. IAM is not evaluated on `ssm:` actions.',
    handling: 'Hands-on. No module relies on IAM for Parameter Store, and the gaps are named in the module text.',
    lessons: [{ id: 'kms-envelope', badge: 'live' }, { id: 'kms-policies-grants', badge: 'live' }, { id: 'secrets-rotation', badge: 'live' }, { id: 'ssm-parameter-store', badge: 'live' }],
    probes: ['kms-key-policy'],
  },
  {
    service: 'The emulator as a whole',
    live: 'AWS-shaped APIs and real AWS error codes, started in about a second, with a clean slate on every restart.',
    missing: 'In memory only (no persistence, no reset API), one account (`000000000000`) and one Region, not built for load or long-running use, and not a security test. The version is pinned (v1.0.341) because it ships many releases a day. Services outside the course are out of scope (published fidelity: CloudFormation 16%, EC2 45%).',
    handling: 'Reset module restarts the emulator and rebuilds the module\'s baseline. Nothing here should be used to verify production security.',
    lessons: [],
    probes: [],
  },
]

const BADGE: Record<Honesty, string> = { live: 'Live', simulated: 'Simulated', concept: 'Concept' }

/** Markdown table, identical in README.md and docs/EMULATOR-GAPS.md. */
export function gapsMarkdown(rows: GapRow[] = GAPS): string {
  const cell = (s: string) => s.replace(/\|/g, '\\|')
  const badges = (r: GapRow) => {
    const set = [...new Set(r.lessons.map((l) => l.badge))]
    const order: Honesty[] = ['live', 'simulated', 'concept']
    return order.filter((b) => set.includes(b)).map((b) => `**${BADGE[b]}**`).join(' · ') || '—'
  }
  const lines = [
    '| Service | What works live | What\'s simulated or missing | How the lesson handles it |',
    '|---|---|---|---|',
    ...rows.map((r) => `| ${cell(r.service)} | ${cell(r.live)} | ${cell(r.missing)} | ${badges(r)}: ${cell(r.handling)} |`),
  ]
  return lines.join('\n')
}
