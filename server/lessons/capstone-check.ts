import { GetFunctionConfigurationCommand, ListEventSourceMappingsCommand, ListProvisionedConcurrencyConfigsCommand } from '@aws-sdk/client-lambda'
import { GetRoleCommand, GetRolePolicyCommand, ListRolePoliciesCommand, SimulatePrincipalPolicyCommand } from '@aws-sdk/client-iam'
import { GetApisCommand, GetAuthorizerCommand, GetIntegrationsCommand, GetRoutesCommand } from '@aws-sdk/client-apigatewayv2'
import { InitiateAuthCommand, ListUserPoolClientsCommand, ListUserPoolsCommand } from '@aws-sdk/client-cognito-identity-provider'
import { DeleteMessageCommand, GetQueueAttributesCommand, ReceiveMessageCommand, SendMessageCommand } from '@aws-sdk/client-sqs'
import { ListSubscriptionsByTopicCommand } from '@aws-sdk/client-sns'
import { DescribeAlarmsCommand, ListMetricsCommand, SetAlarmStateCommand } from '@aws-sdk/client-cloudwatch'
import { DescribeExecutionCommand, DescribeStateMachineCommand, GetExecutionHistoryCommand, StartExecutionCommand } from '@aws-sdk/client-sfn'
import { GetBucketEncryptionCommand, GetBucketLifecycleConfigurationCommand, GetPublicAccessBlockCommand } from '@aws-sdk/client-s3'
import { DescribeKeyCommand, ListAliasesCommand } from '@aws-sdk/client-kms'
import { DescribeTableCommand, GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb'
import type { CheckResult } from '../../shared/types'
import { arn, queueUrl, type Ctx } from '../lesson-kit'
import { hasWildcardAction, waitFor } from './kit2'
import { CAP, DANGEROUS, machineArn, NEEDED } from './capstone-defs'

/** One sub-check. `pass: null` means "needs the Check button" (it sends test traffic). */
interface Sub { label: string; pass: boolean | null; hint: string }
const sub = (label: string, pass: boolean | null, hint: string): Sub => ({ label, pass, hint })

/** Never throws: a missing resource or an API error is simply "not yet". */
async function safe<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try { return await fn() } catch { return undefined }
}

const PILLARS = [
  { id: 'opsex', name: 'Operational Excellence' },
  { id: 'security', name: 'Security' },
  { id: 'reliability', name: 'Reliability' },
  { id: 'performance', name: 'Performance Efficiency' },
  { id: 'cost', name: 'Cost Optimization' },
  { id: 'sustainability', name: 'Sustainability' },
] as const
export const PILLAR_ROWS = PILLARS.map((p) => ({ id: p.id, name: p.name }))

function row(id: string, name: string, subs: Sub[]): CheckResult {
  const failed = subs.filter((s) => s.pass === false)
  const passed = subs.filter((s) => s.pass === true).length
  const pending = subs.filter((s) => s.pass === null).length
  const pass = failed.length ? false : pending ? null : true
  return {
    id,
    label: name,
    pillar: name,
    pass,
    hint: pass === true ? undefined : failed.length ? `Next: ${failed[0].hint}` : `Press Run checks to evaluate ${pending} more (they send test traffic).`,
    // counts only: no ids, tokens or payloads
    detail: `${passed} of ${subs.length} sub-checks pass${failed.length ? `, ${failed.length} failing` : ''}${pending ? `, ${pending} await Run checks` : ''}`,
    sub: subs.map((s) => ({ label: s.label, pass: s.pass })),
  }
}

const tableOf = (ctx: Ctx) => safe(async () => (await ctx.c.ddb.send(new DescribeTableCommand({ TableName: CAP.table }))).Table)
const fnConfig = (ctx: Ctx, name: string) => safe(async () => await ctx.c.lambda.send(new GetFunctionConfigurationCommand({ FunctionName: name })))
const queueAttrs = (ctx: Ctx, name: string) => safe(async () => (await ctx.c.sqs.send(new GetQueueAttributesCommand({ QueueUrl: queueUrl(name), AttributeNames: ['All'] }))).Attributes)

