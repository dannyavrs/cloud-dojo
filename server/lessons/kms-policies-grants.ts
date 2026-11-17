import { CreateAliasCommand, CreateKeyCommand, DescribeKeyCommand, GetKeyPolicyCommand, GetKeyRotationStatusCommand, ListGrantsCommand, ListKeysCommand } from '@aws-sdk/client-kms'
import { PutUserPolicyCommand } from '@aws-sdk/client-iam'
import { DENY_POLICY, NO_IAM_POLICY } from '../../shared/lessons/kms-policies-grants'
import { item, type Ctx, type LessonServer } from '../lesson-kit'
import { firstIdx, lastIdx, makeUsers, ranAsUser, statements, list } from './iam-kit'
import { policyDoc } from './kit2'

const DENIED = /AccessDenied|not authorized/
const onVault = (r: { command: string }) => /--key-id alias\/vault/.test(r.command)

async function policyOf(ctx: Ctx, keyId: string): Promise<any[]> {
  const r = await ctx.c.kms.send(new GetKeyPolicyCommand({ KeyId: keyId, PolicyName: 'default' })).catch(() => undefined)
  try { return statements(JSON.parse(r?.Policy ?? '{}')) } catch { return [] }
}
const isRoot = (s: any) => list(s.Principal?.AWS).some((p) => /:root$/.test(p))

/** Customer managed keys with their state and whether the key policy delegates to IAM (root statement). */
async function cmks(ctx: Ctx) {
  const keys = (await ctx.c.kms.send(new ListKeysCommand({})).catch(() => undefined))?.Keys ?? []
  const out: { id: string; state?: string; delegates: boolean }[] = []
  for (const k of keys) {
    const m = (await ctx.c.kms.send(new DescribeKeyCommand({ KeyId: k.KeyId })).catch(() => undefined))?.KeyMetadata
    if (m?.KeyManager !== 'CUSTOMER') continue
    const st = await policyOf(ctx, k.KeyId!)
    out.push({ id: k.KeyId!, state: m.KeyState, delegates: st.some((s) => s.Effect === 'Allow' && isRoot(s)) })
  }
  return out
}

export const kmsPoliciesGrants: LessonServer = {
  id: 'kms-policies-grants',
  files: { 'key-policy-deny.json': DENY_POLICY, 'key-policy-no-iam.json': NO_IAM_POLICY },
  async fixture(ctx) {
    const k = await ctx.c.kms.send(new CreateKeyCommand({ Description: 'vault' }))
    await ctx.c.kms.send(new CreateAliasCommand({ AliasName: 'alias/vault', TargetKeyId: k.KeyMetadata!.KeyId }))
    await makeUsers(ctx, 'analyst', 'auditor')
    await ctx.c.iam.send(new PutUserPolicyCommand({
      UserName: 'analyst', PolicyName: 'kms-use',
      PolicyDocument: policyDoc([{ Effect: 'Allow', Action: ['kms:Encrypt', 'kms:Decrypt', 'kms:GenerateDataKey*', 'kms:ReEncrypt*'], Resource: '*' }]),
    }))
  },
  async check(ctx) {
    const an = await ranAsUser(ctx, 'analyst')
    const au = await ranAsUser(ctx, 'auditor')
    const enc = (r: { command: string }) => /kms encrypt/.test(r.command)
    const dec = (r: { command: string }) => /kms decrypt/.test(r.command)
    const okRun = (r: { exitCode: number }) => r.exitCode === 0
    const deniedRun = (r: { exitCode: number; stderr: string }) => r.exitCode !== 0 && DENIED.test(r.stderr)

    const vault = await policyOf(ctx, 'alias/vault')
    const denyAnalyst = vault.some((s) => s.Effect === 'Deny' && JSON.stringify(s.Principal ?? {}).includes('user/analyst') && list(s.Action).some((a) => /^kms:(Encrypt|\*)$/.test(a)))
    const policy = denyAnalyst && vault.some((s) => s.Effect === 'Allow' && isRoot(s))

    const baseIdx = firstIdx(an, (r) => okRun(r) && enc(r) && onVault(r))
    const failIdx = lastIdx(an, (r) => deniedRun(r) && enc(r) && onVault(r))
    const breakit = policy && baseIdx >= 0 && failIdx > baseIdx
    const granular = breakit && an.some((r, i) => i > failIdx && okRun(r) && dec(r))

    const keys = await cmks(ctx)
    const isolatedSeen = an.some((r) => deniedRun(r) && enc(r) && !onVault(r))
    const nodeleg = isolatedSeen && keys.some((k) => !k.delegates && k.state === 'Enabled')

    const f = firstIdx(au, (r) => deniedRun(r) && dec(r))
    const okDec = f >= 0 ? au.findIndex((r, i) => i > f && okRun(r) && dec(r)) : -1
    const encFail = okDec >= 0 && au.some((r, i) => i > okDec && deniedRun(r) && enc(r))
    const grant = okDec >= 0 && encFail
    const revokedRun = okDec >= 0 && au.some((r, i) => i > okDec && deniedRun(r) && dec(r))
    const vaultId = (await ctx.c.kms.send(new DescribeKeyCommand({ KeyId: 'alias/vault' })).catch(() => undefined))?.KeyMetadata?.KeyId
    const grants = vaultId ? (await ctx.c.kms.send(new ListGrantsCommand({ KeyId: vaultId })).catch(() => undefined))?.Grants ?? [] : []
    const stillGranted = grants.some((g) => g.GranteePrincipal?.includes('user/auditor'))
    const revoked = grant && revokedRun && !stillGranted

    const rot = (await ctx.c.kms.send(new GetKeyRotationStatusCommand({ KeyId: 'alias/vault' })).catch(() => undefined))?.KeyRotationEnabled === true
    const pending = keys.some((k) => k.state === 'PendingDeletion')
    const refused = ctx.history.some((r) => !r.rejected && r.exitCode !== 0 && /kms encrypt/.test(r.command) && /pending deletion/i.test(r.stderr))

    return [
      item('baseline', 'The analyst encrypted with `alias/vault` before any Deny', baseIdx >= 0, 'Create the analyst access keys (step 2) and run the baseline encrypt as the analyst.'),
      item('nodeleg', 'A key without the root statement refused the analyst despite an IAM Allow', nodeleg, 'Create the isolated key (step 4) and encrypt with it as the analyst.'),
      item('policy', 'The key policy of `alias/vault` has a Deny for the analyst and keeps the root statement', policy, 'Run put-key-policy with key-policy-deny.json.'),
      item('breakit', 'You saw the analyst refused on Encrypt by the key policy', breakit, 'Run the break-it command as the analyst after the policy is in place.'),
      item('granular', 'The analyst could still Decrypt after the Deny', granular, 'Run the second break-it command (decrypt as the analyst).'),
      item('grant', 'The auditor was denied, then decrypted through a grant but could not encrypt', grant, 'Follow step 7 in order: decrypt, create-grant, decrypt, encrypt as the auditor.'),
      item('revoked', 'After revoking the grant the auditor was denied again', revoked, 'Run revoke-grant with the grant id, then decrypt as the auditor once more.'),
      item('rotation', 'Automatic rotation is enabled on `alias/vault`', rot, 'Run enable-key-rotation.'),
      item('deletion', 'A scratch key is PendingDeletion and refused to encrypt', pending && refused, 'Create a scratch key, schedule its deletion, then try to encrypt with it.'),
    ]
  },
}
