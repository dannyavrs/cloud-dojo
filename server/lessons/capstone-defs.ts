import { arn } from '../lesson-kit'
import { policyDoc } from './kit2'

/** Names and constants shared by the capstone's starter files, "Show me" and checker. */
export const CAP = {
  table: 'Notes',
  api: 'snap-notes',
  pool: 'snap-users',
  client: 'snap-web',
  user: 'ana',
  password: 'Snap#Notes2026',
  edits: 'note-edits.fifo',
  dlq: 'note-edits-dlq.fifo',
  machine: 'note-moderation',
  topic: 'snap-alerts',
  inbox: 'snap-alerts-inbox',
  alarm: 'snap-api-errors',
  bucket: 'snap-photos',
  keyAlias: 'alias/snap-photos',
  fns: { api: 'snap-api', worker: 'snap-worker', moderator: 'snap-moderator' },
  roles: { api: 'snap-api-role', worker: 'snap-worker-role', moderator: 'snap-moderator-role', sfn: 'snap-sfn-role' },
} as const

export const machineArn = `arn:aws:states:us-east-1:000000000000:stateMachine:${CAP.machine}`
const logGroupArn = (fn: string) => `arn:aws:logs:us-east-1:000000000000:log-group:/aws/lambda/${fn}:*`

export const SFN_TRUST = JSON.stringify({
  Version: '2012-10-17',
  Statement: [{ Effect: 'Allow', Principal: { Service: 'states.amazonaws.com' }, Action: 'sts:AssumeRole' }],
}, null, 2)

export const apiPolicy = policyDoc([
  { Effect: 'Allow', Action: 'dynamodb:PutItem', Resource: arn.table(CAP.table) },
])
export const workerPolicy = policyDoc([
  { Effect: 'Allow', Action: 'dynamodb:UpdateItem', Resource: arn.table(CAP.table) },
  { Effect: 'Allow', Action: ['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:GetQueueAttributes'], Resource: arn.queue(CAP.edits) },
])
export const moderatorPolicy = policyDoc([
  { Effect: 'Allow', Action: ['logs:CreateLogStream', 'logs:PutLogEvents'], Resource: logGroupArn(CAP.fns.moderator) },
])
export const sfnPolicy = policyDoc([
  { Effect: 'Allow', Action: 'lambda:InvokeFunction', Resource: arn.fn(CAP.fns.moderator) },
])

/** What each role must be able to do (simulate-principal-policy), and what none of them may do. */
export const NEEDED: Record<'api' | 'worker' | 'moderator', { actions: string[]; resource: string }[]> = {
  api: [{ actions: ['dynamodb:PutItem'], resource: arn.table(CAP.table) }],
  worker: [
    { actions: ['dynamodb:UpdateItem'], resource: arn.table(CAP.table) },
    { actions: ['sqs:ReceiveMessage', 'sqs:DeleteMessage'], resource: arn.queue(CAP.edits) },
  ],
  moderator: [{ actions: ['logs:PutLogEvents'], resource: logGroupArn(CAP.fns.moderator) }],
}
export const DANGEROUS = ['dynamodb:DeleteTable', 'iam:CreateUser', 's3:DeleteBucket', 'kms:ScheduleKeyDeletion']

export const apiSource = `import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
const ddb = new DynamoDBClient({});
export const handler = async (event) => {
  let body = {};
  try { body = JSON.parse(event.body ?? "{}"); } catch {}
  // API Gateway puts the verified token claims here; "sub" is the user id
  const owner = event.requestContext?.authorizer?.jwt?.claims?.sub ?? "unknown";
  const id = "note#" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
  await ddb.send(new PutItemCommand({ TableName: "Notes", Item: { id: { S: id }, text: { S: String(body.text ?? "") }, owner: { S: String(owner) } } }));
  return { statusCode: 201, headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) };
};
`

export const workerSource = `import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
const ddb = new DynamoDBClient({});
// Applies an edit {"id": "...", "text": "..."} from the FIFO queue. A message that throws is retried,
// then moved to the dead-letter queue after maxReceiveCount receives.
export const handler = async (event) => {
  for (const rec of event.Records) {
    const edit = JSON.parse(rec.body);
    await ddb.send(new UpdateItemCommand({
      TableName: "Notes",
      Key: { id: { S: String(edit.id) } },
      UpdateExpression: "SET #t = :t, edited = :e",
      ConditionExpression: "attribute_exists(id)",
      ExpressionAttributeNames: { "#t": "text" },
      ExpressionAttributeValues: { ":t": { S: String(edit.text ?? "") }, ":e": { BOOL: true } },
    }));
  }
  return {};
};
`

export const moderatorSource = `// Input: {"id": "...", "text": "..."}. Needs no AWS calls, so its role only writes logs.
export const handler = async (event) => {
  const text = String(event.text ?? "");
  console.log("moderating", event.id);
  if (text.includes("POISON")) throw Object.assign(new Error("blocked content"), { name: "PoisonNote" });
  if (text.includes("TRANSIENT")) throw Object.assign(new Error("moderation backend busy"), { name: "Transient" });
  return { id: event.id, verdict: "clean" };
};
`

/** The finished workflow ("Show me"). */
export const moderationAsl = {
  Comment: 'Moderate a note: retry transient errors with backoff, flag everything else.',
  StartAt: 'Moderate',
  States: {
    Moderate: {
      Type: 'Task',
      Resource: 'arn:aws:states:::lambda:invoke',
      Parameters: { FunctionName: CAP.fns.moderator, 'Payload.$': '$' },
      OutputPath: '$.Payload',
      Retry: [{ ErrorEquals: ['Transient'], IntervalSeconds: 1, MaxAttempts: 2, BackoffRate: 2 }],
      Catch: [{ ErrorEquals: ['States.ALL'], ResultPath: '$.error', Next: 'FlagNote' }],
      Next: 'Approved',
    },
    Approved: { Type: 'Succeed' },
    FlagNote: { Type: 'Pass', Result: { flagged: true }, End: true },
  },
}

/** Starter for the learner: the happy path only. */
export const moderationStarter = JSON.stringify({
  Comment: 'Starter: add Retry (backoff) and Catch to Moderate, and a FlagNote state for the Catch to go to.',
  StartAt: 'Moderate',
  States: {
    Moderate: {
      Type: 'Task',
      Resource: 'arn:aws:states:::lambda:invoke',
      Parameters: { FunctionName: CAP.fns.moderator, 'Payload.$': '$' },
      OutputPath: '$.Payload',
      Next: 'Approved',
    },
    Approved: { Type: 'Succeed' },
  },
}, null, 2)

export const lifecycleRules = {
  Rules: [{ ID: 'expire-tmp', Status: 'Enabled', Filter: { Prefix: 'tmp/' }, Expiration: { Days: 1 } }],
}
