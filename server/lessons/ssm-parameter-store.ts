import { CreateAliasCommand, CreateKeyCommand } from '@aws-sdk/client-kms'
import { PutUserPolicyCommand } from '@aws-sdk/client-iam'
import { DescribeParametersCommand, GetParameterCommand } from '@aws-sdk/client-ssm'
import { READER_KMS } from '../../shared/lessons/ssm-parameter-store'
import { item, ranFail, ranOk, type LessonServer } from '../lesson-kit'
import { firstIdx, lastIdx, makeUsers, ranAsUser } from './iam-kit'
import { policyDoc } from './kit2'

const PASSWORD = 'Sup3rS3cret!'

export const ssmParameterStore: LessonServer = {
  id: 'ssm-parameter-store',
  files: { 'reader-kms.json': READER_KMS },
  async fixture(ctx) {
    const k = await ctx.c.kms.send(new CreateKeyCommand({ Description: 'app-config' }))
    await ctx.c.kms.send(new CreateAliasCommand({ AliasName: 'alias/app-config', TargetKeyId: k.KeyMetadata!.KeyId }))
    await makeUsers(ctx, 'reader')
    await ctx.c.iam.send(new PutUserPolicyCommand({
      UserName: 'reader', PolicyName: 'ssm-read',
      PolicyDocument: policyDoc([{ Effect: 'Allow', Action: ['ssm:GetParameter', 'ssm:GetParameters', 'ssm:GetParametersByPath'], Resource: '*' }]),
    }))
  },
  async check(ctx) {
    const h = ctx.history
    const all = (await ctx.c.ssm.send(new DescribeParametersCommand({ MaxResults: 50 })).catch(() => undefined))?.Parameters ?? []
    const byName = new Map(all.map((p) => [p.Name!, p]))
    const params = byName.get('/shop/prod/log-level')?.Type === 'String' && byName.get('/shop/prod/db-password')?.Type === 'SecureString' && byName.get('/shop/dev/db-password')?.Type === 'SecureString'
    // Ciphertext trap: the command succeeded, had no --with-decryption, and the output is not the plaintext.
    const breakit = ranOk(h, /ssm get-parameter .*\/shop\/prod\/db-password/, (o) => o.trim().length > 20 && o.trim() !== PASSWORD) && h.some((r) => r.exitCode === 0 && /ssm get-parameter .*\/shop\/prod\/db-password/.test(r.command) && !/--with-decryption/.test(r.command) && r.stdout.trim() !== PASSWORD)
    const decrypted = ranOk(h, /ssm get-parameter .*--with-decryption/, (o) => o.trim() === PASSWORD)
    const path = ranOk(h, /get-parameters-by-path --path \/shop\/prod\b(?!.*--recursive)/, (o) => o.trim() === '2') && ranOk(h, /get-parameters-by-path --path \/shop(?!\/)(?!.*--recursive)/, (o) => o.trim() === '0') && ranOk(h, /get-parameters-by-path --path \/shop(?!\/).*--recursive/, (o) => o.trim() === '3')
    const lvl = (await ctx.c.ssm.send(new GetParameterCommand({ Name: '/shop/prod/log-level' })).catch(() => undefined))?.Parameter
    const exists = ranFail(h, /ssm put-parameter .*\/shop\/prod\/log-level/, /ParameterAlreadyExists/)
    const versions = (lvl?.Version ?? 0) >= 2 && exists
    const api = byName.get('/shop/prod/api-key')
    const cmk = api?.Type === 'SecureString' && /app-config/.test(api.KeyId ?? '')
    const rd = await ranAsUser(ctx, 'reader')
    const read = (r: { command: string }) => /ssm get-parameter .*\/shop\/prod\/api-key/.test(r.command)
    const failIdx = firstIdx(rd, (r) => r.exitCode !== 0 && read(r) && /kms:Decrypt|AccessDenied/i.test(r.stderr))
    const okAfter = failIdx >= 0 && lastIdx(rd, (r) => r.exitCode === 0 && read(r)) > failIdx
    return [
      item('params', 'Three parameters exist under /shop: one String and two SecureStrings', params, 'Run the three put-parameter commands in step 2.', `${all.length} parameter(s) in the account`),
      item('breakit', 'You read a SecureString without decryption and got ciphertext', breakit, 'Run the break-it command (no --with-decryption).'),
      item('decrypted', 'You read the same SecureString with --with-decryption', decrypted, 'Add --with-decryption to get the plaintext.'),
      item('path', 'By-path reads returned 2 for /shop/prod, 0 for /shop and 3 with --recursive', path, 'Run the three get-parameters-by-path commands.'),
      item('versions', '`/shop/prod/log-level` is at version 2 after you saw ParameterAlreadyExists', versions, 'Run put-parameter twice: without --overwrite (fails) and with it.', `version ${lvl?.Version ?? 'none'}`),
      item('cmk', '`/shop/prod/api-key` is a SecureString encrypted with `alias/app-config`', cmk, 'Put it with --key-id alias/app-config.'),
      item('gate', '`reader` was refused on the CMK parameter until it got kms:Decrypt', okAfter, 'Read as reader (fails), attach reader-kms.json, read as reader again.'),
    ]
  },
}
