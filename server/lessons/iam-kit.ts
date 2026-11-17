/** Helpers shared by the IAM track checkers (1.2-1.7). */
import { CreateBucketCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { CreateUserCommand, GetUserCommand, ListAccessKeysCommand, ListAttachedUserPoliciesCommand, GetUserPolicyCommand, ListUserPoliciesCommand, SimulatePrincipalPolicyCommand } from '@aws-sdk/client-iam'
import { ACCOUNT, type Ctx } from '../lesson-kit'
import type { RunResult } from '../runner'

export const BUCKET = 'iam-lab'
export const userArn = (n: string) => `arn:aws:iam::${ACCOUNT}:user/${n}`
export const roleArn = (n: string) => `arn:aws:iam::${ACCOUNT}:role/${n}`
export const decode = (s?: string) => (s ? JSON.parse(decodeURIComponent(s)) : undefined)
export const statements = (doc: any): any[] => [].concat(doc?.Statement ?? [])
export const list = (v: unknown): string[] => ([] as string[]).concat((v ?? []) as string[])

export async function makeBucket(ctx: Ctx, objects: Record<string, string> = { 'h.txt': 'hello from iam-lab\n' }) {
  await ctx.c.s3.send(new CreateBucketCommand({ Bucket: BUCKET }))
  for (const [Key, Body] of Object.entries(objects)) await ctx.c.s3.send(new PutObjectCommand({ Bucket: BUCKET, Key, Body }))
}

export async function makeUsers(ctx: Ctx, ...names: string[]) {
  for (const UserName of names) await ctx.c.iam.send(new CreateUserCommand({ UserName }))
}

export const userExists = (ctx: Ctx, n: string) => ctx.c.iam.send(new GetUserCommand({ UserName: n })).then(() => true, () => false)

export async function keyIds(ctx: Ctx, user: string): Promise<string[]> {
  const r = await ctx.c.iam.send(new ListAccessKeysCommand({ UserName: user })).catch(() => undefined)
  return (r?.AccessKeyMetadata ?? []).map((k) => k.AccessKeyId!).filter(Boolean)
}

/** Every command in the history that ran with one of this user's own access keys in front (no session token). */
export async function ranAsUser(ctx: Ctx, user: string): Promise<RunResult[]> {
  const ids = await keyIds(ctx, user)
  return ctx.history.filter((r) => !r.rejected && !/AWS_SESSION_TOKEN=/.test(r.command) && ids.some((id) => r.command.includes(`AWS_ACCESS_KEY_ID=${id}`)))
}

/** Commands run with temporary (assumed-role) credentials: an access key plus a session token. */
export const ranAsSession = (ctx: Ctx) => ctx.history.filter((r) => !r.rejected && /AWS_SESSION_TOKEN=/.test(r.command))

export const ok = (rs: RunResult[], cmd: RegExp, out?: RegExp) => rs.some((r) => r.exitCode === 0 && cmd.test(r.command) && (!out || out.test(r.stdout)))
export const denied = (rs: RunResult[], cmd: RegExp, err = /AccessDenied|not authorized/) => rs.some((r) => r.exitCode !== 0 && cmd.test(r.command) && err.test(r.stderr))
/** Index of the first / last matching run, for "this happened before that" checks. */
export const firstIdx = (rs: RunResult[], f: (r: RunResult) => boolean) => rs.findIndex(f)
export const lastIdx = (rs: RunResult[], f: (r: RunResult) => boolean) => { for (let i = rs.length - 1; i >= 0; i--) if (f(rs[i])) return i; return -1 }

export async function inlinePolicies(ctx: Ctx, user: string): Promise<Record<string, any>> {
  const out: Record<string, any> = {}
  const names = (await ctx.c.iam.send(new ListUserPoliciesCommand({ UserName: user })).catch(() => undefined))?.PolicyNames ?? []
  for (const PolicyName of names) {
    const r = await ctx.c.iam.send(new GetUserPolicyCommand({ UserName: user, PolicyName })).catch(() => undefined)
    if (r) out[PolicyName] = decode(r.PolicyDocument)
  }
  return out
}

export async function hasAnyPolicy(ctx: Ctx, user: string): Promise<boolean> {
  const inline = Object.keys(await inlinePolicies(ctx, user))
  const attached = (await ctx.c.iam.send(new ListAttachedUserPoliciesCommand({ UserName: user })).catch(() => undefined))?.AttachedPolicies ?? []
  return inline.length + attached.length > 0
}

export interface Ctxe { name: string; values: string[]; type?: 'string' | 'ip' }
export async function simulate(ctx: Ctx, sourceArn: string, actions: string[], resources?: string[], context?: Ctxe[]) {
  try {
    const r = await ctx.c.iam.send(new SimulatePrincipalPolicyCommand({
      PolicySourceArn: sourceArn, ActionNames: actions, ResourceArns: resources,
      ContextEntries: context?.map((c) => ({ ContextKeyName: c.name, ContextKeyValues: c.values, ContextKeyType: c.type ?? 'string' })),
    }))
    return Object.fromEntries((r.EvaluationResults ?? []).map((e) => [e.EvalActionName!, { decision: e.EvalDecision!, boundary: e.PermissionsBoundaryDecisionDetail?.AllowedByPermissionsBoundary }]))
  } catch { return {} as Record<string, { decision: string; boundary?: boolean }> }
}

export const hasWildcardAllow = (doc: any) => statements(doc).some((s) => s.Effect === 'Allow' && list(s.Action).some((a) => a === '*' || a.endsWith(':*')))
