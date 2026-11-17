import { CreateApiCommand, CreateIntegrationCommand, CreateRouteCommand, CreateStageCommand, GetApisCommand, GetAuthorizersCommand, GetRoutesCommand, GetStagesCommand } from '@aws-sdk/client-apigatewayv2'
import { GetPolicyCommand } from '@aws-sdk/client-lambda'
import { FN_ARN, NOTES_HANDLER } from '../../shared/lessons/apigw-sources'
import type { Ctx, ProbeRecord } from '../lesson-kit'
import { createFunction } from './kit2'
import { seedRole } from './lambda-kit'

/** Zips every API Gateway module starts from: the echo backend. */
export const NOTES_ZIP = { 'notes-fn.zip': { 'handler.mjs': NOTES_HANDLER } }

/** Role + the echo function `notes-fn`. */
export async function seedNotesFn(ctx: Ctx) {
  await seedRole(ctx)
  await createFunction(ctx, 'notes-fn', 'handler.handler', 'notes-fn.zip', 'lambda-exec')
}

/** An HTTP API named `notes` on the auto-deployed `$default` stage with the given routes already wired to `notes-fn`. */
export async function seedHttpApi(ctx: Ctx, routeKeys: string[]) {
  const api = await ctx.c.apigw.send(new CreateApiCommand({ Name: 'notes', ProtocolType: 'HTTP' }))
  await ctx.c.apigw.send(new CreateStageCommand({ ApiId: api.ApiId, StageName: '$default', AutoDeploy: true }))
  const int = await ctx.c.apigw.send(new CreateIntegrationCommand({ ApiId: api.ApiId, IntegrationType: 'AWS_PROXY', IntegrationUri: FN_ARN('notes-fn'), PayloadFormatVersion: '2.0' }))
  for (const key of routeKeys) await ctx.c.apigw.send(new CreateRouteCommand({ ApiId: api.ApiId, RouteKey: key, Target: `integrations/${int.IntegrationId}` }))
  return api
}

export async function findApi(ctx: Ctx, name = 'notes') {
  return ((await ctx.c.apigw.send(new GetApisCommand({})).catch(() => undefined))?.Items ?? []).find((a) => a.Name === name)
}
export async function routesOf(ctx: Ctx, apiId?: string) {
  if (!apiId) return []
  return (await ctx.c.apigw.send(new GetRoutesCommand({ ApiId: apiId })).catch(() => undefined))?.Items ?? []
}
export async function stagesOf(ctx: Ctx, apiId?: string) {
  if (!apiId) return []
  return (await ctx.c.apigw.send(new GetStagesCommand({ ApiId: apiId })).catch(() => undefined))?.Items ?? []
}
export async function authorizersOf(ctx: Ctx, apiId?: string) {
  if (!apiId) return []
  return (await ctx.c.apigw.send(new GetAuthorizersCommand({ ApiId: apiId })).catch(() => undefined))?.Items ?? []
}

/** Does the function's resource policy let API Gateway invoke it? */
export async function apigwMayInvoke(ctx: Ctx, fn: string): Promise<boolean> {
  try { return JSON.stringify(JSON.parse((await ctx.c.lambda.send(new GetPolicyCommand({ FunctionName: fn }))).Policy ?? '{}')).includes('apigateway.amazonaws.com') } catch { return false }
}

/** Probe-panel calls made against this API's address (path prefix match). */
export const probesAt = (ctx: Ctx, base: string | undefined, method?: string): ProbeRecord[] =>
  base ? ctx.probes.filter((p) => p.url.startsWith(base) && (!method || p.method === method)) : []

/** The JSON the echo function returned, if the probe body is that JSON. */
export function echoOf(p: ProbeRecord): any {
  try { return JSON.parse(p.body) } catch { return undefined }
}
