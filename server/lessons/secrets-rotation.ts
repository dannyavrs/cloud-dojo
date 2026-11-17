import { DescribeSecretCommand, GetResourcePolicyCommand, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager'
import { GetPolicyCommand } from '@aws-sdk/client-lambda'
import { PutRolePolicyCommand, PutUserPolicyCommand } from '@aws-sdk/client-iam'
import { ROTATION_HANDLER } from '../../shared/lessons/secrets-rotation'
import { item, ranFail, ranOk, type Ctx, type LessonServer } from '../lesson-kit'
import { makeUsers, ranAsUser, firstIdx, lastIdx, userArn } from './iam-kit'
import { createRole, logsContain, policyDoc } from './kit2'
import { fnConfig } from './lambda-kit'

const SECRET_POLICY = policyDoc([{ Sid: 'DenyReader', Effect: 'Deny', Principal: { AWS: userArn('reader') }, Action: 'secretsmanager:GetSecretValue', Resource: '*' }])

/** Read a secret value on the server. Values stay inside this module: never put them in a check detail. */
async function valueOf(ctx: Ctx, stage: string): Promise<string | undefined> {
  const r = await ctx.c.secrets.send(new GetSecretValueCommand({ SecretId: 'app/db', VersionStage: stage })).catch(() => undefined)
  return r?.SecretString
}

export const secretsRotation: LessonServer = {
  id: 'secrets-rotation',
  files: { 'rotation.mjs': ROTATION_HANDLER, 'secret-policy.json': SECRET_POLICY },
  zips: { 'rotation.zip': { 'rotation.mjs': ROTATION_HANDLER } },
  async fixture(ctx) {
    await createRole(ctx, 'rotation-role')
    await ctx.c.iam.send(new PutRolePolicyCommand({
      RoleName: 'rotation-role', PolicyName: 'rotation',
      PolicyDocument: policyDoc([
        { Effect: 'Allow', Action: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'], Resource: '*' },
        { Effect: 'Allow', Action: ['secretsmanager:GetSecretValue', 'secretsmanager:PutSecretValue', 'secretsmanager:DescribeSecret', 'secretsmanager:UpdateSecretVersionStage'], Resource: '*' },
      ]),
    }))
    await makeUsers(ctx, 'reader')
    await ctx.c.iam.send(new PutUserPolicyCommand({
      UserName: 'reader', PolicyName: 'read-secrets',
      PolicyDocument: policyDoc([{ Effect: 'Allow', Action: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'], Resource: '*' }]),
    }))
  },
  async check(ctx) {
    const h = ctx.history
    const fn = await fnConfig(ctx, 'rotator')
    const desc = await ctx.c.secrets.send(new DescribeSecretCommand({ SecretId: 'app/db' })).catch(() => undefined)
    const cur = await valueOf(ctx, 'AWSCURRENT')
    const prev = await valueOf(ctx, 'AWSPREVIOUS')
    const rotated = Boolean(desc?.RotationEnabled) && Boolean(cur) && /rotated-/.test(cur!)
    const previous = rotated && Boolean(prev) && prev !== cur && !/rotated-/.test(prev!)
    const pol = await ctx.c.lambda.send(new GetPolicyCommand({ FunctionName: 'rotator' })).then((r) => r.Policy ?? '', () => '')
    const perm = pol.includes('secretsmanager.amazonaws.com')
    const versions = ranOk(h, /secretsmanager put-secret-value/) && ranOk(h, /secretsmanager get-secret-value .*--version-stage AWSPREVIOUS/)
    const breakit = ranFail(h, /secretsmanager rotate-secret/, /cannot invoke the specified Lambda function|AccessDenied/i)
    const steps = (await logsContain(ctx, '/aws/lambda/rotator', 'createSecret').catch(() => false)) && (await logsContain(ctx, '/aws/lambda/rotator', 'finishSecret').catch(() => false))
    const rp = await ctx.c.secrets.send(new GetResourcePolicyCommand({ SecretId: 'app/db' })).then((r) => r.ResourcePolicy ?? '', () => '')
    const rd = await ranAsUser(ctx, 'reader')
    const get = (r: { command: string }) => /secretsmanager get-secret-value/.test(r.command)
    const okIdx = firstIdx(rd, (r) => r.exitCode === 0 && get(r))
    const denyIdx = lastIdx(rd, (r) => r.exitCode !== 0 && get(r) && /AccessDenied|explicit deny/i.test(r.stderr))
    const policy = rp.includes('Deny') && rp.includes('reader') && okIdx >= 0 && denyIdx > okIdx
    return [
      item('versions', 'A manual version was pushed and AWSPREVIOUS read back', versions, 'Run put-secret-value, then get-secret-value --version-stage AWSPREVIOUS.'),
      item('fn', 'Function `rotator` is Active', fn?.State === 'Active', 'Run the create-function step.'),
      item('breakit', 'You saw rotation refused because Secrets Manager may not invoke the function', breakit, 'Run rotate-secret before add-permission.'),
      item('perm', 'The function policy lets secretsmanager.amazonaws.com invoke it', perm, 'Run lambda add-permission for secretsmanager.amazonaws.com.'),
      item('rotated', 'AWSCURRENT is now a `rotated-...` password', rotated, 'Run rotate-secret again and wait a few seconds.', desc?.RotationEnabled ? 'rotation enabled' : 'rotation not enabled'),
      item('previous', 'AWSPREVIOUS holds the value from before the rotation', previous, 'It appears when finishSecret moves AWSCURRENT; re-run describe-secret.'),
      item('steps', 'The function logs show createSecret and finishSecret', steps, 'Look in /aws/lambda/rotator once the rotation has run.'),
      item('policy', 'A resource-policy Deny stopped `reader` after it had read the secret', policy, 'Read as reader, put-resource-policy with secret-policy.json, read again.'),
    ]
  },
}
