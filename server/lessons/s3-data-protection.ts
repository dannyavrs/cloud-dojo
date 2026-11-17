import { CreateAliasCommand, CreateKeyCommand, DescribeKeyCommand } from '@aws-sdk/client-kms'
import { CreateBucketCommand, DeletePublicAccessBlockCommand, GetBucketEncryptionCommand, GetObjectLockConfigurationCommand, GetPublicAccessBlockCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { item, ranFail, ranOk, type LessonServer } from '../lesson-kit'
import { policyDoc } from './kit2'

const VAULT = 'vault-lab'
const LOCKED = 'vault-locked'

export const s3DataProtection: LessonServer = {
  id: 's3-data-protection',
  files: {
    'secret.txt': 'launch codes: 0000\n',
    'encryption.json': JSON.stringify({ Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' }, BucketKeyEnabled: false }] }, null, 2),
    'public-policy.json': policyDoc([{ Sid: 'PublicRead', Effect: 'Allow', Principal: '*', Action: 's3:GetObject', Resource: `arn:aws:s3:::${VAULT}/*` }]),
  },
  async fixture(ctx) {
    const key = await ctx.c.kms.send(new CreateKeyCommand({ Description: 'vault-lab key' }))
    await ctx.c.kms.send(new CreateAliasCommand({ AliasName: 'alias/vault', TargetKeyId: key.KeyMetadata!.KeyId! }))
    await ctx.c.s3.send(new CreateBucketCommand({ Bucket: VAULT }))
    // new buckets start with all four blocks on (as on AWS since 2023); this one plays a bucket older than that
    await ctx.c.s3.send(new DeletePublicAccessBlockCommand({ Bucket: VAULT }))
  },
  async check(ctx) {
    const h = ctx.history
    const keyArn = (await ctx.c.kms.send(new DescribeKeyCommand({ KeyId: 'alias/vault' })).catch(() => undefined))?.KeyMetadata?.Arn
    const head = await ctx.c.s3.send(new HeadObjectCommand({ Bucket: VAULT, Key: 'secret.txt' })).catch(() => undefined)
    const sse = Boolean(keyArn) && head?.ServerSideEncryption === 'aws:kms' && head.SSEKMSKeyId === keyArn
    const enc = (await ctx.c.s3.send(new GetBucketEncryptionCommand({ Bucket: VAULT })).catch(() => undefined))?.ServerSideEncryptionConfiguration?.Rules?.[0]
    const def = enc?.ApplyServerSideEncryptionByDefault
    const defaultOk = def?.SSEAlgorithm === 'aws:kms' && Boolean(keyArn) && (def.KMSMasterKeyID === 'alias/vault' || def.KMSMasterKeyID === keyArn || keyArn!.endsWith(`/${def.KMSMasterKeyID}`)) && enc?.BucketKeyEnabled === true
    const bpaCfg = (await ctx.c.s3.send(new GetPublicAccessBlockCommand({ Bucket: VAULT })).catch(() => undefined))?.PublicAccessBlockConfiguration
    const bpa = Boolean(bpaCfg?.BlockPublicAcls && bpaCfg.IgnorePublicAcls && bpaCfg.BlockPublicPolicy && bpaCfg.RestrictPublicBuckets)
    const lock = (await ctx.c.s3.send(new GetObjectLockConfigurationCommand({ Bucket: LOCKED })).catch(() => undefined))?.ObjectLockConfiguration
    const dr = lock?.Rule?.DefaultRetention
    const lockOk = lock?.ObjectLockEnabled === 'Enabled' && dr?.Mode === 'GOVERNANCE' && Number(dr.Days ?? dr.Years ?? 0) >= 1
    return [
      item('sse', 'secret.txt is stored under the alias/vault key (SSE-KMS)', sse, 'Run put-object with --server-side-encryption aws:kms --ssekms-key-id alias/vault.', head ? `${head.ServerSideEncryption ?? 'none'} ${head.SSEKMSKeyId ?? ''}` : 'secret.txt not uploaded yet'),
      item('default', 'vault-lab defaults to SSE-KMS with alias/vault and a bucket key', defaultOk, 'Edit encryption.json (aws:kms, alias/vault, BucketKeyEnabled true), Save and apply it.', enc ? `default is ${def?.SSEAlgorithm}, bucket key ${enc.BucketKeyEnabled}` : undefined),
      item('bpa', 'All four Block Public Access switches are on for vault-lab', bpa, 'Run put-public-access-block with all four set to true.'),
      item('breakit', 'A public bucket policy was refused by Block Public Access', ranFail(h, /put-bucket-policy[\s\S]*vault-lab/, /AccessDenied[\s\S]*BlockPublicPolicy|BlockPublicPolicy/), 'Turn BPA on first, then apply public-policy.json.'),
      item('lock', 'vault-locked has Object Lock with a Governance default retention', lockOk, 'Create the bucket with --object-lock-enabled-for-bucket and set the default retention.'),
      item('denied', 'Deleting the locked version was refused', ranFail(h, /delete-object[\s\S]*vault-locked(?![\s\S]*--bypass-governance-retention)/, /object lock|AccessDenied/i), 'Run delete-object with --version-id and no bypass flag.'),
      item('bypass', 'The version was deleted with the Governance bypass', ranOk(h, /delete-object[\s\S]*vault-locked[\s\S]*--version-id[\s\S]*--bypass-governance-retention/), 'Repeat the delete with --bypass-governance-retention.'),
    ]
  },
}
