import { GetFunctionCommand, InvokeCommand } from '@aws-sdk/client-lambda'
import { PutRolePolicyCommand } from '@aws-sdk/client-iam'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Ctx } from '../lesson-kit'
import { createRole, policyDoc } from './kit2'

/** The execution role every Lambda module starts from: Lambda trust + CloudWatch Logs only. */
export async function seedRole(ctx: Ctx, extra: object[] = []) {
  await createRole(ctx, 'lambda-exec')
  await ctx.c.iam.send(new PutRolePolicyCommand({
    RoleName: 'lambda-exec', PolicyName: 'logs',
    PolicyDocument: policyDoc([{ Effect: 'Allow', Action: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'], Resource: '*' }, ...extra]),
  }))
}

export const fnConfig = async (ctx: Ctx, name: string) =>
  (await ctx.c.lambda.send(new GetFunctionCommand({ FunctionName: name })).catch(() => undefined))?.Configuration

export const readWork = (ctx: Ctx, name: string): string => {
  try { return readFileSync(path.join(ctx.workdir, name), 'utf8') } catch { return '' }
}

export const readJson = (ctx: Ctx, name: string): any => {
  try { return JSON.parse(readWork(ctx, name)) } catch { return undefined }
}

/** Invoke through the SDK; returns the parsed payload and the FunctionError (if any), never throws. */
export async function sdkInvoke(ctx: Ctx, name: string, payload: unknown = {}, qualifier?: string) {
  try {
    const r = await ctx.c.lambda.send(new InvokeCommand({ FunctionName: name, Qualifier: qualifier, Payload: Buffer.from(JSON.stringify(payload)) }))
    const text = r.Payload ? Buffer.from(r.Payload).toString('utf8') : ''
    let body: any = text
    try { body = JSON.parse(text) } catch { /* plain text */ }
    return { ok: true as const, status: r.StatusCode, functionError: r.FunctionError, version: r.ExecutedVersion, body, text }
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.name : String(e), message: e instanceof Error ? e.message : '' }
  }
}
