import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { CreateKeyCommand, EncryptCommand } from '@aws-sdk/client-kms'
import { AssumeRoleCommand } from '@aws-sdk/client-sts'
import { DisableKeyCommand } from '@aws-sdk/client-kms'
import { PutBucketLifecycleConfigurationCommand } from '@aws-sdk/client-s3'
import { AddPermissionCommand, CreateFunctionCommand, GetFunctionCommand, InvokeCommand, PutFunctionEventInvokeConfigCommand } from '@aws-sdk/client-lambda'
import { CreateAccessKeyCommand, CreateRoleCommand, CreateUserCommand, CreatePolicyCommand, PutUserPermissionsBoundaryCommand, PutUserPolicyCommand, PutRolePolicyCommand, TagUserCommand } from '@aws-sdk/client-iam'
import { CreateBucketCommand, GetObjectCommand, PutBucketPolicyCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { CreateTableCommand, DescribeTableCommand, PutItemCommand, PutResourcePolicyCommand, QueryCommand, TransactWriteItemsCommand, GetItemCommand } from '@aws-sdk/client-dynamodb'
import { CreateQueueCommand, GetQueueAttributesCommand, ReceiveMessageCommand, SendMessageCommand, SetQueueAttributesCommand } from '@aws-sdk/client-sqs'
import { CreateTopicCommand, PublishCommand, SubscribeCommand } from '@aws-sdk/client-sns'
import type { Capability, CapabilityReport } from '../shared/types'
import { makeClients, type Clients } from './clients'
import type { EmuInfo } from './env'
import { ACCOUNT, LAMBDA_TRUST } from './lesson-kit'
import { policyDoc, sendPolicy, waitFor } from './lessons/kit2'
import { DATA_DIR, IMAGE } from './paths'
import { makeZip } from './zip'
import { M3_PROBES } from './probes-m3'

const FILE = path.join(DATA_DIR, 'capabilities.json')

export function loadCapabilities(image = IMAGE, file = FILE): CapabilityReport | null {
  try {
    if (!existsSync(file)) return null
    const r = JSON.parse(readFileSync(file, 'utf8')) as CapabilityReport
    return r.image === image ? r : null
  } catch { return null }
}

const denied = (e: unknown) => /AccessDenied|Unauthorized/i.test(String((e as { name?: string })?.name ?? '')) || (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 403
const sleep = (ms: number) => Bun.sleep(ms)

/** A user with an inline policy and their own SDK clients. */
async function userClients(root: Clients, emu: EmuInfo, name: string, statements: object[], tags?: Record<string, string>) {
  await root.iam.send(new CreateUserCommand({ UserName: name }))
  if (tags) await root.iam.send(new TagUserCommand({ UserName: name, Tags: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })) }))
  await root.iam.send(new PutUserPolicyCommand({ UserName: name, PolicyName: 'p', PolicyDocument: policyDoc(statements) }))
  const k = (await root.iam.send(new CreateAccessKeyCommand({ UserName: name }))).AccessKey!
  return { c: makeClients(emu, { accessKeyId: k.AccessKeyId!, secretAccessKey: k.SecretAccessKey! }), arn: `arn:aws:iam::${ACCOUNT}:user/${name}` }
}

export type Probe = { key: string; label: string; run: (root: Clients, emu: EmuInfo) => Promise<{ enforced: boolean; detail?: string }> }

const attr = (k: string, v: string) => ({ [k]: { S: v } })

