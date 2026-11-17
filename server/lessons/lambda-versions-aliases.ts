import { GetAliasCommand, ListVersionsByFunctionCommand } from '@aws-sdk/client-lambda'
import { V1_HANDLER } from '../../shared/lessons/lambda-versions-aliases'
import { item, ranFail, type LessonServer } from '../lesson-kit'
import { fnConfig, sdkInvoke, seedRole } from './lambda-kit'

export const lambdaVersionsAliases: LessonServer = {
  id: 'lambda-versions-aliases',
  files: { 'handler.mjs': V1_HANDLER },
  zips: { 'handler.zip': { 'handler.mjs': V1_HANDLER } },
  async fixture(ctx) { await seedRole(ctx) },
  async check(ctx, { probe }) {
    const h = ctx.history
    const fn = await fnConfig(ctx, 'release')
    const versions = (await ctx.c.lambda.send(new ListVersionsByFunctionCommand({ FunctionName: 'release' })).catch(() => undefined))?.Versions ?? []
    const published = versions.filter((v) => v.Version !== '$LATEST')
    const shas = new Set(published.map((v) => v.CodeSha256))
    const alias = await ctx.c.lambda.send(new GetAliasCommand({ FunctionName: 'release', Name: 'live' })).catch(() => undefined)
    const w = alias?.RoutingConfig?.AdditionalVersionWeights?.['2']
    const canary = alias?.FunctionVersion === '1' && typeof w === 'number' && w > 0 && w < 1
    let split: boolean | null = null
    let detail = 'press Check'
    if (probe) {
      const seen = new Set<string>()
      for (let i = 0; i < 16 && canary; i++) { const r = await sdkInvoke(ctx, 'release', {}, 'live'); if (r.ok && r.version) seen.add(r.version) }
      split = canary && seen.has('1') && seen.has('2')
      detail = canary ? `versions seen: ${[...seen].join(', ') || 'none'}` : 'no weighted alias yet'
    }
    return [
      item('fn', 'Function `release` is Active', fn?.State === 'Active', 'Run the create step.'),
      item('versions', 'Versions 1 and 2 are published with different code', published.some((v) => v.Version === '1') && published.some((v) => v.Version === '2') && shas.size >= 2, 'Publish v1, edit handler.mjs, update-function-code, publish v2.', `published: ${published.map((v) => v.Version).join(', ') || 'none'}`),
      item('alias', 'Alias `live` exists and has version 1 as its primary version', Boolean(alias) && (alias?.FunctionVersion === '1' || canary), 'Run create-alias with --function-version 1.', alias ? `-> ${alias.FunctionVersion}` : 'no alias'),
      item('breakit', 'You saw Lambda refuse to update the configuration of version 1', ranFail(h, /update-function-configuration[\s\S]*release:1/, /unpublished|\$LATEST|published version/i), 'Run the break-it command.'),
      item('canary', 'The alias routes a share of traffic to version 2', canary, 'Run update-alias with the routing-config JSON.', w === undefined ? 'no routing config' : `version 2 weight ${w}`),
      { ...item('split', 'Over 16 invokes through `release:live`, both version 1 and version 2 answered', split, 'Press Check after the canary is set; it needs the weighted alias.', detail), pass: split },
    ]
  },
}
