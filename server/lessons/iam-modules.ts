import { GetBucketPolicyCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { GetRoleCommand, GetUserCommand, ListUserTagsCommand } from '@aws-sdk/client-iam'
import { ListTagsOfResourceCommand } from '@aws-sdk/client-dynamodb'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { arn, item, type Ctx, type LessonServer } from '../lesson-kit'
import { createRole, createTable, policyDoc } from './kit2'
import {
  BUCKET, decode, denied, hasAnyPolicy, inlinePolicies, keyIds, lastIdx, list, makeBucket, makeUsers, ok, ranAsSession, ranAsUser,
  roleArn, simulate, statements, userArn,
} from './iam-kit'

const OBJ = `arn:aws:s3:::${BUCKET}/h.txt`
const BUCKET_ARN = `arn:aws:s3:::${BUCKET}`
const anyDoc = (pols: Record<string, any>, f: (s: any) => boolean) => Object.values(pols).some((d) => statements(d).some(f))
const allows = (s: any, action: string) => s.Effect === 'Allow' && list(s.Action).some((a) => a === action || a === '*' || a === action.split(':')[0] + ':*')

/* ---------- 1.2 policy evaluation ---------- */
export const iamEvaluation: LessonServer = {
  id: 'iam-evaluation',
  files: {
    'allow-s3.json': policyDoc([{ Effect: 'Allow', Action: 's3:*', Resource: '*' }]),
    'deny-delete.json': policyDoc([{ Effect: 'Deny', Action: 's3:DeleteObject', Resource: '*' }]),
  },
  async fixture(ctx) {
    await makeBucket(ctx, { 'h.txt': 'hello from iam-lab\n', 'scratch.txt': 'disposable\n' })
    await makeUsers(ctx, 'dev')
  },
  async check(ctx) {
    const pols = await inlinePolicies(ctx, 'dev')
    const keys = await keyIds(ctx, 'dev')
    const rs = await ranAsUser(ctx, 'dev')
    const sim = await simulate(ctx, userArn('dev'), ['s3:GetObject', 's3:DeleteObject'], [OBJ])
    const hStays = await ctx.c.s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: 'h.txt' })).then(() => true, () => false)
    return [
      item('allow', '`dev` has an Allow for `s3:*`', anyDoc(pols, (s) => allows(s, 's3:*')), 'Attach allow-s3.json with put-user-policy (step 1).'),
      item('key', '`dev` has an access key', keys.length > 0, 'Run step 2.'),
      item('before', 'You deleted `scratch.txt` as dev while only the Allow existed', ok(rs, /delete-object[\s\S]*scratch\.txt/), 'Run step 3 with the keys from step 2 before attaching the deny.'),
      item('deny', 'A separate policy denies `s3:DeleteObject` (IAM says explicitDeny)', sim['s3:DeleteObject']?.decision === 'explicitDeny' && Object.keys(pols).length >= 2, 'Attach deny-delete.json as its own policy (step 4).', JSON.stringify(sim)),
      item('denied', 'You watched dev get AccessDenied on delete while `s3:*` is allowed', denied(rs, /delete-object[\s\S]*h\.txt/) && hStays, "Run the break-it command with dev's keys in front."),
      item('sim', "You read IAM's verdict: allowed, explicitDeny and implicitDeny", ctx.history.some((r) => r.exitCode === 0 && /simulate-principal-policy/.test(r.command) && /allowed/.test(r.stdout) && /explicitDeny/.test(r.stdout) && /implicitDeny/.test(r.stdout)), 'Run the simulate command in step 7 after attaching both policies.'),
    ]
  },
}

