import { GetFunctionUrlConfigCommand, GetPolicyCommand } from '@aws-sdk/client-lambda'
import { WEB_HANDLER } from '../../shared/lessons/lambda-function-url'
import { item, type LessonServer } from '../lesson-kit'
import { createFunction } from './kit2'
import { seedRole } from './lambda-kit'

const stmts = (raw?: string): any[] => {
  try { return [].concat(JSON.parse(raw ?? '{}').Statement ?? []) } catch { return [] }
}
const list = (v: unknown): string[] => [].concat((v ?? []) as never)
const isStar = (p: any) => p === '*' || list(p?.AWS).includes('*')

export const lambdaFunctionUrl: LessonServer = {
  id: 'lambda-function-url',
  files: { 'web.mjs': WEB_HANDLER },
  zips: { 'web.zip': { 'web.mjs': WEB_HANDLER } },
  async fixture(ctx) {
    await seedRole(ctx)
    await createFunction(ctx, 'web', 'web.handler', 'web.zip', 'lambda-exec')
  },
  async check(ctx) {
    const cfg = await ctx.c.lambda.send(new GetFunctionUrlConfigCommand({ FunctionName: 'web' })).catch(() => undefined)
    const policy = (await ctx.c.lambda.send(new GetPolicyCommand({ FunctionName: 'web' })).catch(() => undefined))?.Policy
    const s = stmts(policy).filter((x) => x.Effect === 'Allow' && isStar(x.Principal))
    const permUrl = s.some((x) => list(x.Action).includes('lambda:InvokeFunctionUrl') && x.Condition?.StringEquals?.['lambda:FunctionUrlAuthType'] === 'NONE')
    const permInvoke = s.some((x) => list(x.Action).includes('lambda:InvokeFunction'))
    const forbidden = ctx.probes.some((p) => p.url.includes('/_aws/lambda-url/') && p.status === 403 && /Forbidden/.test(p.body))
    let open = false
    let detail = cfg?.FunctionUrl ? 'no answer' : 'no URL yet'
    if (cfg?.FunctionUrl) {
      const r = await ctx.httpGet(cfg.FunctionUrl).catch(() => undefined)
      open = r?.status === 200 && /function URL/.test(r.body)
      if (r) detail = `${r.status} ${r.body.slice(0, 80)}`
    }
    return [
      item('url', 'Function `web` has a Function URL with auth type NONE', cfg?.AuthType === 'NONE', 'Run create-function-url-config --auth-type NONE.'),
      item('breakit', 'You saw 403 Forbidden from the URL in the HTTP probe, before granting access', forbidden, 'Open the URL in the HTTP probe before running add-permission.'),
      item('perm-url', 'The policy allows lambda:InvokeFunctionUrl for * with FunctionUrlAuthType NONE', permUrl, 'Run the first add-permission command.'),
      item('perm-invoke', 'The policy also allows lambda:InvokeFunction', permInvoke, 'Run the second add-permission command.'),
      item('open', 'The URL now answers 200 with the JSON body', open, 'Send the GET again in the HTTP probe.', detail),
    ]
  },
}
