import { BatchWriteItemCommand, CreateTableCommand, DescribeTableCommand, DescribeTimeToLiveCommand, GetItemCommand, ScanCommand, type AttributeValue } from '@aws-sdk/client-dynamodb'
import { GetFunctionCommand, ListEventSourceMappingsCommand } from '@aws-sdk/client-lambda'
import { PutRolePolicyCommand } from '@aws-sdk/client-iam'
import { item, ok, ranFail, ranOk, type Ctx, type LessonServer } from '../lesson-kit'
import { createRole, createTable, logsContain, policyDoc, waitFor } from './kit2'

type Item = Record<string, AttributeValue>
const S = (v: string) => ({ S: v })
const N = (v: number | string) => ({ N: String(v) })
const putReq = (items: Item[]) => items.map((Item) => ({ PutRequest: { Item } }))
const describe = (ctx: Ctx, name: string) => ctx.c.ddb.send(new DescribeTableCommand({ TableName: name })).then((r) => r.Table).catch(() => undefined)
const count = async (ctx: Ctx, name: string) => (await ctx.c.ddb.send(new ScanCommand({ TableName: name, Select: 'COUNT' })).catch(() => undefined))?.Count ?? 0
const get = async (ctx: Ctx, name: string, key: Item) => (await ctx.c.ddb.send(new GetItemCommand({ TableName: name, Key: key, ConsistentRead: true })).catch(() => undefined))?.Item
const num = (s: string | undefined) => (s === undefined ? NaN : Number(s))
const keysOf = (t: { KeySchema?: { AttributeName?: string; KeyType?: string }[] } | undefined, hash: string, range?: string) =>
  Boolean(t?.KeySchema?.some((k) => k.AttributeName === hash && k.KeyType === 'HASH') && (!range || t.KeySchema.some((k) => k.AttributeName === range && k.KeyType === 'RANGE')))
const intOf = (s: string, re: RegExp) => { const m = s.match(re); return m ? Number(m[1]) : NaN }

/* ---------- 3.2 single-table design ---------- */
const shopItems: Item[] = [
  { PK: S('USER#u1'), SK: S('PROFILE'), name: S('Noa'), tier: S('pro') },
  { PK: S('USER#u1'), SK: S('ORDER#2026-11-01#o1'), status: S('shipped'), total: N(40) },
  { PK: S('USER#u1'), SK: S('ORDER#2026-11-05#o2'), status: S('open'), total: N(120) },
  { PK: S('USER#u1'), SK: S('ORDER#2026-11-09#o3'), status: S('open'), total: N(15) },
  { PK: S('USER#u2'), SK: S('PROFILE'), name: S('Sam'), tier: S('free') },
  { PK: S('USER#u2'), SK: S('ORDER#2026-11-02#o4'), status: S('open'), total: N(60) },
  { PK: S('PRODUCT#p1'), SK: S('META'), title: S('Mug'), price: N(12) },
  { PK: S('PRODUCT#p2'), SK: S('META'), title: S('Poster'), price: N(9) },
]