/* ---------- 1.3 conditions ---------- */
export const iamConditions: LessonServer = {
  id: 'iam-conditions',
  files: {
    'list-home-dev.json': policyDoc([
      { Sid: 'ListOwnFolder', Effect: 'Allow', Action: 's3:ListBucket', Resource: BUCKET_ARN, Condition: { StringLike: { 's3:prefix': ['home/dev/*'] } } },
      { Sid: 'ReadOwnFolder', Effect: 'Allow', Action: 's3:GetObject', Resource: `${BUCKET_ARN}/home/dev/*` },
    ]),
  },
  async fixture(ctx) {
    await makeBucket(ctx, { 'home/dev/a.txt': 'dev file\n', 'home/other/b.txt': 'other file\n' })
    await makeUsers(ctx, 'dev')
  },
  async check(ctx) {
    const pols = await inlinePolicies(ctx, 'dev')
    const keys = await keyIds(ctx, 'dev')
    const rs = await ranAsUser(ctx, 'dev')
    const h = ctx.history
    const gated = anyDoc(pols, (s) => allows(s, 's3:ListBucket') && JSON.stringify(s.Condition ?? {}).includes('s3:prefix')) && !anyDoc(pols, (s) => s.Effect === 'Allow' && list(s.Action).some((a) => a === '*' || a === 's3:*' || a === 's3:List*'))
    const noprefix = rs.some((r) => r.exitCode !== 0 && /list-objects-v2/.test(r.command) && !/--prefix/.test(r.command) && /AccessDenied|not authorized/.test(r.stderr))
    return [
      item('policy', '`dev` has a ListBucket Allow gated on `s3:prefix` (no wildcard action)', gated, 'Attach list-home-dev.json with put-user-policy (step 1).'),
      item('key', '`dev` has an access key', keys.length > 0, 'Run step 2.'),
      item('ok', 'dev listed `home/dev/` successfully', ok(rs, /list-objects-v2[\s\S]*--prefix home\/dev\//, /a\.txt/), "Run step 3 with dev's keys in front."),
      item('denied', 'You watched dev get AccessDenied on `home/other/`', denied(rs, /list-objects-v2[\s\S]*--prefix home\/other\//), "Run the break-it command with dev's keys."),
      item('noprefix', 'You saw that listing with no prefix is denied too', noprefix, 'Run step 5: no --prefix at all.'),
      item('sim', 'You simulated `s3:prefix` values: allowed for home/dev/, implicitDeny for home/other/', ok(h, /simulate-principal-policy[\s\S]*s3:prefix[\s\S]*home\/dev\//, /allowed/) && ok(h, /simulate-principal-policy[\s\S]*s3:prefix[\s\S]*home\/other\//, /implicitDeny/), 'Run both simulate commands in step 6 (with the policy attached).'),
      item('ip', 'You simulated aws:SourceIp inside and outside 203.0.113.0/24', ok(h, /simulate-custom-policy[\s\S]*203\.0\.113\.9,/, /allowed/) && ok(h, /simulate-custom-policy[\s\S]*198\.51\.100\.7,/, /implicitDeny/), 'Run both commands in step 7.'),
    ]
  },
}

/* ---------- 1.4 roles and STS ---------- */
const trustOf = (ids: string[]) => policyDoc([{ Effect: 'Allow', Principal: { AWS: ids }, Action: 'sts:AssumeRole' }])
export const iamRolesSts: LessonServer = {
  id: 'iam-roles-sts',
  files: {
    'trust-dev.json': trustOf([userArn('dev')]),
    'auditor-read.json': policyDoc([{ Effect: 'Allow', Action: 's3:GetObject', Resource: `${BUCKET_ARN}/*` }]),
    'dev-assume.json': policyDoc([{ Effect: 'Allow', Action: 'sts:AssumeRole', Resource: roleArn('auditor') }]),
  },
  async fixture(ctx) {
    await makeBucket(ctx)
    await makeUsers(ctx, 'dev')
    await createRole(ctx, 'admin-only', policyDoc([{ Effect: 'Allow', Principal: { AWS: 'arn:aws:iam::000000000000:root' }, Action: 'sts:AssumeRole', Condition: { Bool: { 'aws:MultiFactorAuthPresent': 'true' } } }]))
  },
  async check(ctx) {
    const role = await ctx.c.iam.send(new GetRoleCommand({ RoleName: 'auditor' })).then((r) => r.Role, () => undefined)
    const trust = decode(role?.AssumeRolePolicyDocument as string | undefined)
    const principals = statements(trust).flatMap((s) => list(s.Principal?.AWS))
    const trustOk = Boolean(role) && principals.includes(userArn('dev')) && !principals.includes('*') && !statements(trust).some((s) => s.Principal === '*')
    const sim = await simulate(ctx, roleArn('auditor'), ['s3:GetObject', 's3:PutObject'], [OBJ])
    const rs = await ranAsUser(ctx, 'dev')
    const sess = ranAsSession(ctx)
    return [
      item('role', 'Role `auditor` trusts `user/dev` and nobody wider', trustOk, 'Create it with trust-dev.json (step 1).'),
      item('rolepol', 'IAM says the role may GetObject but not PutObject', sim['s3:GetObject']?.decision === 'allowed' && Boolean(sim['s3:PutObject']) && sim['s3:PutObject'].decision !== 'allowed', 'Attach auditor-read.json with put-role-policy (step 2).', JSON.stringify(sim)),
      item('assume', 'dev assumed `auditor` and got temporary credentials', ok(rs, /sts assume-role[\s\S]*role\/auditor/, /\S+\s+\S+\s+\S{20,}/), "Run step 5 with dev's keys in front (after steps 1-4)."),
      item('whoami', 'The session identity is `assumed-role/auditor/…`', ok(sess, /get-caller-identity/, /assumed-role\/auditor\//), 'Run step 6 with all three variables.'),
      item('read', 'The session read `h.txt`', ok(sess, /get-object[\s\S]*h\.txt/), 'Run step 7 with the session credentials.'),
      item('put-denied', 'You watched the session get AccessDenied on PutObject', denied(sess, /put-object/), 'Run the break-it command with all three variables.'),
      item('untrusted', 'You saw dev refused when assuming `admin-only`', denied(rs, /sts assume-role[\s\S]*role\/admin-only/), 'Run step 9.'),
    ]
  },
}

/* ---------- 1.5 resource-based policies ---------- */
const QARN = arn.queue('locked')
export const iamResourcePolicies: LessonServer = {
  id: 'iam-resource-policies',
  files: {
    'dev-allow.json': policyDoc([{ Effect: 'Allow', Action: ['s3:*', 'sqs:*'], Resource: '*' }]),
    'bucket-deny-dev.json': policyDoc([{ Sid: 'DenyDev', Effect: 'Deny', Principal: { AWS: userArn('dev') }, Action: 's3:GetObject', Resource: `${BUCKET_ARN}/*` }]),
    'bucket-grant-guest.json': policyDoc([{ Sid: 'GrantGuest', Effect: 'Allow', Principal: { AWS: userArn('guest') }, Action: 's3:GetObject', Resource: `${BUCKET_ARN}/*` }]),
    'queue-deny.json': JSON.stringify({ Policy: policyDoc([{ Sid: 'DenySend', Effect: 'Deny', Principal: { AWS: userArn('dev') }, Action: 'sqs:SendMessage', Resource: QARN }]) }, null, 2),
  },
  async fixture(ctx) {
    await makeBucket(ctx)
    await makeUsers(ctx, 'dev', 'guest')
    const { CreateQueueCommand } = await import('@aws-sdk/client-sqs')
    await ctx.c.sqs.send(new CreateQueueCommand({ QueueName: 'locked' }))
  },
  async check(ctx) {
    const pols = await inlinePolicies(ctx, 'dev')
    const devKeys = await keyIds(ctx, 'dev')
    const rd = await ranAsUser(ctx, 'dev')
    const rg = await ranAsUser(ctx, 'guest')
    const getsD = (r: { command: string }) => /get-object/.test(r.command)
    const okFirst = rd.findIndex((r) => r.exitCode === 0 && getsD(r))
    const failLast = lastIdx(rd, (r) => r.exitCode !== 0 && getsD(r) && /AccessDenied|not authorized/.test(r.stderr))
    const gFail = rg.findIndex((r) => r.exitCode !== 0 && getsD(r) && /AccessDenied|not authorized/.test(r.stderr))
    const gOk = lastIdx(rg, (r) => r.exitCode === 0 && getsD(r))
    const bp = await ctx.c.s3.send(new GetBucketPolicyCommand({ Bucket: BUCKET })).then((r) => r.Policy ?? '', () => '')
    const guestNoPolicy = !(await hasAnyPolicy(ctx, 'guest'))
    const send = (r: { command: string }) => /sqs send-message/.test(r.command)
    const sFail = rd.findIndex((r) => r.exitCode !== 0 && send(r) && /AccessDenied|not authorized/.test(r.stderr))
    const sOkAfter = sFail >= 0 && rd.some((r, i) => i > sFail && r.exitCode === 0 && send(r))
    return [
      item('devpol', '`dev` has an identity Allow and keys', anyDoc(pols, (s) => allows(s, 's3:GetObject')) && devKeys.length > 0, 'Run both commands in step 1.'),
      item('deny', "You watched a bucket-policy Deny beat dev's identity Allow", okFirst >= 0 && failLast > okFirst, 'Read as dev before the bucket policy, attach the deny (step 3), then run the break-it command.'),
      item('guestdenied', '`guest` was refused while nothing allowed it', gFail >= 0, 'Run step 5 (keys, then the get-object).'),
      item('grant', '`guest` reads through the bucket policy alone (still no identity policy)', gFail >= 0 && gOk > gFail && guestNoPolicy && bp.includes('guest'), 'Attach bucket-grant-guest.json and read as guest (step 6).'),
      item('sqsdeny', "A queue policy denied dev's SendMessage while ReceiveMessage still worked", sFail >= 0 && ok(rd, /sqs receive-message/), 'Apply queue-deny.json and run the send and receive commands (step 7).'),
      item('sqsfix', "After removing the queue policy, dev's SendMessage worked", sOkAfter, 'Run step 8.'),
    ]
  },
}

/* ---------- 1.6 permission boundaries (simulated) ---------- */
const BARN = `arn:aws:iam::000000000000:policy/read-only-boundary`
export const iamBoundaries: LessonServer = {
  id: 'iam-boundaries',
  files: {
    'dev-allow.json': policyDoc([{ Effect: 'Allow', Action: 's3:*', Resource: '*' }]),
    'boundary.json': policyDoc([{ Effect: 'Allow', Action: ['s3:Get*', 's3:List*'], Resource: '*' }]),
    'delegation.json': policyDoc([{ Effect: 'Allow', Action: 'iam:CreateUser', Resource: '*', Condition: { StringEquals: { 'iam:PermissionsBoundary': BARN } } }]),
  },
  async fixture(ctx) {
    await makeBucket(ctx)
    await makeUsers(ctx, 'dev', 'team-lead')
  },
  async check(ctx) {
    const u = await ctx.c.iam.send(new GetUserCommand({ UserName: 'dev' })).then((r) => r.User, () => undefined)
    const attached = u?.PermissionsBoundary?.PermissionsBoundaryArn === BARN
    const sim = await simulate(ctx, userArn('dev'), ['s3:GetObject', 's3:PutObject'], [OBJ])
    const lead = await simulate(ctx, userArn('team-lead'), ['iam:CreateUser'], undefined, [{ name: 'iam:PermissionsBoundary', values: [BARN] }])
    const leadNo = await simulate(ctx, userArn('team-lead'), ['iam:CreateUser'])
    const h = ctx.history
    const rd = await ranAsUser(ctx, 'dev')
    // Only the evaluation API is trusted here: the checker never relies on how a real call behaves.
    return [
      item('boundary', 'The read-only boundary exists and is attached to `dev`', attached, 'Run steps 2 and 3.'),
      item('sim', 'IAM simulates: GetObject allowed, PutObject denied by the boundary', sim['s3:GetObject']?.decision === 'allowed' && Boolean(sim['s3:PutObject']) && sim['s3:PutObject'].decision !== 'allowed' && sim['s3:PutObject'].boundary === false, 'dev needs allow-s3 (step 1) and the boundary (step 3), then run step 4.', JSON.stringify(sim)),
      item('seen', 'You read the simulation output with AllowedByPermissionsBoundary', h.some((r) => r.exitCode === 0 && /simulate-principal-policy[\s\S]*user\/dev/.test(r.command) && /s3:PutObject\s+implicitDeny\s+False/.test(r.stdout)), 'Run the simulate command in step 4.'),
      item('real', 'You ran the real PutObject as dev and compared it with the simulation', rd.some((r) => /put-object/.test(r.command)), "Run step 6 with dev's keys in front."),
      item('delegation', 'IAM says team-lead may CreateUser only with the boundary in the request', lead['iam:CreateUser']?.decision === 'allowed' && leadNo['iam:CreateUser']?.decision !== 'allowed' && Boolean(leadNo['iam:CreateUser']) && ok(h, /simulate-principal-policy[\s\S]*team-lead[\s\S]*iam:PermissionsBoundary/, /allowed/), 'Attach delegation.json to team-lead and run both simulations (step 7).'),
    ]
  },
}

/* ---------- 1.7 ABAC (concept) ---------- */
const ABAC_STARTER = policyDoc([{ Sid: 'TeamData', Effect: 'Allow', Action: 'dynamodb:*', Resource: '*' }])
const tagsOf = async (ctx: Ctx, table: string) => (await ctx.c.ddb.send(new ListTagsOfResourceCommand({ ResourceArn: arn.table(table) })).catch(() => undefined))?.Tags ?? []
export const iamAbac: LessonServer = {
  id: 'iam-abac',
  files: { 'abac-policy.json': ABAC_STARTER },
  async fixture(ctx) {
    await makeUsers(ctx, 'dev')
    await createTable(ctx, 'team-a-data', { pk: 'pk' })
    await createTable(ctx, 'team-b-data', { pk: 'pk' })
  },
  async check(ctx) {
    const userTags = (await ctx.c.iam.send(new ListUserTagsCommand({ UserName: 'dev' })).catch(() => undefined))?.Tags ?? []
    const ta = await tagsOf(ctx, 'team-a-data')
    const tb = await tagsOf(ctx, 'team-b-data')
    const tagsOk = userTags.some((t) => t.Key === 'team' && t.Value === 'a') && ta.some((t) => t.Key === 'team' && t.Value === 'a') && tb.some((t) => t.Key === 'team' && t.Value === 'b')
    let doc: any
    try { doc = JSON.parse(readFileSync(path.join(ctx.workdir, 'abac-policy.json'), 'utf8')) } catch { /* invalid */ }
    const sts = statements(doc)
    const allowList = sts.filter((s) => s.Effect === 'Allow')
    const actionsOk = allowList.length > 0 && allowList.every((s) => list(s.Action).length > 0 && list(s.Action).every((a) => /^[a-z0-9-]+:[A-Za-z0-9]+$/.test(a)))
    const condOk = allowList.some((s) => {
      const eq = s.Condition?.StringEquals ?? s.Condition?.StringLike
      return list(eq?.['aws:ResourceTag/team']).includes('${aws:PrincipalTag/team}')
    })
    const guardActs = sts.filter((s) => s.Effect === 'Deny').flatMap((s) => list(s.Action).map((a) => a.toLowerCase()))
    const guardOk = guardActs.includes('iam:taguser') && guardActs.includes('iam:untaguser')
    const ctxA = [{ name: 'aws:PrincipalTag/team', values: ['a'] }, { name: 'aws:ResourceTag/team', values: ['a'] }]
    const ctxB = [{ name: 'aws:PrincipalTag/team', values: ['a'] }, { name: 'aws:ResourceTag/team', values: ['b'] }]
    const sa = await simulate(ctx, userArn('dev'), ['dynamodb:GetItem'], [arn.table('team-a-data')], ctxA)
    const sb = await simulate(ctx, userArn('dev'), ['dynamodb:GetItem'], [arn.table('team-b-data')], ctxB)
    const h = ctx.history
    const simOk = sa['dynamodb:GetItem']?.decision === 'allowed' && Boolean(sb['dynamodb:GetItem']) && sb['dynamodb:GetItem'].decision !== 'allowed'
    return [
      item('tags', '`dev` is tagged `team=a`, the tables are tagged `a` and `b`', tagsOk, 'Run steps 1 and 2.'),
      item('json', '`abac-policy.json` is valid policy JSON', Boolean(doc) && sts.length > 0, 'Fix the JSON in the editor.'),
      item('actions', 'The Allow lists explicit actions (no `*` or `service:*`)', actionsOk, 'Replace `dynamodb:*` with GetItem, PutItem, Query.'),
      item('condition', 'Condition: `aws:ResourceTag/team` equals `${aws:PrincipalTag/team}`', condOk, 'Use StringEquals with the variable on the right-hand side.'),
      item('guard', 'A Deny stops dev from calling `iam:TagUser` and `iam:UntagUser`', guardOk, 'Add a second statement with Effect Deny for both actions.'),
      item('sim', 'IAM simulates team a on a as allowed, and a on b as denied', simOk && ok(h, /simulate-principal-policy[\s\S]*aws:ResourceTag\/team/, /allowed/), 'Attach the policy (step 4) and run both commands in step 5.'),
    ]
  },
}
