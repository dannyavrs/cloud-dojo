import { GetRestApisCommand } from '@aws-sdk/client-api-gateway'
import { ListUserPoolsCommand } from '@aws-sdk/client-cognito-identity-provider'
import { GetApisCommand, GetIntegrationsCommand } from '@aws-sdk/client-apigatewayv2'
import { ListTablesCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb'
import { ListUsersCommand, ListRolesCommand, ListRolePoliciesCommand, GetRolePolicyCommand } from '@aws-sdk/client-iam'
import { ListFunctionsCommand, ListEventSourceMappingsCommand } from '@aws-sdk/client-lambda'
import { GetBucketNotificationConfigurationCommand, ListBucketsCommand } from '@aws-sdk/client-s3'
import { ListSubscriptionsCommand, ListTopicsCommand } from '@aws-sdk/client-sns'
import { GetQueueAttributesCommand, ListQueuesCommand } from '@aws-sdk/client-sqs'
import { DescribeKeyCommand, ListAliasesCommand, ListKeysCommand } from '@aws-sdk/client-kms'
import { ListSecretsCommand } from '@aws-sdk/client-secrets-manager'
import type { MapEdge, MapNode, ResourceMap } from '../shared/types'
import type { Clients } from './clients'
import { ListEventBusesCommand, ListRulesCommand, ListTargetsByRuleCommand } from '@aws-sdk/client-eventbridge'
import { DescribeStateMachineCommand, ListStateMachinesCommand } from '@aws-sdk/client-sfn'

const tail = (arn: string) => arn.split(':').pop()!.split('/').pop()!

/** Snapshot of everything the lessons create, plus the wiring between them, built from real config. */
export async function buildMap(c: Clients): Promise<ResourceMap> {
  const nodes: MapNode[] = []
  const edges: MapEdge[] = []
  const add = (n: MapNode) => nodes.push(n)
  const edge = (from: string, to: string, label?: string) => edges.push({ from, to, label })
  const arnToId = new Map<string, string>()
  const safe = async <T,>(p: Promise<T>): Promise<T | undefined> => p.catch(() => undefined)

  const [buckets, tables, queues, topics, fns, apis, users, roles] = await Promise.all([
    safe(c.s3.send(new ListBucketsCommand({}))),
    safe(c.ddb.send(new ListTablesCommand({}))),
    safe(c.sqs.send(new ListQueuesCommand({}))),
    safe(c.sns.send(new ListTopicsCommand({}))),
    safe(c.lambda.send(new ListFunctionsCommand({}))),
    safe(c.apigw.send(new GetApisCommand({}))),
    safe(c.iam.send(new ListUsersCommand({}))),
    safe(c.iam.send(new ListRolesCommand({}))),
  ])

  for (const u of users?.Users ?? []) if (u.UserName !== 'emulator') add({ id: `user:${u.UserName}`, kind: 'user', label: u.UserName! })
  for (const r of roles?.Roles ?? []) { add({ id: `role:${r.RoleName}`, kind: 'role', label: r.RoleName! }); arnToId.set(r.Arn!, `role:${r.RoleName}`) }
  for (const b of buckets?.Buckets ?? []) { add({ id: `bucket:${b.Name}`, kind: 'bucket', label: b.Name! }); arnToId.set(`arn:aws:s3:::${b.Name}`, `bucket:${b.Name}`) }
  await Promise.all((tables?.TableNames ?? []).map(async (t) => {
    const d = (await safe(c.ddb.send(new DescribeTableCommand({ TableName: t }))))?.Table
    add({ id: `table:${t}`, kind: 'table', label: t, status: d?.TableStatus, detail: d?.KeySchema?.map((k) => k.AttributeName).join('+') })
    if (d?.TableArn) arnToId.set(d.TableArn, `table:${t}`)
  }))
  await Promise.all((queues?.QueueUrls ?? []).map(async (u) => {
    const name = u.split('/').pop()!
    const a = (await safe(c.sqs.send(new GetQueueAttributesCommand({ QueueUrl: u, AttributeNames: ['QueueArn', 'ApproximateNumberOfMessages'] }))))?.Attributes
    add({ id: `queue:${name}`, kind: 'queue', label: name, detail: a?.ApproximateNumberOfMessages ? `${a.ApproximateNumberOfMessages} msg` : undefined })
    if (a?.QueueArn) arnToId.set(a.QueueArn, `queue:${name}`)
  }))
  for (const t of topics?.Topics ?? []) { const n = tail(t.TopicArn!); add({ id: `topic:${n}`, kind: 'topic', label: n }); arnToId.set(t.TopicArn!, `topic:${n}`) }
  for (const f of fns?.Functions ?? []) {
    add({ id: `fn:${f.FunctionName}`, kind: 'function', label: f.FunctionName!, status: f.State, detail: f.Runtime })
    arnToId.set(f.FunctionArn!, `fn:${f.FunctionName}`)
    if (f.Role && arnToId.has(f.Role)) edge(arnToId.get(f.Role)!, `fn:${f.FunctionName}`, 'runs as')
    else if (f.Role) edge(`role:${tail(f.Role)}`, `fn:${f.FunctionName}`, 'runs as')
  }
  for (const a of apis?.Items ?? []) {
    add({ id: `api:${a.ApiId}`, kind: 'api', label: a.Name!, detail: 'HTTP API' })
    const ints = (await safe(c.apigw.send(new GetIntegrationsCommand({ ApiId: a.ApiId }))))?.Items ?? []
    for (const i of ints) {
      const m = i.IntegrationUri?.match(/function:([\w-]+)/)
      if (m) edge(`api:${a.ApiId}`, `fn:${m[1]}`, 'invokes')
    }
  }
  // wiring from config
  for (const b of buckets?.Buckets ?? []) {
    const n = await safe(c.s3.send(new GetBucketNotificationConfigurationCommand({ Bucket: b.Name })))
    for (const q of n?.QueueConfigurations ?? []) if (q.QueueArn) edge(`bucket:${b.Name}`, arnToId.get(q.QueueArn) ?? `queue:${tail(q.QueueArn)}`, 'notifies')
    for (const l of n?.LambdaFunctionConfigurations ?? []) if (l.LambdaFunctionArn) edge(`bucket:${b.Name}`, `fn:${tail(l.LambdaFunctionArn)}`, 'notifies')
  }
  const subs = await safe(c.sns.send(new ListSubscriptionsCommand({})))
  for (const s of subs?.Subscriptions ?? []) if (s.Protocol === 'sqs' && s.TopicArn && s.Endpoint) edge(arnToId.get(s.TopicArn) ?? `topic:${tail(s.TopicArn)}`, arnToId.get(s.Endpoint) ?? `queue:${tail(s.Endpoint)}`, 'fans out')
  const esms = await safe(c.lambda.send(new ListEventSourceMappingsCommand({})))
  for (const e of esms?.EventSourceMappings ?? []) if (e.EventSourceArn && e.FunctionArn) edge(arnToId.get(e.EventSourceArn) ?? `queue:${tail(e.EventSourceArn)}`, `fn:${tail(e.FunctionArn)}`, e.State === 'Enabled' ? 'triggers' : `mapping ${e.State?.toLowerCase()}`)
  // role -> table/topic/queue edges from inline policy resources
  for (const r of roles?.Roles ?? []) {
    const names = (await safe(c.iam.send(new ListRolePoliciesCommand({ RoleName: r.RoleName }))))?.PolicyNames ?? []
    for (const pn of names) {
      const doc = (await safe(c.iam.send(new GetRolePolicyCommand({ RoleName: r.RoleName, PolicyName: pn }))))?.PolicyDocument
      if (!doc) continue
      try {
        const p = JSON.parse(decodeURIComponent(doc))
        for (const st of [].concat(p.Statement ?? []) as { Effect: string; Action: string | string[]; Resource: string | string[] }[]) {
          for (const res of [].concat(st.Resource as never) as string[]) {
            const to = arnToId.get(res)
            if (to && st.Effect === 'Allow') edge(`role:${r.RoleName}`, to, ([] as string[]).concat(st.Action).map((a) => a.split(':')[1]).join(','))
          }
        }
      } catch { /* ignore */ }
    }
  }
  // --- security ---
  const keyList = await safe(c.kms.send(new ListKeysCommand({})))
  const aliasList = await safe(c.kms.send(new ListAliasesCommand({})))
  for (const k of keyList?.Keys ?? []) {
    const m = (await safe(c.kms.send(new DescribeKeyCommand({ KeyId: k.KeyId }))))?.KeyMetadata
    if (m?.KeyManager !== 'CUSTOMER') continue
    const alias = aliasList?.Aliases?.find((a) => a.TargetKeyId === k.KeyId)?.AliasName
    add({ id: `key:${k.KeyId}`, kind: 'key', label: alias ?? k.KeyId!.slice(0, 8), status: m.KeyState, detail: m.Description || undefined })
  }
  const secretList = await safe(c.secrets.send(new ListSecretsCommand({})))
  for (const s of secretList?.SecretList ?? []) add({ id: `secret:${s.Name}`, kind: 'secret', label: s.Name!, detail: s.RotationEnabled ? 'rotation on' : undefined })
  // --- apigw ---
  const restApis = await safe(c.apigwRest.send(new GetRestApisCommand({})))
  for (const r of restApis?.items ?? []) add({ id: `api:${r.id}`, kind: 'api', label: r.name ?? r.id!, detail: 'REST API' })
  const pools = await safe(c.cognito.send(new ListUserPoolsCommand({ MaxResults: 20 })))
  for (const p of pools?.UserPools ?? []) add({ id: `pool:${p.Id}`, kind: 'pool', label: p.Name ?? p.Id!, detail: 'user pool' })
  // --- stepfunctions ---
  const machines = await safe(c.sfn.send(new ListStateMachinesCommand({})))
  for (const m of machines?.stateMachines ?? []) {
    add({ id: `sm:${m.name}`, kind: 'statemachine', label: m.name!, detail: m.type })
    const d = await safe(c.sfn.send(new DescribeStateMachineCommand({ stateMachineArn: m.stateMachineArn })))
    if (d?.roleArn) edge(`role:${tail(d.roleArn)}`, `sm:${m.name}`, 'runs as')
    const text = d?.definition ?? ''
    for (const f of text.matchAll(/"FunctionName"\s*:\s*"([\w-]+)"/g)) edge(`sm:${m.name}`, `fn:${f[1]}`, 'invokes')
    for (const t of text.matchAll(/"TableName"\s*:\s*"([\w.-]+)"/g)) edge(`sm:${m.name}`, `table:${t[1]}`, 'writes')
    for (const q of text.matchAll(/"QueueUrl"\s*:\s*"[^"]*\/([\w.-]+)"/g)) edge(`sm:${m.name}`, `queue:${q[1]}`, 'sends')
  }
  // --- eventbridge ---
  const buses = await safe(c.events.send(new ListEventBusesCommand({})))
  for (const b of buses?.EventBuses ?? []) {
    if (b.Name === 'default') continue
    add({ id: `bus:${b.Name}`, kind: 'bus', label: b.Name!, detail: 'event bus' })
    const rules = await safe(c.events.send(new ListRulesCommand({ EventBusName: b.Name })))
    for (const r of rules?.Rules ?? []) {
      const ts = await safe(c.events.send(new ListTargetsByRuleCommand({ EventBusName: b.Name, Rule: r.Name })))
      for (const t of ts?.Targets ?? []) if (t.Arn) edge(`bus:${b.Name}`, arnToId.get(t.Arn) ?? (t.Arn.includes(':stateMachine:') ? `sm:${tail(t.Arn)}` : `queue:${tail(t.Arn)}`), r.Name)
    }
  }
  // --- cloudwatch ---
  const { DescribeAlarmsCommand } = await import('@aws-sdk/client-cloudwatch')
  const alarms = await safe(c.cw.send(new DescribeAlarmsCommand({})))
  for (const a of alarms?.MetricAlarms ?? []) {
    add({ id: `alarm:${a.AlarmName}`, kind: 'alarm', label: a.AlarmName!, status: a.StateValue, detail: [a.Statistic, a.MetricName].filter(Boolean).join(' ') })
    for (const t of a.AlarmActions ?? []) edge(`alarm:${a.AlarmName}`, arnToId.get(t) ?? `topic:${tail(t)}`, 'notifies')
  }
  const ids = new Set(nodes.map((n) => n.id))
  return { nodes, edges: edges.filter((e) => ids.has(e.from) && ids.has(e.to)), at: Date.now() }
}
