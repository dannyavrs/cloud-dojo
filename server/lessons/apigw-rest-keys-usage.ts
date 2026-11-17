import { GetApiKeysCommand, GetMethodCommand, GetResourcesCommand, GetRestApisCommand, GetStagesCommand, GetUsagePlanKeysCommand, GetUsagePlansCommand } from '@aws-sdk/client-api-gateway'
import { item, type Ctx, type LessonServer } from '../lesson-kit'
import { probesAt } from './apigw-kit'

const safe = async <T>(p: Promise<T>): Promise<T | undefined> => p.catch(() => undefined)

async function restState(ctx: Ctx) {
  const rc = ctx.c.apigwRest
  const api = (await safe(rc.send(new GetRestApisCommand({}))))?.items?.find((a) => a.name === 'legacy')
  const root = api?.id ? (await safe(rc.send(new GetResourcesCommand({ restApiId: api.id }))))?.items?.find((r) => r.path === '/') : undefined
  const method = api?.id && root?.id ? await safe(rc.send(new GetMethodCommand({ restApiId: api.id, resourceId: root.id, httpMethod: 'GET' }))) : undefined
  const stage = api?.id ? (await safe(rc.send(new GetStagesCommand({ restApiId: api.id }))))?.item?.find((s) => s.stageName === 'prod') : undefined
  const keys = (await safe(rc.send(new GetApiKeysCommand({}))))?.items ?? []
  const plans = (await safe(rc.send(new GetUsagePlansCommand({}))))?.items ?? []
  const plan = plans.find((p) => p.quota?.limit === 3 && p.quota.period === 'DAY' && p.apiStages?.some((s) => s.apiId === api?.id && s.stage === 'prod'))
  const planKeys = plan?.id ? ((await safe(rc.send(new GetUsagePlanKeysCommand({ usagePlanId: plan.id }))))?.items ?? []) : []
  return { api, method, stage, keys, plan, planKeys }
}

export const apigwRestKeysUsage: LessonServer = {
  id: 'apigw-rest-keys-usage',
  async check(ctx) {
    const s = await restState(ctx)
    const base = s.api?.id ? `${ctx.emu.endpoint}/_aws/execute-api/${s.api.id}/prod` : undefined
    const hits = probesAt(ctx, base, 'GET')
    const mock200 = hits.filter((p) => p.status === 200 && /"mock":\s*true/.test(p.body))
    const enabledKey = s.keys.find((k) => k.enabled)
    return [
      item('api', 'REST API `legacy` has a GET method that requires an API key and uses a MOCK integration', Boolean(s.method?.apiKeyRequired && s.method.methodIntegration?.type === 'MOCK'), 'Run create-rest-api, put-method with --api-key-required, then put-integration --type MOCK.', s.api ? `api ${s.api.id}` : 'no REST API yet'),
      item('deployed', 'The API is deployed to the stage `prod`', Boolean(s.stage), 'Run put-method-response, put-integration-response and create-deployment --stage-name prod.'),
      item('nokey', 'A call without a key was refused with 403', hits.some((p) => p.status === 403), 'GET the prod URL from the HTTP probe with no headers.'),
      item('key', 'An enabled API key exists', Boolean(enabledKey), 'Run create-api-key --enabled with a --value.'),
      item('plan', 'A usage plan with a quota of 3 per day covers `prod` and the key is attached to it', Boolean(s.plan && s.planKeys.some((k) => s.keys.some((x) => x.id === k.id))), 'Run create-usage-plan with --quota limit=3,period=DAY, then create-usage-plan-key.', s.plan ? `plan ${s.plan.id}, ${s.planKeys.length} key(s)` : 'no matching plan'),
      item('allowed', 'Three calls with the key got 200 and the mock body', mock200.length >= 3, 'GET the prod URL three times with the header `x-api-key`.', `${mock200.length} so far`),
      item('breakit', 'The fourth call was refused with 429 Limit Exceeded', hits.some((p) => p.status === 429 && /Limit Exceeded/.test(p.body)), 'Send a fourth GET with the key from the probe.'),
    ]
  },
}