export const ddbSingleTable: LessonServer = {
  id: 'ddb-single-table',
  files: { 'seed.json': JSON.stringify({ Shop: putReq(shopItems) }, null, 2) },
  fixture: (ctx) => createTable(ctx, 'Shop', { pk: 'PK', sk: 'SK' }),
  async check(ctx) {
    const t = await describe(ctx, 'Shop')
    const h = ctx.history
    const n = t ? await count(ctx, 'Shop') : 0
    return [
      item('table', 'Table `Shop` is ACTIVE with PK (HASH) and SK (RANGE)', t?.TableStatus === 'ACTIVE' && keysOf(t, 'PK', 'SK'), 'The fixture creates it. Press Reset module if it is missing.'),
      item('seeded', 'The seed data is loaded (8 items)', n >= 8, 'Run the batch-write-item command from step 2.', `${n} item(s)`),
      item('orders', "You queried one user's orders with begins_with on the sort key", ranOk(h, /dynamodb query[\s\S]*begins_with/, (o) => (o.includes('#o1') && o.includes('#o3')) || /(^|\s)3\s*$/.test(o.trim()) || /"Count":\s*3/.test(o)), 'Run the begins_with query from step 3.'),
      item('collection', 'You read the whole item collection (profile and orders) in one query', h.some((r) => r.exitCode === 0 && /dynamodb query/.test(r.command) && !/begins_with/.test(r.command) && /USER#u1/.test(r.command) && ((r.stdout.includes('PROFILE') && r.stdout.includes('ORDER#')) || /"Count":\s*4/.test(r.stdout) || /^4\s*$/.test(r.stdout.trim()))), 'Run the query without a sort-key condition (step 4).'),
      item('newest', 'You fetched the newest order with --no-scan-index-forward and --limit 1', ranOk(h, /dynamodb query[\s\S]*--no-scan-index-forward[\s\S]*--limit 1\b|dynamodb query[\s\S]*--limit 1\b[\s\S]*--no-scan-index-forward/, (o) => o.includes('#o3') && !o.includes('#o1')), 'Run step 5 and look for o3.'),
      item('breakit', 'You saw the ValidationException on a non-key query', ranFail(h, /dynamodb query/, /ValidationException/), 'Run the break-it command.'),
    ]
  },
}

/* ---------- 3.3 indexes ---------- */
const TABLE_JSON = {
  TableName: 'Orders', BillingMode: 'PAY_PER_REQUEST',
  AttributeDefinitions: [
    { AttributeName: 'customerId', AttributeType: 'S' }, { AttributeName: 'orderTs', AttributeType: 'S' },
    { AttributeName: 'status', AttributeType: 'S' }, { AttributeName: 'amount', AttributeType: 'N' },
  ],
  KeySchema: [{ AttributeName: 'customerId', KeyType: 'HASH' }, { AttributeName: 'orderTs', KeyType: 'RANGE' }],
  GlobalSecondaryIndexes: [{ IndexName: 'ByStatus', KeySchema: [{ AttributeName: 'status', KeyType: 'HASH' }, { AttributeName: 'orderTs', KeyType: 'RANGE' }], Projection: { ProjectionType: 'ALL' } }],
}
const o = (c: string, ts: string, status: string, amount: number, priority?: string): Item => ({ customerId: S(c), orderTs: S(ts), status: S(status), amount: N(amount), ...(priority ? { priority: S(priority) } : {}) })
const orderItems: Item[] = [
  o('c1', '2026-11-01T10:00', 'shipped', 40), o('c1', '2026-11-03T09:30', 'open', 120, 'high'), o('c1', '2026-11-05T14:10', 'open', 15), o('c1', '2026-11-08T08:00', 'shipped', 75),
  o('c2', '2026-11-02T11:45', 'open', 60), o('c2', '2026-11-06T16:20', 'cancelled', 20),
  o('c3', '2026-11-04T13:00', 'shipped', 300, 'high'), o('c3', '2026-11-07T07:15', 'open', 55),
]

export const ddbIndexes: LessonServer = {
  id: 'ddb-indexes',
  files: { 'table.json': JSON.stringify(TABLE_JSON, null, 2), 'items.json': JSON.stringify({ Orders: putReq(orderItems) }, null, 2) },
  async check(ctx) {
    const t = await describe(ctx, 'Orders')
    const h = ctx.history
    const gsis = t?.GlobalSecondaryIndexes ?? []
    const late = gsis.find((g) => g.IndexName === 'ByPriority')
    const n = t ? await count(ctx, 'Orders') : 0
    return [
      item('table', 'Table `Orders` is ACTIVE with GSI `ByStatus` and LSI `ByAmount`', t?.TableStatus === 'ACTIVE' && gsis.some((g) => g.IndexName === 'ByStatus') && Boolean(t?.LocalSecondaryIndexes?.some((l) => l.IndexName === 'ByAmount')), 'Add the LSI block to table.json, then create the table. An LSI cannot be added later: delete-table and recreate if needed.'),
      item('items', 'The eight orders are loaded', n >= 8, 'Run batch-write-item with items.json.', `${n} item(s)`),
      item('gsi', 'You queried the GSI `ByStatus`', ranOk(h, /dynamodb query[\s\S]*--index-name\s+ByStatus/, () => true) && ranOk(h, /--index-name\s+ByStatus(?![\s\S]*--consistent-read)/), 'Run step 5 (--index-name ByStatus).'),
      item('lsi', 'You queried the LSI `ByAmount` for one customer', ranOk(h, /dynamodb query[\s\S]*--index-name\s+ByAmount/), 'Run step 6 (--index-name ByAmount).'),
      item('late', 'GSI `ByPriority` was added to the live table, is ACTIVE and you queried it', late?.IndexStatus === 'ACTIVE' && ranOk(h, /dynamodb query[\s\S]*--index-name\s+ByPriority/), 'Run the three commands in step 7.', late ? late.IndexStatus : 'not created'),
      item('breakit', 'You saw consistent reads refused on a GSI', ranFail(h, /dynamodb query[\s\S]*--consistent-read/, /Consistent reads are not supported on global secondary indexes/), 'Run the break-it command.'),
    ]
  },
}

/* ---------- 3.4 conditional writes ---------- */
export const ddbConditional: LessonServer = {
  id: 'ddb-conditional',
  async fixture(ctx) {
    await createTable(ctx, 'Profiles', { pk: 'pk' })
    await ctx.c.ddb.send(new BatchWriteItemCommand({ RequestItems: { Profiles: putReq([{ pk: S('u1'), name: S('Noa'), version: N(1), credits: N(10) }]) } }))
  },
  async check(ctx) {
    const p = await get(ctx, 'Profiles', { pk: S('u1') })
    const h = ctx.history
    const version = num(p?.version?.N)
    return [
      item('seed', 'Table `Profiles` has profile `u1`', Boolean(p), 'The fixture creates it. Press Reset module if it is missing.'),
      item('a', 'Client A updated the profile with a version check (version 2)', version >= 2 && ranOk(h, /update-item[\s\S]*--condition-expression/), 'Run step 2 with `:v` = 1.', `version ${p?.version?.N ?? '?'}`),
      item('breakit', 'You saw ConditionalCheckFailedException from the stale write', ranFail(h, /dynamodb update-item/, /ConditionalCheckFailedException/), 'Run the break-it command (step 3) after step 2.'),
      item('retry', 'Client B retried with the fresh version (version 3, name `Noa B`)', version >= 3 && p?.name?.S === 'Noa B', 'Re-read, then run step 4 with `:v` = 2.', `version ${p?.version?.N ?? '?'}, name ${p?.name?.S ?? '?'}`),
      item('counter', 'The atomic counter raised credits above 10', num(p?.credits?.N) >= 15 && ranOk(h, /update-expression\s+'?ADD\s/), 'Run the ADD command in step 5 at least once.', `credits ${p?.credits?.N ?? '?'}`),
    ]
  },
}

/* ---------- 3.5 transactions ---------- */
const TRANSFER = (x: number) => [
  { Update: { TableName: 'Bank', Key: { PK: S('ACCT#alice'), SK: S('BAL') }, UpdateExpression: 'SET bal = bal - :x', ConditionExpression: 'bal >= :x', ExpressionAttributeValues: { ':x': N(x) } } },
  { Update: { TableName: 'Bank', Key: { PK: S('ACCT#bob'), SK: S('BAL') }, UpdateExpression: 'SET bal = bal + :x', ExpressionAttributeValues: { ':x': N(x) } } },
]
export const ddbTransactions: LessonServer = {
  id: 'ddb-transactions',
  files: { 'transfer.json': JSON.stringify(TRANSFER(60), null, 2) },
  async fixture(ctx) {
    await createTable(ctx, 'Bank', { pk: 'PK', sk: 'SK' })
    await ctx.c.ddb.send(new BatchWriteItemCommand({ RequestItems: { Bank: putReq([{ PK: S('ACCT#alice'), SK: S('BAL'), bal: N(100) }, { PK: S('ACCT#bob'), SK: S('BAL'), bal: N(0) }]) } }))
  },
  async check(ctx) {
    const [a, b] = await Promise.all([get(ctx, 'Bank', { PK: S('ACCT#alice'), SK: S('BAL') }), get(ctx, 'Bank', { PK: S('ACCT#bob'), SK: S('BAL') })])
    const h = ctx.history
    const [alice, bob] = [num(a?.bal?.N), num(b?.bal?.N)]
    const tokens = new Map<string, number>()
    for (const r of h) {
      if (r.exitCode !== 0 || !/transact-write-items/.test(r.command)) continue
      const t = r.command.match(/--client-request-token\s+(\S+)/)?.[1]
      if (t) tokens.set(t, (tokens.get(t) ?? 0) + 1)
    }
    return [
      item('seed', 'Table `Bank` has both accounts', Boolean(a && b), 'The fixture creates it. Press Reset module if it is missing.'),
      item('applied', 'Balances are alice 30 and bob 70 (60 then 10, each applied once)', alice === 30 && bob === 70, 'Run the 60 transfer, then change the file to 10 and run it with a new token.', `alice ${a?.bal?.N ?? '?'}, bob ${b?.bal?.N ?? '?'}`),
      item('replay', 'You replayed a transfer with the same client request token', [...tokens.values()].some((n) => n >= 2), 'Run the same command and token twice (step 5).'),
      item('snapshot', 'You read the balances with transact-get-items', ranOk(h, /transact-get-items/), 'Run step 1 or the read in step 5.'),
      item('breakit', 'You saw TransactionCanceledException and the balances did not change', ranFail(h, /transact-write-items/, /TransactionCanceledException/) && alice + bob === 100, 'Set the amount to 60 again and run the break-it command.'),
    ]
  },
}

/* ---------- 3.6 streams, Lambda, TTL ---------- */
const STREAM_SRC = `export const handler = async (event) => {
  for (const r of event.Records) {
    console.log("STREAM", r.eventName, JSON.stringify(r.dynamodb.Keys), r.dynamodb.NewImage ? "new" : "-", r.dynamodb.OldImage ? "old" : "-");
  }
  return {};
};
`
export const ddbStreamsTtl: LessonServer = {
  id: 'ddb-streams-ttl',
  files: { 'stream.mjs': STREAM_SRC },
  zips: { 'stream.zip': { 'stream.mjs': STREAM_SRC } },
  async fixture(ctx) {
    await createRole(ctx, 'lambda-exec')
    await ctx.c.iam.send(new PutRolePolicyCommand({ RoleName: 'lambda-exec', PolicyName: 'stream-and-logs', PolicyDocument: policyDoc([{ Effect: 'Allow', Action: ['dynamodb:DescribeStream', 'dynamodb:GetRecords', 'dynamodb:GetShardIterator', 'dynamodb:ListStreams', 'logs:*'], Resource: '*' }]) }))
    await ctx.c.ddb.send(new CreateTableCommand({ TableName: 'Events', BillingMode: 'PAY_PER_REQUEST', AttributeDefinitions: [{ AttributeName: 'PK', AttributeType: 'S' }], KeySchema: [{ AttributeName: 'PK', KeyType: 'HASH' }], StreamSpecification: { StreamEnabled: true, StreamViewType: 'NEW_AND_OLD_IMAGES' } }))
    await waitFor(async () => (await describe(ctx, 'Events'))?.TableStatus === 'ACTIVE', 20000)
  },
  async check(ctx) {
    const h = ctx.history
    const fn = (await ctx.c.lambda.send(new GetFunctionCommand({ FunctionName: 'stream-logger' })).catch(() => undefined))?.Configuration
    const esms = (await ctx.c.lambda.send(new ListEventSourceMappingsCommand({ FunctionName: 'stream-logger' })).catch(() => undefined))?.EventSourceMappings ?? []
    const group = '/aws/lambda/stream-logger'
    const seen = async (t: string) => ok(() => logsContain(ctx, group, `STREAM ${t}`))
    const [ins, mod, rem] = await Promise.all([seen('INSERT'), seen('MODIFY'), seen('REMOVE')])
    const ttl = (await ctx.c.ddb.send(new DescribeTimeToLiveCommand({ TableName: 'Events' })).catch(() => undefined))?.TimeToLiveDescription
    const numItem = await get(ctx, 'Events', { PK: S('session#ttl-number') })
    const strItem = await get(ctx, 'Events', { PK: S('session#ttl-string') })
    const expired = !numItem && ranOk(h, /put-item[\s\S]*ttl-number/)
    return [
      item('fn', 'Function `stream-logger` is Active', fn?.State === 'Active', 'Run step 2.', fn?.State),
      item('esm', 'An event source mapping connects the `Events` stream to the function', esms.some((m) => /table\/Events\/stream/.test(m.EventSourceArn ?? '')), 'Run step 3 with the real stream ARN.'),
      item('cdc', 'The logs show INSERT, MODIFY and REMOVE', ins && mod && rem, 'Run the three writes (step 4), wait a few seconds and run Check again.', `INSERT ${ins ? 'yes' : 'no'}, MODIFY ${mod ? 'yes' : 'no'}, REMOVE ${rem ? 'yes' : 'no'}`),
      item('ttl', 'TTL is enabled on `expiresAt`', (ttl?.TimeToLiveStatus === 'ENABLED' || ttl?.TimeToLiveStatus === 'ENABLING') && ttl?.AttributeName === 'expiresAt', 'Run step 6.', ttl?.TimeToLiveStatus),
      item('expired', 'The item with a numeric expiry was deleted by TTL', expired, 'Write the two items in step 7 and wait about 20 seconds.'),
      item('breakit', 'The string-typed expiry item is still there', expired && Boolean(strItem), 'Write `session#ttl-string` in step 7 and wait for the numeric one to vanish.'),
    ]
  },
}

/* ---------- 3.7 query vs scan ---------- */
const catalog = (): Item[] => {
  const out: Item[] = []
  const add = (category: string, n: number, base: number) => { for (let i = 1; i <= n; i++) out.push({ category: S(category), sku: S(`${category.slice(0, 3).toUpperCase()}-${String(i).padStart(3, '0')}`), name: S(`${category === 'books' ? 'Book' : category === 'music' ? 'Album' : 'Game'} ${i}`), price: N(base + i), stock: N(i * 3) }) }
  add('books', 20, 8) // prices 9..28: 8 of them above 20
  add('music', 10, 10)
  add('games', 6, 30)
  return out
}
export const ddbQueryScan: LessonServer = {
  id: 'ddb-query-scan',
  async fixture(ctx) {
    await createTable(ctx, 'Catalog', { pk: 'category', sk: 'sku' })
    const all = catalog()
    for (let i = 0; i < all.length; i += 25) await ctx.c.ddb.send(new BatchWriteItemCommand({ RequestItems: { Catalog: putReq(all.slice(i, i + 25)) } }))
  },
  async check(ctx) {
    const h = ctx.history
    const n = await count(ctx, 'Catalog')
    const gap = (out: string) => { const c = intOf(out, /"Count":\s*(\d+)/); const s = intOf(out, /"ScannedCount":\s*(\d+)/); return s > c }
    const firstPage = ranOk(h, /dynamodb query[\s\S]*--limit\s+\d+/, (out) => /"LastEvaluatedKey":\s*\{/.test(out))
    const lastPage = ranOk(h, /--exclusive-start-key/, (out) => /"LastEvaluatedKey":\s*null/.test(out) || !/LastEvaluatedKey/.test(out))
    return [
      item('seed', 'Table `Catalog` holds the 36 seeded items', n >= 36, 'The fixture creates it. Press Reset module if it is missing.', `${n} item(s)`),
      item('filter', 'You saw a filter read more than it returned (ScannedCount above Count)', ranOk(h, /dynamodb query[\s\S]*--filter-expression/, gap), 'Run the filtered Query in step 2 with --select COUNT.'),
      item('scan', 'You ran a Scan that read the whole table (ScannedCount 36)', ranOk(h, /dynamodb scan/, (out) => intOf(out, /"ScannedCount":\s*(\d+)/) >= 36), 'Run step 3.'),
      item('pages', 'You paged a Query to the end with LastEvaluatedKey and --exclusive-start-key', firstPage && lastPage, 'Run step 4, copy the key into step 5.'),
      item('partiql', 'You ran a PartiQL statement', ranOk(h, /dynamodb execute-statement/), 'Run step 7.'),
      item('breakit', 'You hit the reserved-keyword error', ranFail(h, /dynamodb query/, /reserved keyword/i), 'Run the break-it command.'),
    ]
  },
}

export const DDB_SERVER_LESSONS: LessonServer[] = [ddbSingleTable, ddbIndexes, ddbConditional, ddbTransactions, ddbStreamsTtl, ddbQueryScan]
