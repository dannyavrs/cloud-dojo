import { CreateBucketCommand, PutBucketEncryptionCommand, PutBucketLifecycleConfigurationCommand, PutPublicAccessBlockCommand } from '@aws-sdk/client-s3'
import { PutRolePolicyCommand } from '@aws-sdk/client-iam'
import { AddPermissionCommand, CreateEventSourceMappingCommand, CreateFunctionCommand, GetFunctionCommand } from '@aws-sdk/client-lambda'
import { CreateTopicCommand, SubscribeCommand } from '@aws-sdk/client-sns'
import { CreateQueueCommand, SetQueueAttributesCommand } from '@aws-sdk/client-sqs'
import { CreateApiCommand, CreateAuthorizerCommand, CreateIntegrationCommand, CreateRouteCommand, CreateStageCommand } from '@aws-sdk/client-apigatewayv2'
import { AdminCreateUserCommand, InitiateAuthCommand, AdminSetUserPasswordCommand, CreateUserPoolClientCommand, CreateUserPoolCommand, ListUserPoolClientsCommand, ListUserPoolsCommand } from '@aws-sdk/client-cognito-identity-provider'
import { CreateStateMachineCommand } from '@aws-sdk/client-sfn'
import { PutMetricAlarmCommand } from '@aws-sdk/client-cloudwatch'
import { CreateAliasCommand, CreateKeyCommand } from '@aws-sdk/client-kms'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { arn, LAMBDA_TRUST, type Ctx, type LessonServer } from '../lesson-kit'
import { createQueue, createRole, createTable, queueArn, sendPolicy, waitFor } from './kit2'
import { review } from './capstone-check'
import {
  apiPolicy, apiSource, CAP, lifecycleRules, moderationAsl, moderationStarter, moderatorPolicy, moderatorSource,
  sfnPolicy, SFN_TRUST, workerPolicy, workerSource,
} from './capstone-defs'

async function lambdaFn(ctx: Ctx, name: string, handler: string, zipName: string, role: string) {
  await ctx.c.lambda.send(new CreateFunctionCommand({
    FunctionName: name, Runtime: 'nodejs22.x', Handler: handler, Role: arn.role(role), MemorySize: 128, Timeout: 10,
    Code: { ZipFile: readFileSync(path.join(ctx.workdir, zipName)) },
  }))
  await waitFor(async () => (await ctx.c.lambda.send(new GetFunctionCommand({ FunctionName: name }))).Configuration?.State === 'Active', 20000)
}

const put = (ctx: Ctx, role: string, name: string, doc: string) => ctx.c.iam.send(new PutRolePolicyCommand({ RoleName: role, PolicyName: name, PolicyDocument: doc }))

