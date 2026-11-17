import { DescribeStateMachineCommand, GetExecutionHistoryCommand, ListExecutionsCommand } from '@aws-sdk/client-sfn'
import { PutRolePolicyCommand } from '@aws-sdk/client-iam'
import { ACCOUNT, type Ctx } from '../lesson-kit'
import { createRole, policyDoc } from './kit2'

export const SFN_TRUST = JSON.stringify({
  Version: '2012-10-17',
  Statement: [{ Effect: 'Allow', Principal: { Service: 'states.amazonaws.com' }, Action: 'sts:AssumeRole' }],
}, null, 2)

export const smArn = (name: string) => `arn:aws:states:us-east-1:${ACCOUNT}:stateMachine:${name}`

/** Roles every Step Functions module starts from: `lambda-exec` for functions, `sfn-exec` (trusted by states.amazonaws.com) for state machines. */
export async function seedSfnRoles(ctx: Ctx, lambdaActions: string[] = []) {
  await createRole(ctx, 'lambda-exec')
  await ctx.c.iam.send(new PutRolePolicyCommand({
    RoleName: 'lambda-exec', PolicyName: 'logs-and-data',
    PolicyDocument: policyDoc([{ Effect: 'Allow', Action: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents', ...lambdaActions], Resource: '*' }]),
  }))
  await createRole(ctx, 'sfn-exec', SFN_TRUST)
  await ctx.c.iam.send(new PutRolePolicyCommand({
    RoleName: 'sfn-exec', PolicyName: 'workflow-permissions',
    PolicyDocument: policyDoc([{ Effect: 'Allow', Action: ['lambda:InvokeFunction', 'dynamodb:PutItem', 'dynamodb:GetItem', 'sqs:SendMessage'], Resource: '*' }]),
  }))
}

export interface Exec { name: string; status?: string; error?: string; cause?: string; output?: string; types: string[] }

/** Every Standard execution of a state machine with its status and event-type history, read from the emulator. */
export async function executions(ctx: Ctx, machine: string): Promise<Exec[]> {
  const list = await ctx.c.sfn.send(new ListExecutionsCommand({ stateMachineArn: smArn(machine), maxResults: 50 })).catch(() => undefined)
  const out: Exec[] = []
  for (const e of list?.executions ?? []) {
    const hist = await ctx.c.sfn.send(new GetExecutionHistoryCommand({ executionArn: e.executionArn, maxResults: 500 })).catch(() => undefined)
    const events = hist?.events ?? []
    const end = events.find((x) => x.type === 'ExecutionFailed')?.executionFailedEventDetails
    const ok = events.find((x) => x.type === 'ExecutionSucceeded')?.executionSucceededEventDetails
    out.push({ name: e.name ?? '', status: e.status, error: end?.error, cause: end?.cause, output: ok?.output, types: events.map((x) => x.type ?? '') })
  }
  return out
}

export const count = (e: Exec, type: string) => e.types.filter((t) => t === type).length

/** The parsed ASL definition of a state machine, or undefined when it does not exist. */
export async function definition(ctx: Ctx, machine: string): Promise<{ type?: string; def: any } | undefined> {
  const d = await ctx.c.sfn.send(new DescribeStateMachineCommand({ stateMachineArn: smArn(machine) })).catch(() => undefined)
  if (!d) return undefined
  try { return { type: d.type, def: JSON.parse(d.definition ?? '{}') } } catch { return { type: d.type, def: {} } }
}