/** The learner's roles: no wildcard action in an inline policy, and the simulator allows what is needed and denies what is dangerous. */
async function leastPrivilege(ctx: Ctx, key: 'api' | 'worker' | 'moderator'): Promise<boolean> {
  const role = CAP.roles[key]
  const fn = await fnConfig(ctx, CAP.fns[key])
  if (!fn || fn.Role !== arn.role(role)) return false
  const names = (await safe(async () => (await ctx.c.iam.send(new ListRolePoliciesCommand({ RoleName: role }))).PolicyNames)) ?? []
  if (!names.length) return false
  for (const n of names) {
    const doc = (await safe(async () => (await ctx.c.iam.send(new GetRolePolicyCommand({ RoleName: role, PolicyName: n }))).PolicyDocument))
    if (!doc || hasWildcardAction(doc)) return false
  }
  const decide = async (actions: string[], resource: string) => {
    const r = await ctx.c.iam.send(new SimulatePrincipalPolicyCommand({ PolicySourceArn: arn.role(role), ActionNames: actions, ResourceArns: [resource] }))
    return Object.fromEntries((r.EvaluationResults ?? []).map((e) => [e.EvalActionName, e.EvalDecision]))
  }
  try {
    for (const need of NEEDED[key]) {
      const d = await decide(need.actions, need.resource)
      if (need.actions.some((a) => d[a] !== 'allowed')) return false
    }
    const bad = await decide(DANGEROUS, '*')
    return !DANGEROUS.some((a) => bad[a] === 'allowed')
  } catch { return false }
}

async function recvTag(ctx: Ctx, queue: string, needle: string, ms: number): Promise<boolean> {
  return waitFor(async () => {
    const r = await ctx.c.sqs.send(new ReceiveMessageCommand({ QueueUrl: queueUrl(queue), MaxNumberOfMessages: 10, WaitTimeSeconds: 1, VisibilityTimeout: 1 }))
    const hit = (r.Messages ?? []).filter((m) => m.Body?.includes(needle))
    for (const m of hit) await ctx.c.sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl(queue), ReceiptHandle: m.ReceiptHandle! }))
    return hit.length > 0
  }, ms, 300)
}

const sfnProbe = async (ctx: Ctx, input: { id: string; text: string }) => {
  const started = await ctx.c.sfn.send(new StartExecutionCommand({ stateMachineArn: machineArn, input: JSON.stringify(input) }))
  let status = 'RUNNING'
  await waitFor(async () => {
    status = (await ctx.c.sfn.send(new DescribeExecutionCommand({ executionArn: started.executionArn }))).status ?? 'RUNNING'
    return status !== 'RUNNING'
  }, 25000, 500)
  const events = (await safe(async () => (await ctx.c.sfn.send(new GetExecutionHistoryCommand({ executionArn: started.executionArn, maxResults: 200 }))).events)) ?? []
  return {
    status,
    flagged: events.some((e) => e.stateEnteredEventDetails?.name === 'FlagNote'),
    failures: events.filter((e) => e.type === 'LambdaFunctionFailed' || e.type === 'TaskFailed').length,
  }
}

