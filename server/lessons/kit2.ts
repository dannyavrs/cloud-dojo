import { CreateFunctionCommand, GetFunctionCommand } from '@aws-sdk/client-lambda'
import { CreateRoleCommand } from '@aws-sdk/client-iam'
import { CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb'
import { CreateQueueCommand, GetQueueAttributesCommand } from '@aws-sdk/client-sqs'
import { FilterLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { arn, LAMBDA_TRUST, type Ctx } from '../lesson-kit'

export async function waitFor(fn: () => Promise<boolean>, ms = 15000, every = 500): Promise<boolean> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try { if (await fn()) return true } catch { /* keep polling */ }
    await Bun.sleep(every)
  }
  return false
}

export async function createRole(ctx: Ctx, name: string, trust = LAMBDA_TRUST) {
  await ctx.c.iam.send(new CreateRoleCommand({ RoleName: name, AssumeRolePolicyDocument: trust }))
}

export async function createTable(ctx: Ctx, name: string, keys: { pk: string; sk?: string }) {
  const defs = [{ AttributeName: keys.pk, AttributeType: 'S' as const }, ...(keys.sk ? [{ AttributeName: keys.sk, AttributeType: 'S' as const }] : [])]
  const schema = [{ AttributeName: keys.pk, KeyType: 'HASH' as const }, ...(keys.sk ? [{ AttributeName: keys.sk, KeyType: 'RANGE' as const }] : [])]
  await ctx.c.ddb.send(new CreateTableCommand({ TableName: name, AttributeDefinitions: defs, KeySchema: schema, BillingMode: 'PAY_PER_REQUEST' }))
  await waitFor(async () => (await ctx.c.ddb.send(new DescribeTableCommand({ TableName: name }))).Table?.TableStatus === 'ACTIVE', 20000)
}

export async function createFunction(ctx: Ctx, name: string, handler: string, zipName: string, role: string) {
  await ctx.c.lambda.send(new CreateFunctionCommand({
    FunctionName: name, Runtime: 'nodejs22.x', Handler: handler, Role: arn.role(role),
    Code: { ZipFile: readFileSync(path.join(ctx.workdir, zipName)) },
  }))
  await waitFor(async () => (await ctx.c.lambda.send(new GetFunctionCommand({ FunctionName: name }))).Configuration?.State === 'Active', 20000)
}

export async function createQueue(ctx: Ctx, name: string): Promise<string> {
  const q = await ctx.c.sqs.send(new CreateQueueCommand({ QueueName: name }))
  return q.QueueUrl!
}

export async function queueArn(ctx: Ctx, url: string) {
  return (await ctx.c.sqs.send(new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ['QueueArn'] }))).Attributes?.QueueArn
}

export async function logsContain(ctx: Ctx, group: string, needle: string): Promise<boolean> {
  const r = await ctx.c.logs.send(new FilterLogEventsCommand({ logGroupName: group }))
  return (r.events ?? []).some((e) => e.message?.includes(needle))
}

export const policyDoc = (statements: object[]) => JSON.stringify({ Version: '2012-10-17', Statement: statements }, null, 2)

export const sendPolicy = (service: string, queueArn: string, sourceKey: 'ArnEquals' | 'ArnLike', sourceArn: string) =>
  policyDoc([{ Effect: 'Allow', Principal: { Service: service }, Action: 'sqs:SendMessage', Resource: queueArn, Condition: { [sourceKey]: { 'aws:SourceArn': sourceArn } } }])

/** Does an SQS access-policy JSON string allow `service` to SendMessage from `source`? */
export function policyAllows(raw: string | undefined, service: string, source: string): boolean {
  if (!raw) return false
  try {
    const p = JSON.parse(raw)
    return [].concat(p.Statement ?? []).some((s: any) => {
      const svc = [].concat(s.Principal?.Service ?? [])
      const acts = [].concat(s.Action ?? [])
      const cond = JSON.stringify(s.Condition ?? {})
      return s.Effect === 'Allow' && svc.includes(service as never) && acts.some((a: string) => a === 'sqs:SendMessage' || a === 'sqs:*' || a === '*') && (cond === '{}' || cond.includes(source))
    })
  } catch { return false }
}

export function hasWildcardAction(doc: string | undefined): boolean {
  if (!doc) return false
  try {
    const p = JSON.parse(decodeURIComponent(doc))
    return [].concat(p.Statement ?? []).some((s: any) => s.Effect === 'Allow' && [].concat(s.Action ?? []).some((a: string) => a === '*' || a.endsWith(':*')))
  } catch { return false }
}

export const sources = {
  hello: `export const handler = async (event) => {
  console.log("hello invoked with", JSON.stringify(event));
  return { message: \`Hello, \${event.name ?? "world"}!\` };
};
`,
  writer: `import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
const ddb = new DynamoDBClient({});
export const handler = async (event) => {
  await ddb.send(new PutItemCommand({
    TableName: "Notes",
    Item: { pk: { S: "from-lambda" }, sk: { S: "note#001" }, text: { S: String(event.text ?? "hi") } },
  }));
  return { ok: true };
};
`,
  photoWorker: `export const handler = async (event) => {
  console.log("photo-worker got", event.Records.length, "record(s)", event.Records.map((r) => r.body).join(" | "));
  return {};
};
`,
  brokenApi: `export const handler = async () => {
  throw new Error("boom: this handler always fails");
};
`,
  helloApi: `export const handler = async (event) => ({
  statusCode: 200,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ message: "Hello from hello-api", path: event.rawPath ?? "/" }),
});
`,
  snapApi: `import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
const ddb = new DynamoDBClient({});
export const handler = async (event) => {
  let body = {};
  try { body = JSON.parse(event.body ?? "{}"); } catch {}
  const id = "note#" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
  await ddb.send(new PutItemCommand({ TableName: "Notes", Item: { id: { S: id }, text: { S: String(body.text ?? "") } } }));
  return { statusCode: 201, headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) };
};
`,
  snapWorker: `import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
const ddb = new DynamoDBClient({});
export const handler = async (event) => {
  for (const rec of event.Records) {
    const msg = JSON.parse(rec.body);
    for (const r of msg.Records ?? []) {
      const key = decodeURIComponent(r.s3.object.key.replace(/\\+/g, " "));
      await ddb.send(new PutItemCommand({ TableName: "Notes", Item: { id: { S: "photo#" + key }, size: { N: String(r.s3.object.size ?? 0) } } }));
    }
  }
  return {};
};
`,
}
