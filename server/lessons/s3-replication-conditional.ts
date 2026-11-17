import { CreateBucketCommand, GetBucketReplicationCommand, GetBucketVersioningCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { item, ranFail, ranOk, type LessonServer } from '../lesson-kit'
import { createRole, policyDoc, waitFor } from './kit2'

const SRC = 'orders-src'
const DST = 'orders-dst'
const ROLE = 'arn:aws:iam::000000000000:role/s3-repl-role'
const S3_TRUST = policyDoc([{ Effect: 'Allow', Principal: { Service: 's3.amazonaws.com' }, Action: 'sts:AssumeRole' }])

const rule = (dest: string) => ({
  Role: ROLE,
  Rules: [{ ID: 'orders-to-dst', Status: 'Enabled', Priority: 1, Filter: { Prefix: 'orders/' }, DeleteMarkerReplication: { Status: 'Disabled' }, Destination: { Bucket: `arn:aws:s3:::${dest}` } }],
})

const exists = async (ctx: Parameters<NonNullable<LessonServer['fixture']>>[0], bucket: string, key: string) =>
  Boolean(await ctx.c.s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key })).catch(() => undefined))

export const s3ReplicationConditional: LessonServer = {
  id: 's3-replication-conditional',
  files: {
    // the starter has a typo in the destination bucket name
    'replication.json': JSON.stringify(rule('orders-dest'), null, 2),
    'order.json': JSON.stringify({ order: 17, total: 42 }) + '\n',
    'order-v2.json': JSON.stringify({ order: 17, total: 45, note: 'amended' }) + '\n',
  },
  async fixture(ctx) {
    await ctx.c.s3.send(new CreateBucketCommand({ Bucket: SRC }))
    await ctx.c.s3.send(new CreateBucketCommand({ Bucket: DST }))
    await createRole(ctx, 's3-repl-role', S3_TRUST)
    // exists before any replication rule: it must never be replicated
    await ctx.c.s3.send(new PutObjectCommand({ Bucket: SRC, Key: 'orders/old.json', Body: '{"order":1}\n' }))
  },
  async check(ctx, { probe }) {
    const h = ctx.history
    const ver = async (b: string) => (await ctx.c.s3.send(new GetBucketVersioningCommand({ Bucket: b })).catch(() => undefined))?.Status === 'Enabled'
    const versioning = (await ver(SRC)) && (await ver(DST))
    const cfg = (await ctx.c.s3.send(new GetBucketReplicationCommand({ Bucket: SRC })).catch(() => undefined))?.ReplicationConfiguration
    const r = (cfg?.Rules ?? []).find((x) => x.Status === 'Enabled' && x.Destination?.Bucket === `arn:aws:s3:::${DST}`)
    const ruleOk = Boolean(r) && cfg?.Role === ROLE && (r!.Filter?.Prefix ?? r!.Prefix) === 'orders/'
    let replicates: boolean | null = null
    if (probe) {
      replicates = false
      if (ruleOk && versioning) {
        const tag = `chk-${Date.now()}`
        await ctx.c.s3.send(new PutObjectCommand({ Bucket: SRC, Key: `orders/${tag}.json`, Body: 'p' }))
        await ctx.c.s3.send(new PutObjectCommand({ Bucket: SRC, Key: `other/${tag}.json`, Body: 'p' }))
        const arrived = await waitFor(() => exists(ctx, DST, `orders/${tag}.json`), 12000, 400)
        replicates = arrived && !(await exists(ctx, DST, `other/${tag}.json`))
      }
    }
    const oldGone = !(await exists(ctx, DST, 'orders/old.json'))
    const created = await ctx.c.s3.send(new HeadObjectCommand({ Bucket: SRC, Key: 'orders/invoice-17.json' })).catch(() => undefined)
    return [
      item('versioning', 'Versioning is enabled on orders-src and orders-dst', versioning, 'Run put-bucket-versioning on both buckets.'),
      item('rule', 'orders-src replicates prefix orders/ to orders-dst with the replication role', ruleOk, 'Fix the destination ARN in replication.json, Save, then apply it.'),
      item('replicates', 'A new object under orders/ reaches orders-dst and one outside it does not', replicates, 'Press Check after the rule is applied.'),
      item('old', 'You saw that orders/old.json was not replicated (404)', oldGone && ranFail(h, /head-object[\s\S]*orders-dst[\s\S]*orders\/old\.json/, /404|Not Found/), 'Run head-object for orders/old.json on orders-dst.'),
      item('once', 'A create-only write (If-None-Match) succeeded the first time', Boolean(created) && ranOk(h, /put-object[\s\S]*invoice-17\.json[\s\S]*--if-none-match/), "Run the put-object with --if-none-match '*' for orders/invoice-17.json."),
      item('breakit', 'The same create-only write was refused with PreconditionFailed', ranFail(h, /put-object[\s\S]*--if-none-match/, /PreconditionFailed/), 'Run the same put-object a second time.'),
      item('ifmatch', 'An If-Match overwrite worked once and was refused with the stale ETag', ranOk(h, /put-object[\s\S]*--if-match/) && ranFail(h, /put-object[\s\S]*--if-match/, /PreconditionFailed/), 'Read the ETag, overwrite with --if-match, then repeat the same command.'),
    ]
  },
}