/** The "Show me" solution: each step is one SDK-driven chunk with an explanation. */
export const solution: { title: string; explain: string; run(ctx: Ctx): Promise<void> }[] = [
  {
    title: 'Four roles, one per function plus Step Functions',
    explain: 'Each Lambda gets its own execution role with an inline policy naming exact actions and ARNs (no `*` actions): the API may only `PutItem`, the worker only `UpdateItem` plus its own queue, the moderator only writes logs. Step Functions gets its own role, trusted by `states.amazonaws.com`, allowed to invoke one function.',
    async run(ctx) {
      await createRole(ctx, CAP.roles.api, LAMBDA_TRUST); await put(ctx, CAP.roles.api, 'api', apiPolicy)
      await createRole(ctx, CAP.roles.worker, LAMBDA_TRUST); await put(ctx, CAP.roles.worker, 'worker', workerPolicy)
      await createRole(ctx, CAP.roles.moderator, LAMBDA_TRUST); await put(ctx, CAP.roles.moderator, 'moderator', moderatorPolicy)
      await createRole(ctx, CAP.roles.sfn, SFN_TRUST); await put(ctx, CAP.roles.sfn, 'sfn', sfnPolicy)
    },
  },
  {
    title: 'POST /notes behind a Cognito JWT authorizer',
    explain: 'An on-demand `Notes` table, the `snap-api` function, and an HTTP API with a Lambda proxy integration. The route `POST /notes` uses a JWT authorizer whose issuer is the user pool and whose audience is the app client, so API Gateway rejects a missing or invalid token with 401 before your function runs.',
    async run(ctx) {
      await createTable(ctx, CAP.table, { pk: 'id' })
      await lambdaFn(ctx, CAP.fns.api, 'api.handler', 'api.zip', CAP.roles.api)
      const pool = (await ctx.c.cognito.send(new ListUserPoolsCommand({ MaxResults: 60 }))).UserPools!.find((p) => p.Name === CAP.pool)!
      const client = (await ctx.c.cognito.send(new ListUserPoolClientsCommand({ UserPoolId: pool.Id!, MaxResults: 60 }))).UserPoolClients!.find((c) => c.ClientName === CAP.client)!
      // The emulator signs tokens with its own host as the issuer, so read `iss` from a real token (on AWS it is cognito-idp.<region>.amazonaws.com/<pool id>).
      const idToken = (await ctx.c.cognito.send(new InitiateAuthCommand({ ClientId: client.ClientId!, AuthFlow: 'USER_PASSWORD_AUTH', AuthParameters: { USERNAME: CAP.user, PASSWORD: CAP.password } }))).AuthenticationResult!.IdToken!
      const issuer = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString()).iss as string
      const api = await ctx.c.apigw.send(new CreateApiCommand({ Name: CAP.api, ProtocolType: 'HTTP' }))
      await ctx.c.lambda.send(new AddPermissionCommand({ FunctionName: CAP.fns.api, StatementId: 'apigw', Action: 'lambda:InvokeFunction', Principal: 'apigateway.amazonaws.com' }))
      const integ = await ctx.c.apigw.send(new CreateIntegrationCommand({ ApiId: api.ApiId!, IntegrationType: 'AWS_PROXY', IntegrationUri: arn.fn(CAP.fns.api), PayloadFormatVersion: '2.0' }))
      const auth = await ctx.c.apigw.send(new CreateAuthorizerCommand({
        ApiId: api.ApiId!, Name: 'cognito', AuthorizerType: 'JWT', IdentitySource: ['$request.header.Authorization'],
        JwtConfiguration: { Audience: [client.ClientId!], Issuer: issuer },
      }))
      await ctx.c.apigw.send(new CreateRouteCommand({ ApiId: api.ApiId!, RouteKey: 'POST /notes', Target: `integrations/${integ.IntegrationId}`, AuthorizationType: 'JWT', AuthorizerId: auth.AuthorizerId }))
      await ctx.c.apigw.send(new CreateStageCommand({ ApiId: api.ApiId!, StageName: '$default', AutoDeploy: true }))
    },
  },
  {
    title: 'Edits through a FIFO queue with a dead-letter queue',
    explain: 'Edits are asynchronous: the API stays fast and an edit goes onto `note-edits.fifo` (per-note ordering with the message group, deduplication, long polling). Messages that keep failing move to the FIFO dead-letter queue after 3 receives. `snap-worker` consumes the queue through an event source mapping and applies the edit.',
    async run(ctx) {
      const fifo = { FifoQueue: 'true', ContentBasedDeduplication: 'true' }
      await ctx.c.sqs.send(new CreateQueueCommand({ QueueName: CAP.dlq, Attributes: fifo }))
      await ctx.c.sqs.send(new CreateQueueCommand({
        QueueName: CAP.edits,
        Attributes: { ...fifo, ReceiveMessageWaitTimeSeconds: '20', VisibilityTimeout: '30', RedrivePolicy: JSON.stringify({ deadLetterTargetArn: arn.queue(CAP.dlq), maxReceiveCount: 3 }) },
      }))
      await lambdaFn(ctx, CAP.fns.worker, 'worker.handler', 'worker.zip', CAP.roles.worker)
      await ctx.c.lambda.send(new CreateEventSourceMappingCommand({ FunctionName: CAP.fns.worker, EventSourceArn: arn.queue(CAP.edits), BatchSize: 1 }))
    },
  },
  {
    title: 'Moderation workflow with Retry and Catch',
    explain: 'A Standard state machine invokes `snap-moderator`. `Transient` errors are retried with exponential backoff (1 s, then 2 s); anything else (and exhausted retries) is caught and routed to a `FlagNote` state instead of failing the whole execution.',
    async run(ctx) {
      await lambdaFn(ctx, CAP.fns.moderator, 'moderator.handler', 'moderator.zip', CAP.roles.moderator)
      await ctx.c.sfn.send(new CreateStateMachineCommand({ name: CAP.machine, type: 'STANDARD', roleArn: arn.role(CAP.roles.sfn), definition: JSON.stringify(moderationAsl) }))
    },
  },
  {
    title: 'Alarm to SNS to an inbox queue',
    explain: 'A CloudWatch alarm on the `Errors` metric of `snap-api` (namespace `AWS/Lambda`) notifies the `snap-alerts` topic, and an SQS inbox queue is subscribed. As in the fan-out lesson, the queue policy must allow SNS from this topic before subscribing, or delivery fails silently.',
    async run(ctx) {
      const topic = (await ctx.c.sns.send(new CreateTopicCommand({ Name: CAP.topic }))).TopicArn!
      const url = await createQueue(ctx, CAP.inbox)
      const qa = (await queueArn(ctx, url))!
      await ctx.c.sqs.send(new SetQueueAttributesCommand({ QueueUrl: url, Attributes: { Policy: sendPolicy('sns.amazonaws.com', qa, 'ArnEquals', topic) } }))
      await ctx.c.sns.send(new SubscribeCommand({ TopicArn: topic, Protocol: 'sqs', Endpoint: qa, Attributes: { RawMessageDelivery: 'false' } }))
      await ctx.c.cw.send(new PutMetricAlarmCommand({
        AlarmName: CAP.alarm, Namespace: 'AWS/Lambda', MetricName: 'Errors', Dimensions: [{ Name: 'FunctionName', Value: CAP.fns.api }],
        Statistic: 'Sum', Period: 60, EvaluationPeriods: 1, Threshold: 1, ComparisonOperator: 'GreaterThanOrEqualToThreshold', TreatMissingData: 'notBreaching', AlarmActions: [topic],
      }))
    },
  },
  {
    title: 'Photo bucket: SSE-KMS, Block Public Access, lifecycle',
    explain: 'A customer-managed KMS key with an alias becomes the bucket\'s default encryption. All four Block Public Access settings are on. A lifecycle rule expires scratch objects under `tmp/` after a day, so nothing is stored (and paid for) longer than needed.',
    async run(ctx) {
      const key = (await ctx.c.kms.send(new CreateKeyCommand({ Description: 'snap-photos bucket key' }))).KeyMetadata!.KeyId!
      await ctx.c.kms.send(new CreateAliasCommand({ AliasName: CAP.keyAlias, TargetKeyId: key }))
      await ctx.c.s3.send(new CreateBucketCommand({ Bucket: CAP.bucket }))
      await ctx.c.s3.send(new PutBucketEncryptionCommand({ Bucket: CAP.bucket, ServerSideEncryptionConfiguration: { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'aws:kms', KMSMasterKeyID: key }, BucketKeyEnabled: true }] } }))
      await ctx.c.s3.send(new PutPublicAccessBlockCommand({ Bucket: CAP.bucket, PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true } }))
      await ctx.c.s3.send(new PutBucketLifecycleConfigurationCommand({ Bucket: CAP.bucket, LifecycleConfiguration: { Rules: [{ ID: 'expire-tmp', Status: 'Enabled', Filter: { Prefix: 'tmp/' }, Expiration: { Days: 1 } }] } }))
    },
  },
]

