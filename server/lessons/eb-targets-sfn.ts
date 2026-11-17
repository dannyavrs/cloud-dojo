import { CreateStateMachineCommand, DescribeExecutionCommand, ListExecutionsCommand } from '@aws-sdk/client-sfn'
import { GetPolicyCommand } from '@aws-sdk/client-lambda'
import { GetRolePolicyCommand, ListRolePoliciesCommand, PutRolePolicyCommand } from '@aws-sdk/client-iam'
import { arn, item, ranOk, type Ctx, type LessonServer } from '../lesson-kit'
import { createFunction, createRole, logsContain, policyDoc } from './kit2'
import { seedRole } from './lambda-kit'
import { createBus, getRule, safe, sfnArn, targetsOf, trust } from './eb-kit'

const SM = sfnArn('order-flow')
const FLOW_DEF = JSON.stringify({ Comment: 'Echoes its input so the execution input is easy to read', StartAt: 'Echo', States: { Echo: { Type: 'Pass', End: true } } }, null, 2)
const pattern = { source: ['shop.checkout'] }
const events = [{ EventBusName: 'shop', Source: 'shop.checkout', DetailType: 'Checkout', Detail: JSON.stringify({ orderId: 'o-1', total: 120 }) }]
const startPolicy = policyDoc([{ Effect: 'Allow', Action: 'states:StartExecution', Resource: SM }])
const target = (role: string, extra: object) => [{ Id: 'flow', Arn: SM, RoleArn: arn.role(role), ...extra }]
const transformer = { InputPathsMap: { order: '$.detail.orderId', total: '$.detail.total', src: '$.source' }, InputTemplate: '{"order": "<order>", "total": <total>, "via": "<src>"}' }

const logger = `export const handler = async (event) => {
  console.log("order-logger got", JSON.stringify(event));
  return {};
};
`

/** Inputs of recent executions of order-flow (newest first). */
async function executionInputs(ctx: Ctx): Promise<any[]> {
  const list = (await safe(ctx.c.sfn.send(new ListExecutionsCommand({ stateMachineArn: SM, maxResults: 25 }))))?.executions ?? []
  const out: any[] = []
  for (const e of list) {
    const d = await safe(ctx.c.sfn.send(new DescribeExecutionCommand({ executionArn: e.executionArn })))
    try { out.push(JSON.parse(d?.input ?? 'null')) } catch { /* not json */ }
  }
  return out
}

export const ebTargetsSfn: LessonServer = {
  id: 'eb-targets-sfn',
  files: {
    'pattern.json': JSON.stringify(pattern, null, 2),
    'events.json': JSON.stringify(events, null, 2),
    'targets-wrong.json': JSON.stringify(target('lambda-to-flow', { InputPath: '$.detail' }), null, 2),
    'targets-ok.json': JSON.stringify(target('eb-to-flow', { InputPath: '$.detail' }), null, 2),
    'targets-transform.json': JSON.stringify(target('eb-to-flow', { InputTransformer: transformer }), null, 2),
    'start-policy.json': startPolicy,
  },
  zips: { 'logger.zip': { 'logger.mjs': logger } },
  async fixture(ctx) {
    await createBus(ctx, 'shop')
    await createRole(ctx, 'sfn-exec', trust('states.amazonaws.com'))
    await createRole(ctx, 'eb-to-flow', trust('events.amazonaws.com'))
    await createRole(ctx, 'lambda-to-flow', trust('lambda.amazonaws.com'))
    await ctx.c.iam.send(new PutRolePolicyCommand({ RoleName: 'lambda-to-flow', PolicyName: 'start-flow', PolicyDocument: startPolicy }))
    await ctx.c.sfn.send(new CreateStateMachineCommand({ name: 'order-flow', definition: FLOW_DEF, roleArn: arn.role('sfn-exec') }))
    await seedRole(ctx)
    await createFunction(ctx, 'order-logger', 'logger.handler', 'logger.zip', 'lambda-exec')
  },
  async check(ctx) {
    const h = ctx.history
    const targets = await targetsOf(ctx, 'shop', 'to-flow')
    const flowTarget = targets.find((t) => t.Arn === SM)
    const roleOk = flowTarget?.RoleArn === arn.role('eb-to-flow')
    const names = (await safe(ctx.c.iam.send(new ListRolePoliciesCommand({ RoleName: 'eb-to-flow' }))))?.PolicyNames ?? []
    let perm = false
    for (const n of names) {
      const d = (await safe(ctx.c.iam.send(new GetRolePolicyCommand({ RoleName: 'eb-to-flow', PolicyName: n }))))?.PolicyDocument ?? ''
      if (/states:StartExecution|states:\*/.test(decodeURIComponent(d))) perm = true
    }
    const inputs = await executionInputs(ctx)
    const viaPath = inputs.some((i) => i && typeof i === 'object' && i.orderId && !('detail-type' in i) && !('via' in i))
    const viaTransform = inputs.some((i) => i && typeof i === 'object' && i.order && typeof i.total === 'number' && i.via === 'shop.checkout')
    const logTarget = (await targetsOf(ctx, 'shop', 'to-logger')).some((t) => t.Arn === arn.fn('order-logger'))
    const toLogger = await getRule(ctx, 'shop', 'to-logger')
    let lambdaPerm = false
    try { lambdaPerm = JSON.stringify(JSON.parse((await ctx.c.lambda.send(new GetPolicyCommand({ FunctionName: 'order-logger' }))).Policy ?? '{}')).includes('events.amazonaws.com') } catch { /* no policy */ }
    const logged = await safe(logsContain(ctx, '/aws/lambda/order-logger', 'shop.checkout'))
    // break-it: the wrong role was attached, then an empty execution list was printed afterwards
    const iWrong = h.findIndex((r) => !r.rejected && r.exitCode === 0 && /put-targets.*targets-wrong/.test(r.command))
    const sawEmpty = iWrong >= 0 && h.slice(iWrong + 1).some((r) => !r.rejected && r.exitCode === 0 && /list-executions/.test(r.command) && /^\s*(\[\s*\])?\s*$/.test(r.stdout))
    return [
      item('breakit', 'You saw a wrongly trusted role start no execution', sawEmpty && ranOk(h, /put-events/), 'Run the break-it step: put-targets with targets-wrong.json, put-events, then list-executions (empty).'),
      item('target', 'Rule `to-flow` targets `order-flow` with the role `eb-to-flow`', Boolean(flowTarget) && roleOk, 'put-targets with targets-ok.json (or targets-transform.json).', flowTarget?.RoleArn?.split('/').pop()),
      item('perm', 'Role `eb-to-flow` may call `states:StartExecution`', perm, 'put-role-policy with start-policy.json.'),
      item('exec', 'An execution received only the `detail` payload (InputPath)', viaPath, 'After the policy, use targets-ok.json and publish an event.', `${inputs.length} execution(s)`),
      item('transform', 'An execution received the transformed shape (`order`, `total`, `via`)', viaTransform, 'put-targets with targets-transform.json, publish, then list executions.'),
      item('lambdaperm', 'Rule `to-logger` targets `order-logger` and the function allows EventBridge', Boolean(toLogger) && logTarget && lambdaPerm, 'put-targets for the function, then lambda add-permission.'),
      item('lambdaran', 'The function logged a checkout event', Boolean(logged), 'Publish an event after add-permission; wait about 10 s for the cold start.'),
    ]
  },
}