/** The mini Well-Architected review: one row per pillar. */
export async function review(ctx: Ctx, probe: boolean): Promise<CheckResult[]> {
  // ---------- configuration (always evaluated) ----------
  const fns = {
    api: await fnConfig(ctx, CAP.fns.api),
    worker: await fnConfig(ctx, CAP.fns.worker),
    moderator: await fnConfig(ctx, CAP.fns.moderator),
  }
  const table = await tableOf(ctx)
  const apis = (await safe(async () => (await ctx.c.apigw.send(new GetApisCommand({}))).Items)) ?? []
  const api = apis.find((a) => a.Name === CAP.api)
  const routes = api?.ApiId ? ((await safe(async () => (await ctx.c.apigw.send(new GetRoutesCommand({ ApiId: api.ApiId! }))).Items)) ?? []) : []
  const route = routes.find((r) => r.RouteKey === 'POST /notes')
  const integrations = api?.ApiId ? ((await safe(async () => (await ctx.c.apigw.send(new GetIntegrationsCommand({ ApiId: api.ApiId! }))).Items)) ?? []) : []
  const integration = integrations.find((i) => route?.Target?.endsWith(`/${i.IntegrationId}`))
  const pool = (await safe(async () => (await ctx.c.cognito.send(new ListUserPoolsCommand({ MaxResults: 60 }))).UserPools))?.find((p) => p.Name === CAP.pool)
  const client = pool?.Id ? (await safe(async () => (await ctx.c.cognito.send(new ListUserPoolClientsCommand({ UserPoolId: pool.Id!, MaxResults: 60 }))).UserPoolClients))?.find((c) => c.ClientName === CAP.client) : undefined
  let jwtConfigured = false
  if (api?.ApiId && route?.AuthorizationType === 'JWT' && route.AuthorizerId && pool?.Id && client?.ClientId) {
    const a = await safe(async () => await ctx.c.apigw.send(new GetAuthorizerCommand({ ApiId: api.ApiId!, AuthorizerId: route.AuthorizerId! })))
    jwtConfigured = Boolean(a?.JwtConfiguration?.Issuer?.endsWith(pool.Id) && a.JwtConfiguration.Audience?.includes(client.ClientId))
  }
  const edits = await queueAttrs(ctx, CAP.edits)
  const dlq = await queueAttrs(ctx, CAP.dlq)
  const redrive = (() => { try { return JSON.parse(edits?.RedrivePolicy ?? '') as { deadLetterTargetArn?: string; maxReceiveCount?: number | string } } catch { return undefined } })()
  const redriveOk = Boolean(redrive?.deadLetterTargetArn === arn.queue(CAP.dlq) && dlq && Number(redrive.maxReceiveCount) >= 1 && Number(redrive.maxReceiveCount) <= 10)
  const esm = (await safe(async () => (await ctx.c.lambda.send(new ListEventSourceMappingsCommand({ FunctionName: CAP.fns.worker }))).EventSourceMappings)) ?? []
  const esmOk = esm.some((m) => m.EventSourceArn === arn.queue(CAP.edits) && m.State !== 'Disabled' && m.State !== 'Disabling')
  const machine = await safe(async () => await ctx.c.sfn.send(new DescribeStateMachineCommand({ stateMachineArn: machineArn })))
  let asl: { States?: Record<string, { Retry?: { BackoffRate?: number; MaxAttempts?: number; IntervalSeconds?: number }[]; Catch?: unknown[]; Type?: string }> } = {}
  try { asl = JSON.parse(machine?.definition ?? '{}') } catch { /* invalid */ }
  const tasks = Object.values(asl.States ?? {}).filter((s) => s.Type === 'Task')
  const retryOk = tasks.some((t) => (t.Retry ?? []).some((r) => (r.BackoffRate ?? 0) > 1) && (t.Catch ?? []).length > 0)
  let sfnTrust = false
  if (machine?.roleArn) {
    const doc = (await safe(async () => (await ctx.c.iam.send(new GetRoleCommand({ RoleName: machine.roleArn!.split('/').pop()! }))).Role?.AssumeRolePolicyDocument))
    sfnTrust = Boolean(doc && decodeURIComponent(doc).includes('states.amazonaws.com'))
  }
  const alarms = (await safe(async () => (await ctx.c.cw.send(new DescribeAlarmsCommand({}))).MetricAlarms)) ?? []
  const alarm = alarms.find((a) => a.Namespace === 'AWS/Lambda' && a.MetricName === 'Errors' && (a.Dimensions ?? []).some((d) => d.Name === 'FunctionName' && d.Value === CAP.fns.api) && (a.AlarmActions ?? []).includes(arn.topic(CAP.topic)))
  const subs = (await safe(async () => (await ctx.c.sns.send(new ListSubscriptionsByTopicCommand({ TopicArn: arn.topic(CAP.topic) }))).Subscriptions)) ?? []
  const inboxSub = subs.find((s) => s.Protocol === 'sqs' && s.Endpoint && s.SubscriptionArn !== 'PendingConfirmation')
  const inboxName = inboxSub?.Endpoint?.split(':').pop()
  const enc = (await safe(async () => (await ctx.c.s3.send(new GetBucketEncryptionCommand({ Bucket: CAP.bucket }))).ServerSideEncryptionConfiguration?.Rules?.[0]?.ApplyServerSideEncryptionByDefault))
  let cmk = false
  if (enc?.SSEAlgorithm === 'aws:kms' && enc.KMSMasterKeyID) {
    const key = await safe(async () => (await ctx.c.kms.send(new DescribeKeyCommand({ KeyId: enc.KMSMasterKeyID! }))).KeyMetadata)
    const aliases = key?.KeyId ? ((await safe(async () => (await ctx.c.kms.send(new ListAliasesCommand({ KeyId: key.KeyId! }))).Aliases)) ?? []) : []
    cmk = key?.KeyManager === 'CUSTOMER' && aliases.some((a) => a.AliasName?.startsWith('alias/') && !a.AliasName.startsWith('alias/aws/'))
  }
  const bpa = (await safe(async () => (await ctx.c.s3.send(new GetPublicAccessBlockCommand({ Bucket: CAP.bucket }))).PublicAccessBlockConfiguration))
  const bpaOk = Boolean(bpa?.BlockPublicAcls && bpa.IgnorePublicAcls && bpa.BlockPublicPolicy && bpa.RestrictPublicBuckets)
  const lifecycle = (await safe(async () => (await ctx.c.s3.send(new GetBucketLifecycleConfigurationCommand({ Bucket: CAP.bucket }))).Rules)) ?? []
  const lifeOk = lifecycle.some((r) => r.Status === 'Enabled' && (r.Expiration?.Days ?? 0) >= 1 && (r.Filter?.Prefix === 'tmp/' || r.Prefix === 'tmp/'))
  const smallFns = Object.values(fns).every((f) => f && (f.MemorySize ?? 128) <= 256 && (f.Timeout ?? 3) <= 15)
  const noPc = await (async () => {
    for (const name of Object.values(CAP.fns)) {
      const r = await safe(async () => (await ctx.c.lambda.send(new ListProvisionedConcurrencyConfigsCommand({ FunctionName: name }))).ProvisionedConcurrencyConfigs)
      if (!r || r.length > 0) return false
    }
    return true
  })()
  const iam = { api: await leastPrivilege(ctx, 'api'), worker: await leastPrivilege(ctx, 'worker'), moderator: await leastPrivilege(ctx, 'moderator') }

  // ---------- probes (Check button only) ----------
  let unauth: boolean | null = null
  let authed: boolean | null = null
  let dedup: boolean | null = null
  let edited: boolean | null = null
  let clean: boolean | null = null
  let poison: boolean | null = null
  let transient: boolean | null = null
  let alarmDelivered: boolean | null = null
  let metricsOk: boolean | null = null
  if (probe) {
    unauth = authed = dedup = edited = clean = poison = transient = alarmDelivered = metricsOk = false
    const stamp = Date.now()
    const getItem = async (id: string) => (await safe(async () => (await ctx.c.ddb.send(new GetItemCommand({ TableName: CAP.table, Key: { id: { S: id } } }))).Item))
    const apiProbe = async (): Promise<string | undefined> => {
      if (!api?.ApiEndpoint) return undefined
      const url = api.ApiEndpoint + '/notes'
      const body = JSON.stringify({ text: 'probe note' })
      const headers = { 'content-type': 'application/json' }
      const r0 = await safe(() => ctx.httpGet(url, { method: 'POST', body, headers }))
      unauth = r0?.status === 401
      let token: string | undefined
      if (pool?.Id && client?.ClientId) {
        token = (await safe(async () => (await ctx.c.cognito.send(new InitiateAuthCommand({
          ClientId: client.ClientId!, AuthFlow: 'USER_PASSWORD_AUTH', AuthParameters: { USERNAME: CAP.user, PASSWORD: CAP.password },
        }))).AuthenticationResult?.IdToken))
      }
      if (!token) return undefined
      let id: string | undefined
      for (let i = 0; i < 3 && !id; i++) {
        const r = await safe(() => ctx.httpGet(url, { method: 'POST', body, headers: { ...headers, authorization: `Bearer ${token}` } }))
        if (r?.status === 201) { try { id = JSON.parse(r.body).id as string } catch { /* not json */ } }
        else await Bun.sleep(1000)
      }
      authed = Boolean(id && await getItem(id))
      return id
    }
    const editProbe = async (noteId: string | undefined) => {
      let id = noteId
      if (!id) {
        // The API leg failed; test the queue and worker on their own with a directly written item.
        id = `note#probe-${stamp}`
        await safe(() => ctx.c.ddb.send(new PutItemCommand({ TableName: CAP.table, Item: { id: { S: id! }, text: { S: 'before' } } })))
      }
      const text = `edited-${stamp}`
      const send = () => ctx.c.sqs.send(new SendMessageCommand({ QueueUrl: queueUrl(CAP.edits), MessageBody: JSON.stringify({ id, text }), MessageGroupId: id!, MessageDeduplicationId: `probe-${stamp}` }))
      const first = await safe(send)
      const second = await safe(send)
      dedup = Boolean(first?.MessageId && first.MessageId === second?.MessageId)
      edited = first ? await waitFor(async () => (await getItem(id!))?.text?.S === text, 10000, 500) : false
    }
    const sfnProbes = async () => {
      if (!machine) return
      const [c, p, t] = await Promise.all([
        safe(() => sfnProbe(ctx, { id: `p-${stamp}-clean`, text: 'a lovely day' })),
        safe(() => sfnProbe(ctx, { id: `p-${stamp}-poison`, text: 'POISON pill' })),
        safe(() => sfnProbe(ctx, { id: `p-${stamp}-transient`, text: 'TRANSIENT flake' })),
      ])
      clean = c?.status === 'SUCCEEDED' && !c.flagged
      poison = Boolean(p && p.flagged && p.failures >= 1 && p.failures < 3)
      transient = Boolean(t && t.flagged && t.failures >= 2)
    }
    const alarmProbe = async () => {
      if (!alarm?.AlarmName || !inboxName) return
      const reason = `capstone probe ${stamp}`
      await safe(() => ctx.c.cw.send(new SetAlarmStateCommand({ AlarmName: alarm.AlarmName!, StateValue: 'ALARM', StateReason: reason })))
      alarmDelivered = await recvTag(ctx, inboxName, alarm.AlarmName, 10000)
      await safe(() => ctx.c.cw.send(new SetAlarmStateCommand({ AlarmName: alarm.AlarmName!, StateValue: 'OK', StateReason: 'capstone probe finished' })))
    }
    let noteId: string | undefined
    await Promise.all([
      (async () => { noteId = await safe(apiProbe) })(),
      sfnProbes(),
      alarmProbe(),
    ])
    await safe(() => editProbe(noteId))
    // The probes above invoked snap-api: its metrics must now exist for the alarm to read.
    const metrics = (await safe(async () => (await ctx.c.cw.send(new ListMetricsCommand({ Namespace: 'AWS/Lambda', MetricName: 'Invocations' }))).Metrics)) ?? []
    metricsOk = metrics.some((m) => (m.Dimensions ?? []).some((d) => d.Name === 'FunctionName' && d.Value === CAP.fns.api))
  }

  // ---------- one row per pillar ----------
  return [
    row('opsex', 'Operational Excellence', [
      sub('Alarm on AWS/Lambda Errors for snap-api, action = topic snap-alerts', Boolean(alarm), 'Create an alarm on `AWS/Lambda` `Errors` with dimension `FunctionName=snap-api` and `--alarm-actions` set to the `snap-alerts` topic ARN.'),
      sub('Topic snap-alerts has a confirmed SQS subscriber', Boolean(inboxSub), 'Create the topic, an inbox queue whose policy lets SNS send from the topic, then subscribe the queue.'),
      sub('An alarm notification reaches the inbox queue', alarmDelivered, 'Check the queue policy on the inbox: it must allow `sns.amazonaws.com` to `sqs:SendMessage` from the topic.'),
      sub('snap-api publishes the AWS/Lambda metrics the alarm reads', metricsOk, 'The function must exist and be invoked (the signed-in POST does that); then `Invocations` and `Duration` appear under `AWS/Lambda` (`Errors` only after a failure).'),
    ]),
    row('security', 'Security', [
      sub('POST /notes uses a JWT authorizer (Cognito pool and app client)', jwtConfigured, 'Create a JWT authorizer with the token\'s `iss` claim as issuer and the app client as audience; attach it to the route.'),
      sub('No token gets 401', unauth, 'The route must require the authorizer (`--authorization-type JWT`).'),
      sub('An IdToken for ana gets 201 and an item in Notes', authed, 'Check the route target, the Lambda permission for API Gateway, and the role of `snap-api`.'),
      sub('Photo bucket default encryption is SSE-KMS with your own aliased key', cmk, 'Create a KMS key and alias, then `put-bucket-encryption` with `aws:kms` and that key.'),
      sub('Block Public Access is fully on for the photo bucket', bpaOk, 'Set all four BPA flags to true on `snap-photos`.'),
      sub('snap-api-role is least privilege', iam.api, 'Own role, exact actions and ARNs: `PutItem` on Notes, no `*` actions.'),
      sub('snap-worker-role is least privilege', iam.worker, 'Own role: `UpdateItem` on Notes and receive/delete on the edits queue only.'),
      sub('snap-moderator-role is least privilege', iam.moderator, 'Own role: it only writes its own logs.'),
    ]),
    row('reliability', 'Reliability', [
      sub('note-edits.fifo is a FIFO queue', edits?.FifoQueue === 'true', 'Create it with `FifoQueue=true` (and content-based deduplication).'),
      sub('Duplicate edit (same deduplication id) is dropped', dedup, 'FIFO queues deduplicate within five minutes; the second send must return the first message id.'),
      sub('Redrive policy sends failures to the FIFO dead-letter queue (max receives 1 to 10)', redriveOk, 'Create `note-edits-dlq.fifo` and set `RedrivePolicy` on the edits queue.'),
      sub('note-moderation is Standard, its role trusts states.amazonaws.com, and Moderate has Retry with backoff plus Catch', Boolean(machine && machine.type === 'STANDARD' && sfnTrust && retryOk), 'Add a Retry with `BackoffRate` above 1 and a Catch to the Moderate task; trust the Step Functions service in the role.'),
      sub('Clean note: execution SUCCEEDED without flagging', clean, 'The happy path `Moderate` → `Approved` must work: check the role can invoke `snap-moderator`.'),
      sub('Poison note: caught and sent to FlagNote', poison, 'Catch `States.ALL` (or `PoisonNote`) and go to a state named `FlagNote`.'),
      sub('Transient failure: retried at least twice, then flagged', transient, 'Retry `Transient` with `MaxAttempts` of 2 or more; when retries run out the Catch takes over.'),
    ]),
    row('performance', 'Performance Efficiency', [
      sub('snap-notes is an HTTP API with POST /notes → snap-api', Boolean(api && integration?.IntegrationUri?.includes(CAP.fns.api)), 'Create an HTTP API (`apigatewayv2`), a Lambda proxy integration for `snap-api` and the route `POST /notes`.'),
      sub('snap-worker reads note-edits.fifo through an event source mapping', esmOk, 'Create the event source mapping (the worker role needs receive, delete and attributes on the queue).'),
      sub('An edit is applied to the note within 10 s', edited, 'Check the mapping is enabled and the worker role can `UpdateItem` on Notes.'),
    ]),
    row('cost', 'Cost Optimization', [
      sub('Notes table uses on-demand billing', table?.BillingModeSummary?.BillingMode === 'PAY_PER_REQUEST', 'Create the table with `--billing-mode PAY_PER_REQUEST`.'),
      sub('Edits queue uses long polling (wait time 10 s or more)', Number(edits?.ReceiveMessageWaitTimeSeconds ?? 0) >= 10, 'Set `ReceiveMessageWaitTimeSeconds=20` on the queue to cut empty receives.'),
      sub('No provisioned concurrency on any function', noPc && Object.values(fns).every(Boolean), 'Provisioned concurrency bills while idle; none of these functions needs it.'),
    ]),
    row('sustainability', 'Sustainability', [
      sub('All functions use 256 MB or less and a 15 s timeout or less', smallFns, 'Right-size: `--memory-size 128` and `--timeout 10` are plenty for these handlers.'),
      sub('Photo bucket expires objects under tmp/ (lifecycle rule)', lifeOk, 'Add an enabled lifecycle rule with prefix `tmp/` and an expiration in days.'),
    ]),
  ]
}
