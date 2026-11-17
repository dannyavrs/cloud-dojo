import { CreateBucketCommand, GetBucketVersioningCommand, HeadBucketCommand, ListObjectVersionsCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { GetCallerIdentityCommand } from '@aws-sdk/client-sts'
import { GetRoleCommand, GetUserCommand, GetUserPolicyCommand, ListAccessKeysCommand, SimulatePrincipalPolicyCommand } from '@aws-sdk/client-iam'
import { DescribeTableCommand, ScanCommand } from '@aws-sdk/client-dynamodb'
import { GetFunctionCommand, InvokeCommand } from '@aws-sdk/client-lambda'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { ACCOUNT, arn, historyHas, item, LAMBDA_TRUST, ok, type LessonServer } from '../lesson-kit'
import { createTable, hasWildcardAction, policyDoc, sources } from './kit2'

const decode = (s?: string) => (s ? JSON.parse(decodeURIComponent(s)) : undefined)

export const liftOff: LessonServer = {
  id: 'lift-off',
  async check(ctx) {
    const id = await ctx.c.sts.send(new GetCallerIdentityCommand({})).catch(() => undefined)
    const h = ctx.history
    return [
      item('reach', 'The emulator answers and you are account 000000000000', id?.Account === ACCOUNT, 'The emulator may still be booting: look at the lamp in the header.', id?.Arn),
      item('whoami', 'You ran `aws sts get-caller-identity` successfully', historyHas(h, /aws sts get-caller-identity/, 'command', 'ok') && h.some((r) => r.exitCode === 0 && /get-caller-identity/.test(r.command) && r.stdout.includes(ACCOUNT)), 'Run step 1 in the terminal.'),
      item('config', 'You ran `aws configure list`', historyHas(h, /aws configure list/, 'command', 'ok'), 'Run step 2 in the terminal.'),
      item('denied', 'You triggered a rejected sign-in on purpose', h.some((r) => /AWS_ACCESS_KEY_ID=EMULATOR/.test(r.command) && r.exitCode !== 0 && /AccessDenied|InvalidClientTokenId|SignatureDoesNotMatch|UnrecognizedClient/.test(r.stderr)), 'Run the break-it command (the one with the bogus key).'),
    ]
  },
}

export const iamIntern: LessonServer = {
  id: 'iam-intern',
  files: {
    'intern-read-only.json': policyDoc([{ Effect: 'Allow', Action: 's3:GetObject', Resource: 'arn:aws:s3:::snap-photos/*' }]),
  },
  async fixture(ctx) {
    await ctx.c.s3.send(new CreateBucketCommand({ Bucket: 'snap-photos' }))
    await ctx.c.s3.send(new PutObjectCommand({ Bucket: 'snap-photos', Key: 'hello.txt', Body: 'hello from the bucket\n' }))
  },
  async check(ctx) {
    const user = await ok(() => ctx.c.iam.send(new GetUserCommand({ UserName: 'intern' })))
    let pol: any
    try { pol = decode((await ctx.c.iam.send(new GetUserPolicyCommand({ UserName: 'intern', PolicyName: 'read-only-photos' }))).PolicyDocument) } catch { /* none */ }
    // any inline policy counts; try the name from the lesson first, simulate covers the rest
    const acts: string[] = pol ? [].concat(pol.Statement ?? []).flatMap((s: any) => [].concat(s.Effect === 'Allow' ? s.Action : [])) : []
    const narrow = user && acts.length > 0 && acts.every((a) => a === 's3:GetObject' || a === 's3:ListBucket')
    let sim: Record<string, string> = {}
    try {
      const r = await ctx.c.iam.send(new SimulatePrincipalPolicyCommand({ PolicySourceArn: `arn:aws:iam::${ACCOUNT}:user/intern`, ActionNames: ['s3:GetObject', 's3:DeleteObject'], ResourceArns: ['arn:aws:s3:::snap-photos/hello.txt'] }))
      sim = Object.fromEntries((r.EvaluationResults ?? []).map((e) => [e.EvalActionName!, e.EvalDecision!]))
    } catch { /* user missing */ }
    const keys = await ctx.c.iam.send(new ListAccessKeysCommand({ UserName: 'intern' })).catch(() => undefined)
    return [
      item('user', 'User `intern` exists', user, 'Run step 1.'),
      item('policy', 'Intern may GetObject and nothing wider (no wildcard actions)', Boolean(narrow), 'Attach the policy from step 2 with put-user-policy.'),
      item('sim', 'IAM says: GetObject allowed, DeleteObject denied', sim['s3:GetObject'] === 'allowed' && sim['s3:DeleteObject'] !== 'allowed' && Boolean(sim['s3:DeleteObject']), 'The policy must allow only s3:GetObject.', JSON.stringify(sim)),
      item('key', 'The intern has an access key', (keys?.AccessKeyMetadata?.length ?? 0) > 0, 'Run step 3.'),
      item('denied', 'You watched the intern get AccessDenied on delete', ctx.history.some((r) => /AWS_ACCESS_KEY_ID=EMULATOR/.test(r.command) && /delete-object/.test(r.command) && r.exitCode !== 0 && /AccessDenied/.test(r.stderr)), "Run the break-it command with the intern's keys in front."),
    ]
  },
}

export const s3Versioning: LessonServer = {
  id: 's3-versioning',
  files: { 'v1.txt': 'first draft\n', 'v2.txt': 'second draft, oops\n' },
  async check(ctx) {
    const exists = await ok(() => ctx.c.s3.send(new HeadBucketCommand({ Bucket: 'snap-photos' })))
    const ver = exists ? (await ctx.c.s3.send(new GetBucketVersioningCommand({ Bucket: 'snap-photos' }))).Status : undefined
    const versions = exists ? ((await ctx.c.s3.send(new ListObjectVersionsCommand({ Bucket: 'snap-photos', Prefix: 'note.txt' }))).Versions ?? []).filter((v) => v.Key === 'note.txt') : []
    let restored = ''
    try { restored = readFileSync(path.join(ctx.workdir, 'restored.txt'), 'utf8') } catch { /* not yet */ }
    return [
      item('bucket', 'Bucket `snap-photos` exists', exists, 'Run step 1.'),
      item('ver', 'Versioning is Enabled', ver === 'Enabled', 'Run step 2 before uploading.'),
      item('two', '`note.txt` has at least 2 versions', versions.length >= 2, 'Upload v1.txt then v2.txt to the same key after enabling versioning.', `${versions.length} version(s)`),
      item('restored', '`restored.txt` contains the first draft', restored.trim() === 'first draft', 'Use get-object with the older VersionId (IsLatest = False).'),
      item('badname', 'You triggered InvalidBucketName on purpose', ctx.history.some((r) => /create-bucket/.test(r.command) && r.exitCode !== 0 && /InvalidBucketName/.test(r.stderr)), 'Run the break-it command.'),
    ]
  },
}

export const dynamodbNotes: LessonServer = {
  id: 'dynamodb-notes',
  async check(ctx) {
    const t = (await ctx.c.ddb.send(new DescribeTableCommand({ TableName: 'Notes' })).catch(() => undefined))?.Table
    const ks = t?.KeySchema ?? []
    const keysOk = ks.some((k) => k.AttributeName === 'pk' && k.KeyType === 'HASH') && ks.some((k) => k.AttributeName === 'sk' && k.KeyType === 'RANGE')
    let count = 0
    let grouped = false
    if (t?.TableStatus === 'ACTIVE') {
      const items = (await ctx.c.ddb.send(new ScanCommand({ TableName: 'Notes' }))).Items ?? []
      count = items.length
      const by: Record<string, number> = {}
      for (const i of items) by[i.pk?.S ?? ''] = (by[i.pk?.S ?? ''] ?? 0) + 1
      grouped = Object.values(by).some((n) => n >= 2)
    }
    return [
      item('active', 'Table `Notes` is ACTIVE', t?.TableStatus === 'ACTIVE', 'Create it (step 1) and wait (step 2).', t?.TableStatus),
      item('keys', 'Key schema is pk (HASH) + sk (RANGE)', keysOk, 'Use both --key-schema entries from step 1.'),
      item('ondemand', 'Billing mode is on-demand (PAY_PER_REQUEST)', t?.BillingModeSummary?.BillingMode === 'PAY_PER_REQUEST', 'Add --billing-mode PAY_PER_REQUEST.'),
      item('items', 'At least 3 items, with 2 under the same pk', count >= 3 && grouped, 'Run the three put-item commands.', `${count} item(s)`),
      item('cond', 'You saw ConditionalCheckFailedException on purpose', ctx.history.some((r) => r.exitCode !== 0 && /ConditionalCheckFailedException/.test(r.stderr)), 'Run the break-it command.'),
    ]
  },
}

export const lambdaRoles: LessonServer = {
  id: 'lambda-roles',
  files: {
    'index.mjs': sources.hello,
    'writer.mjs': sources.writer,
    'trust.json': LAMBDA_TRUST,
    'writer-policy.json': policyDoc([{ Effect: 'Allow', Action: 'dynamodb:PutItem', Resource: arn.table('Notes') }]),
  },
  zips: { 'function.zip': { 'index.mjs': sources.hello }, 'writer.zip': { 'writer.mjs': sources.writer } },
  async fixture(ctx) { await createTable(ctx, 'Notes', { pk: 'pk', sk: 'sk' }) },
  async check(ctx, { probe }) {
    let trustOk = false
    try {
      const r = await ctx.c.iam.send(new GetRoleCommand({ RoleName: 'lambda-exec' }))
      trustOk = JSON.stringify(decode(r.Role?.AssumeRolePolicyDocument)).includes('lambda.amazonaws.com')
    } catch { /* no role */ }
    let cfg: { State?: string; Runtime?: string } | undefined
    try { cfg = (await ctx.c.lambda.send(new GetFunctionCommand({ FunctionName: 'hello' }))).Configuration } catch { /* none */ }
    const fnOk = cfg?.State === 'Active' && cfg?.Runtime === 'nodejs22.x'
    let probeRes: boolean | null = null
    let detail: string | undefined
    if (probe) {
      probeRes = false
      if (fnOk) {
        try {
          const r = await ctx.c.lambda.send(new InvokeCommand({ FunctionName: 'hello', Payload: Buffer.from(JSON.stringify({ name: 'Probe' })) }))
          const body = Buffer.from(r.Payload ?? []).toString()
          detail = body
          probeRes = body.includes('Hello, Probe!')
        } catch (e) { detail = String(e) }
      }
    }
    // role policy
    let scoped = false
    try {
      const { ListRolePoliciesCommand, GetRolePolicyCommand } = await import('@aws-sdk/client-iam')
      const names = (await ctx.c.iam.send(new ListRolePoliciesCommand({ RoleName: 'lambda-exec' }))).PolicyNames ?? []
      for (const n of names) {
        const doc = (await ctx.c.iam.send(new GetRolePolicyCommand({ RoleName: 'lambda-exec', PolicyName: n }))).PolicyDocument
        if (doc && !hasWildcardAction(doc) && doc.includes('dynamodb:PutItem')) scoped = true
      }
    } catch { /* none */ }
    const items = (await ctx.c.ddb.send(new ScanCommand({ TableName: 'Notes' })).catch(() => undefined))?.Items ?? []
    return [
      item('role', 'Role `lambda-exec` trusts lambda.amazonaws.com', trustOk, 'Run step 1.'),
      item('fn', 'Function `hello` is Active on nodejs22.x', fnOk, 'Steps 2 and 3.', cfg?.State),
      item('probe', 'Invoking `hello` returns the expected greeting', probeRes, 'Press Check after deploying `hello`.', detail),
      item('policy', 'Role has a scoped policy (PutItem on Notes, no wildcard action)', scoped, 'Run the fix step.'),
      item('written', 'The `writer` function wrote an item to Notes', items.some((i) => i.pk?.S === 'from-lambda'), 'Invoke writer after the policy is attached.'),
    ]
  },
}