export const PROBES: Probe[] = [
  ...M3_PROBES,
  { key: 's3-bucket-policy', label: 'S3 bucket policy Deny beats an identity Allow', async run(root, emu) {
    const u = await userClients(root, emu, 'probe-s3', [{ Effect: 'Allow', Action: 's3:*', Resource: '*' }])
    await root.s3.send(new CreateBucketCommand({ Bucket: 'probe-bp' }))
    await root.s3.send(new PutObjectCommand({ Bucket: 'probe-bp', Key: 'k', Body: 'x' }))
    await u.c.s3.send(new GetObjectCommand({ Bucket: 'probe-bp', Key: 'k' }))
    await root.s3.send(new PutBucketPolicyCommand({ Bucket: 'probe-bp', Policy: policyDoc([{ Effect: 'Deny', Principal: { AWS: u.arn }, Action: 's3:GetObject', Resource: 'arn:aws:s3:::probe-bp/*' }]) }))
    try { await u.c.s3.send(new GetObjectCommand({ Bucket: 'probe-bp', Key: 'k' })); return { enforced: false } } catch (e) { return { enforced: denied(e) } }
  } },
  { key: 'sqs-queue-policy', label: 'SQS queue policy Deny beats an identity Allow', async run(root, emu) {
    const u = await userClients(root, emu, 'probe-sqs', [{ Effect: 'Allow', Action: 'sqs:*', Resource: '*' }])
    const q = (await root.sqs.send(new CreateQueueCommand({ QueueName: 'probe-qp' }))).QueueUrl!
    await u.c.sqs.send(new SendMessageCommand({ QueueUrl: q, MessageBody: 'ok' }))
    await root.sqs.send(new SetQueueAttributesCommand({ QueueUrl: q, Attributes: { Policy: policyDoc([{ Effect: 'Deny', Principal: { AWS: u.arn }, Action: 'sqs:SendMessage', Resource: `arn:aws:sqs:us-east-1:${ACCOUNT}:probe-qp` }]) } }))
    try { await u.c.sqs.send(new SendMessageCommand({ QueueUrl: q, MessageBody: 'no' })); return { enforced: false } } catch (e) { return { enforced: denied(e) } }
  } },
  { key: 'lambda-resource-policy', label: 'Lambda resource policy grants a caller access', async run(root, emu) {
    await root.iam.send(new CreateRoleCommand({ RoleName: 'probe-exec', AssumeRolePolicyDocument: LAMBDA_TRUST }))
    const u = await userClients(root, emu, 'probe-lambda', [{ Effect: 'Allow', Action: 's3:ListAllMyBuckets', Resource: '*' }])
    const zip = makeZip({ 'i.mjs': 'export const handler = async () => ({ ok: true })' })
    await root.lambda.send(new CreateFunctionCommand({ FunctionName: 'probe-fn', Runtime: 'nodejs22.x', Handler: 'i.handler', Role: `arn:aws:iam::${ACCOUNT}:role/probe-exec`, Code: { ZipFile: zip } }))
    await waitFor(async () => (await root.lambda.send(new GetFunctionCommand({ FunctionName: 'probe-fn' }))).Configuration?.State === 'Active', 20000)
    try { await u.c.lambda.send(new InvokeCommand({ FunctionName: 'probe-fn' })); return { enforced: false, detail: 'an unauthorised caller could invoke' } } catch (e) { if (!denied(e)) return { enforced: false, detail: String(e) } }
    await root.lambda.send(new AddPermissionCommand({ FunctionName: 'probe-fn', StatementId: 's', Action: 'lambda:InvokeFunction', Principal: u.arn }))
    try { await u.c.lambda.send(new InvokeCommand({ FunctionName: 'probe-fn' })); return { enforced: true } } catch { return { enforced: false, detail: 'grant had no effect' } }
  } },
  { key: 'kms-key-policy', label: 'KMS key policy Deny beats an identity Allow', async run(root, emu) {
    const u = await userClients(root, emu, 'probe-kms', [{ Effect: 'Allow', Action: 'kms:*', Resource: '*' }])
    const key = (await root.kms.send(new CreateKeyCommand({ Policy: policyDoc([{ Effect: 'Allow', Principal: { AWS: `arn:aws:iam::${ACCOUNT}:root` }, Action: 'kms:*', Resource: '*' }, { Effect: 'Deny', Principal: { AWS: u.arn }, Action: 'kms:Encrypt', Resource: '*' }]) }))).KeyMetadata!.KeyId!
    try { await u.c.kms.send(new EncryptCommand({ KeyId: key, Plaintext: Buffer.from('x') })); return { enforced: false } } catch (e) { return { enforced: denied(e) } }
  } },
  { key: 'dynamodb-resource-policy', label: 'DynamoDB resource policy grants a caller access', async run(root, emu) {
    const u = await userClients(root, emu, 'probe-ddb', [{ Effect: 'Allow', Action: 's3:ListAllMyBuckets', Resource: '*' }])
    await root.ddb.send(new CreateTableCommand({ TableName: 'probe-rp', AttributeDefinitions: [{ AttributeName: 'k', AttributeType: 'S' }], KeySchema: [{ AttributeName: 'k', KeyType: 'HASH' }], BillingMode: 'PAY_PER_REQUEST' }))
    await waitFor(async () => (await root.ddb.send(new DescribeTableCommand({ TableName: 'probe-rp' }))).Table?.TableStatus === 'ACTIVE', 20000)
    const tableArn = `arn:aws:dynamodb:us-east-1:${ACCOUNT}:table/probe-rp`
    await root.ddb.send(new PutResourcePolicyCommand({ ResourceArn: tableArn, Policy: policyDoc([{ Effect: 'Allow', Principal: { AWS: u.arn }, Action: 'dynamodb:PutItem', Resource: tableArn }]) }))
    try { await u.c.ddb.send(new PutItemCommand({ TableName: 'probe-rp', Item: attr('k', 'x') })); return { enforced: true } } catch { return { enforced: false } }
  } },
  { key: 'permission-boundary', label: 'Permission boundary limits real calls', async run(root, emu) {
    const u = await userClients(root, emu, 'probe-pb', [{ Effect: 'Allow', Action: 's3:*', Resource: '*' }])
    const pol = await root.iam.send(new CreatePolicyCommand({ PolicyName: 'probe-boundary', PolicyDocument: policyDoc([{ Effect: 'Allow', Action: 's3:GetObject', Resource: '*' }]) }))
    await root.iam.send(new PutUserPermissionsBoundaryCommand({ UserName: 'probe-pb', PermissionsBoundary: pol.Policy!.Arn! }))
    await root.s3.send(new CreateBucketCommand({ Bucket: 'probe-pb' }))
    try { await u.c.s3.send(new PutObjectCommand({ Bucket: 'probe-pb', Key: 'k', Body: 'x' })); return { enforced: false, detail: 'PutObject succeeded although the boundary only allows GetObject' } } catch (e) { return { enforced: denied(e) } }
  } },
  { key: 'abac-principal-tag', label: 'aws:PrincipalTag conditions match', async run(root, emu) {
    const u = await userClients(root, emu, 'probe-abac', [{ Effect: 'Allow', Action: 's3:GetObject', Resource: '*', Condition: { StringEquals: { 'aws:PrincipalTag/team': 'a' } } }], { team: 'a' })
    await root.s3.send(new CreateBucketCommand({ Bucket: 'probe-abac' }))
    await root.s3.send(new PutObjectCommand({ Bucket: 'probe-abac', Key: 'k', Body: 'x' }))
    try { await u.c.s3.send(new GetObjectCommand({ Bucket: 'probe-abac', Key: 'k' })); return { enforced: true } } catch { return { enforced: false, detail: 'a matching tag was still denied' } }
  } },
  { key: 'iam-session-policy', label: 'A session policy on AssumeRole narrows the session', async run(root, emu) {
    await root.s3.send(new CreateBucketCommand({ Bucket: 'probe-sp' }))
    await root.s3.send(new PutObjectCommand({ Bucket: 'probe-sp', Key: 'k', Body: 'x' }))
    const u = await userClients(root, emu, 'probe-sp', [{ Effect: 'Allow', Action: 'sts:AssumeRole', Resource: '*' }])
    await root.iam.send(new CreateRoleCommand({ RoleName: 'probe-sp-role', AssumeRolePolicyDocument: policyDoc([{ Effect: 'Allow', Principal: { AWS: u.arn }, Action: 'sts:AssumeRole' }]) }))
    await root.iam.send(new PutRolePolicyCommand({ RoleName: 'probe-sp-role', PolicyName: 'p', PolicyDocument: policyDoc([{ Effect: 'Allow', Action: 's3:*', Resource: '*' }]) }))
    const out = await u.c.sts.send(new AssumeRoleCommand({ RoleArn: `arn:aws:iam::${ACCOUNT}:role/probe-sp-role`, RoleSessionName: 'probe-session', Policy: policyDoc([{ Effect: 'Allow', Action: 's3:ListBucket', Resource: '*' }]) }))
    const c = out.Credentials!
    const sess = makeClients(emu, { accessKeyId: c.AccessKeyId!, secretAccessKey: c.SecretAccessKey!, sessionToken: c.SessionToken })
    await sleep(500)
    try { await sess.s3.send(new GetObjectCommand({ Bucket: 'probe-sp', Key: 'k' })); return { enforced: false, detail: 'GetObject succeeded although the session policy only allows ListBucket' } } catch (e) { return { enforced: denied(e) } }
  } },
  { key: 'iam-policy-variable', label: '${aws:username} policy variables resolve', async run(root, emu) {
    await root.s3.send(new CreateBucketCommand({ Bucket: 'probe-pv' }))
    await root.s3.send(new PutObjectCommand({ Bucket: 'probe-pv', Key: 'probe-pv-user/a', Body: 'x' }))
    await root.s3.send(new PutObjectCommand({ Bucket: 'probe-pv', Key: 'other/a', Body: 'x' }))
    const u = await userClients(root, emu, 'probe-pv-user', [{ Effect: 'Allow', Action: 's3:GetObject', Resource: 'arn:aws:s3:::probe-pv/${aws:username}/*' }])
    let own = true
    try { await u.c.s3.send(new GetObjectCommand({ Bucket: 'probe-pv', Key: 'probe-pv-user/a' })) } catch { own = false }
    let other = false
    try { await u.c.s3.send(new GetObjectCommand({ Bucket: 'probe-pv', Key: 'other/a' })); other = true } catch { /* denied, as it should be */ }
    return { enforced: own && !other, detail: own ? undefined : 'the policy variable did not match the caller\'s own prefix' }
  } },
  { key: 'iam-source-ip', label: 'aws:SourceIp conditions are evaluated', async run(root, emu) {
    await root.s3.send(new CreateBucketCommand({ Bucket: 'probe-ip' }))
    await root.s3.send(new PutObjectCommand({ Bucket: 'probe-ip', Key: 'k', Body: 'x' }))
    const any = await userClients(root, emu, 'probe-ip-any', [{ Effect: 'Allow', Action: 's3:GetObject', Resource: '*', Condition: { IpAddress: { 'aws:SourceIp': '0.0.0.0/0' } } }])
    const none = await userClients(root, emu, 'probe-ip-none', [{ Effect: 'Allow', Action: 's3:GetObject', Resource: '*', Condition: { IpAddress: { 'aws:SourceIp': '10.9.9.9/32' } } }])
    let a = true
    try { await any.c.s3.send(new GetObjectCommand({ Bucket: 'probe-ip', Key: 'k' })) } catch { a = false }
    let n = false
    try { await none.c.s3.send(new GetObjectCommand({ Bucket: 'probe-ip', Key: 'k' })); n = true } catch { /* denied */ }
    return { enforced: a && !n, detail: a ? undefined : 'a 0.0.0.0/0 allow did not match: the key is missing from the request context' }
  } },
  { key: 's3-lifecycle-validation', label: 'S3 rejects a lifecycle rule that moves to STANDARD_IA before 30 days', async run(root) {
    await root.s3.send(new CreateBucketCommand({ Bucket: 'probe-lc' }))
    try {
      await root.s3.send(new PutBucketLifecycleConfigurationCommand({ Bucket: 'probe-lc', LifecycleConfiguration: { Rules: [{ ID: 'bad', Status: 'Enabled', Filter: {}, Transitions: [{ Days: 10, StorageClass: 'STANDARD_IA' }] }] } }))
      return { enforced: false, detail: 'a 10-day transition to STANDARD_IA was accepted (AWS rejects it)' }
    } catch { return { enforced: true } }
  } },
  { key: 's3-kms-disabled-key', label: 'A disabled KMS key blocks reads of SSE-KMS objects', async run(root) {
    const key = (await root.kms.send(new CreateKeyCommand({}))).KeyMetadata!.KeyId!
    await root.s3.send(new CreateBucketCommand({ Bucket: 'probe-kd' }))
    await root.s3.send(new PutObjectCommand({ Bucket: 'probe-kd', Key: 'k', Body: 'x', ServerSideEncryption: 'aws:kms', SSEKMSKeyId: key }))
    await root.kms.send(new DisableKeyCommand({ KeyId: key }))
    try { await root.s3.send(new GetObjectCommand({ Bucket: 'probe-kd', Key: 'k' })); return { enforced: false, detail: 'the object was still readable with its key disabled' } } catch { return { enforced: true } }
  } },
  { key: 'lambda-async-destination', label: 'Lambda delivers failed async invocations to an OnFailure destination', async run(root) {
    await root.iam.send(new CreateRoleCommand({ RoleName: 'probe-async-exec', AssumeRolePolicyDocument: LAMBDA_TRUST }))
    const q = (await root.sqs.send(new CreateQueueCommand({ QueueName: 'probe-async-fail' }))).QueueUrl!
    await root.iam.send(new PutRolePolicyCommand({ RoleName: 'probe-async-exec', PolicyName: 'send', PolicyDocument: policyDoc([{ Effect: 'Allow', Action: 'sqs:SendMessage', Resource: '*' }]) }))
    const zip = makeZip({ 'f.mjs': 'export const handler = async () => { throw new Error("probe boom") }' })
    await root.lambda.send(new CreateFunctionCommand({ FunctionName: 'probe-async', Runtime: 'nodejs22.x', Handler: 'f.handler', Role: `arn:aws:iam::${ACCOUNT}:role/probe-async-exec`, Code: { ZipFile: zip } }))
    await waitFor(async () => (await root.lambda.send(new GetFunctionCommand({ FunctionName: 'probe-async' }))).Configuration?.State === 'Active', 20000)
    await root.lambda.send(new PutFunctionEventInvokeConfigCommand({ FunctionName: 'probe-async', MaximumRetryAttempts: 0, DestinationConfig: { OnFailure: { Destination: `arn:aws:sqs:us-east-1:${ACCOUNT}:probe-async-fail` } } }))
    await root.lambda.send(new InvokeCommand({ FunctionName: 'probe-async', InvocationType: 'Event', Payload: Buffer.from('{}') }))
    const got = await waitFor(async () => ((await root.sqs.send(new ReceiveMessageCommand({ QueueUrl: q, WaitTimeSeconds: 1 }))).Messages ?? []).length > 0, 12000, 500)
    return { enforced: got, detail: got ? undefined : 'the destination config was accepted but nothing was delivered' }
  } },
  { key: 'ddb-gsi-eventual-only', label: 'DynamoDB rejects consistent reads on a GSI', async run(root) {
    await root.ddb.send(new CreateTableCommand({ TableName: 'probe-gsi', BillingMode: 'PAY_PER_REQUEST', AttributeDefinitions: [{ AttributeName: 'k', AttributeType: 'S' }, { AttributeName: 'g', AttributeType: 'S' }], KeySchema: [{ AttributeName: 'k', KeyType: 'HASH' }], GlobalSecondaryIndexes: [{ IndexName: 'ByG', KeySchema: [{ AttributeName: 'g', KeyType: 'HASH' }], Projection: { ProjectionType: 'ALL' } }] }))
    await waitFor(async () => (await root.ddb.send(new DescribeTableCommand({ TableName: 'probe-gsi' }))).Table?.TableStatus === 'ACTIVE', 20000)
    try { await root.ddb.send(new QueryCommand({ TableName: 'probe-gsi', IndexName: 'ByG', ConsistentRead: true, KeyConditionExpression: 'g = :g', ExpressionAttributeValues: { ':g': { S: 'x' } } })); return { enforced: false } } catch (e) { return { enforced: (e as { name?: string }).name === 'ValidationException' } }
  } },
  { key: 'ddb-transaction-atomic', label: 'DynamoDB transactions are all-or-nothing', async run(root) {
    await root.ddb.send(new CreateTableCommand({ TableName: 'probe-tx', BillingMode: 'PAY_PER_REQUEST', AttributeDefinitions: [{ AttributeName: 'k', AttributeType: 'S' }], KeySchema: [{ AttributeName: 'k', KeyType: 'HASH' }] }))
    await waitFor(async () => (await root.ddb.send(new DescribeTableCommand({ TableName: 'probe-tx' }))).Table?.TableStatus === 'ACTIVE', 20000)
    await root.ddb.send(new PutItemCommand({ TableName: 'probe-tx', Item: { ...attr('k', 'a'), bal: { N: '10' } } }))
    try {
      await root.ddb.send(new TransactWriteItemsCommand({ TransactItems: [
        { Update: { TableName: 'probe-tx', Key: attr('k', 'a'), UpdateExpression: 'SET bal = bal - :x', ConditionExpression: 'bal >= :x', ExpressionAttributeValues: { ':x': { N: '50' } } } },
        { Put: { TableName: 'probe-tx', Item: attr('k', 'b') } },
      ] }))
      return { enforced: false }
    } catch (e) {
      const b = await root.ddb.send(new GetItemCommand({ TableName: 'probe-tx', Key: attr('k', 'b') }))
      return { enforced: (e as { name?: string }).name === 'TransactionCanceledException' && !b.Item }
    }
  } },
  { key: 'sqs-fifo-dedup', label: 'SQS FIFO drops duplicate deduplication ids', async run(root) {
    const q = (await root.sqs.send(new CreateQueueCommand({ QueueName: 'probe.fifo', Attributes: { FifoQueue: 'true' } }))).QueueUrl!
    for (let i = 0; i < 2; i++) await root.sqs.send(new SendMessageCommand({ QueueUrl: q, MessageBody: 'm', MessageGroupId: 'g', MessageDeduplicationId: 'd' }))
    const r = await root.sqs.send(new ReceiveMessageCommand({ QueueUrl: q, MaxNumberOfMessages: 10, WaitTimeSeconds: 1 }))
    return { enforced: (r.Messages ?? []).length === 1 }
  } },
  { key: 'sqs-dlq-redrive', label: 'SQS moves a message to the DLQ after maxReceiveCount', async run(root) {
    const dlq = (await root.sqs.send(new CreateQueueCommand({ QueueName: 'probe-dlq' }))).QueueUrl!
    const q = (await root.sqs.send(new CreateQueueCommand({ QueueName: 'probe-src', Attributes: { VisibilityTimeout: '1', RedrivePolicy: JSON.stringify({ deadLetterTargetArn: `arn:aws:sqs:us-east-1:${ACCOUNT}:probe-dlq`, maxReceiveCount: '1' }) } }))).QueueUrl!
    await root.sqs.send(new SendMessageCommand({ QueueUrl: q, MessageBody: 'poison' }))
    for (let i = 0; i < 3; i++) { await root.sqs.send(new ReceiveMessageCommand({ QueueUrl: q, WaitTimeSeconds: 2 })); await sleep(300) }
    const ok = await waitFor(async () => Number((await root.sqs.send(new GetQueueAttributesCommand({ QueueUrl: dlq, AttributeNames: ['ApproximateNumberOfMessages'] }))).Attributes?.ApproximateNumberOfMessages) >= 1, 6000, 300)
    return { enforced: ok }
  } },
  { key: 'sns-filter-policy', label: 'SNS filter policies drop non-matching messages', async run(root) {
    const topic = (await root.sns.send(new CreateTopicCommand({ Name: 'probe-topic' }))).TopicArn!
    const q = (await root.sqs.send(new CreateQueueCommand({ QueueName: 'probe-sub' }))).QueueUrl!
    const qa = `arn:aws:sqs:us-east-1:${ACCOUNT}:probe-sub`
    await root.sqs.send(new SetQueueAttributesCommand({ QueueUrl: q, Attributes: { Policy: sendPolicy('sns.amazonaws.com', qa, 'ArnEquals', topic) } }))
    await root.sns.send(new SubscribeCommand({ TopicArn: topic, Protocol: 'sqs', Endpoint: qa, Attributes: { RawMessageDelivery: 'true', FilterPolicy: JSON.stringify({ t: ['yes'] }) } }))
    const attrs = (v: string) => ({ t: { DataType: 'String', StringValue: v } })
    await root.sns.send(new PublishCommand({ TopicArn: topic, Message: 'no', MessageAttributes: attrs('no') }))
    await root.sns.send(new PublishCommand({ TopicArn: topic, Message: 'yes', MessageAttributes: attrs('yes') }))
    await sleep(1500)
    const bodies: string[] = []
    await waitFor(async () => { const r = await root.sqs.send(new ReceiveMessageCommand({ QueueUrl: q, MaxNumberOfMessages: 10, WaitTimeSeconds: 1 })); bodies.push(...(r.Messages ?? []).map((m) => m.Body ?? '')); return bodies.length > 0 }, 5000, 200)
    return { enforced: bodies.includes('yes') && !bodies.includes('no') }
  } },
]

export async function runProbe(root: Clients, emu: EmuInfo, image = IMAGE, file = FILE): Promise<CapabilityReport> {
  const capabilities: Capability[] = await Promise.all(PROBES.map(async (p) => {
    try { return { key: p.key, label: p.label, ...(await p.run(root, emu)) } } catch (e) { return { key: p.key, label: p.label, enforced: false, detail: `probe error: ${(e as Error).name ?? 'error'}: ${String((e as Error).message ?? '').slice(0, 120)}` } }
  }))
  const report: CapabilityReport = { image, at: Date.now(), capabilities }
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(report, null, 2))
  return report
}