export const capstone: LessonServer = {
  id: 'capstone',
  files: {
    'api.mjs': apiSource, 'worker.mjs': workerSource, 'moderator.mjs': moderatorSource,
    'lambda-trust.json': LAMBDA_TRUST, 'sfn-trust.json': SFN_TRUST,
    'api-policy.json': apiPolicy, 'worker-policy.json': workerPolicy, 'moderator-policy.json': moderatorPolicy, 'sfn-policy.json': sfnPolicy,
    'moderation.asl.json': moderationStarter,
    'lifecycle.json': JSON.stringify(lifecycleRules, null, 2),
  },
  zips: { 'api.zip': { 'api.mjs': apiSource }, 'worker.zip': { 'worker.mjs': workerSource }, 'moderator.zip': { 'moderator.mjs': moderatorSource } },
  async fixture(ctx) {
    // Identity is given: a user pool, an app client that allows password sign-in, and a confirmed user.
    const pool = await ctx.c.cognito.send(new CreateUserPoolCommand({ PoolName: CAP.pool }))
    await ctx.c.cognito.send(new CreateUserPoolClientCommand({ UserPoolId: pool.UserPool!.Id!, ClientName: CAP.client, ExplicitAuthFlows: ['ALLOW_USER_PASSWORD_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'] }))
    await ctx.c.cognito.send(new AdminCreateUserCommand({ UserPoolId: pool.UserPool!.Id!, Username: CAP.user, MessageAction: 'SUPPRESS' }))
    await ctx.c.cognito.send(new AdminSetUserPasswordCommand({ UserPoolId: pool.UserPool!.Id!, Username: CAP.user, Password: CAP.password, Permanent: true }))
  },
  async check(ctx, { probe }) {
    return review(ctx, probe)
  },
}
