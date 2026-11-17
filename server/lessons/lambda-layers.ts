import { ListLayerVersionsCommand } from '@aws-sdk/client-lambda'
import { LAYERS_STARTER, LAYER_FILES } from '../../shared/lessons/lambda-layers'
import { item, ranOk, type LessonServer } from '../lesson-kit'
import { fnConfig, readJson, readWork, sdkInvoke, seedRole } from './lambda-kit'

export const lambdaLayers: LessonServer = {
  id: 'lambda-layers',
  files: { 'handler.mjs': LAYERS_STARTER },
  zips: { 'handler.zip': { 'handler.mjs': LAYERS_STARTER }, 'layer.zip': LAYER_FILES },
  async fixture(ctx) { await seedRole(ctx) },
  async check(ctx) {
    const h = ctx.history
    const lv = (await ctx.c.lambda.send(new ListLayerVersionsCommand({ LayerName: 'greet' })).catch(() => undefined))?.LayerVersions ?? []
    const fn = await fnConfig(ctx, 'greeter')
    const ok = readJson(ctx, 'ok.json')
    const broken = readWork(ctx, 'broken.json')
    const sawBreak = /ImportModuleError/.test(broken)
    const attached = (fn?.Layers ?? []).some((l) => /:layer:greet:\d+$/.test(l.Arn ?? ''))
    const live = attached ? await sdkInvoke(ctx, 'greeter') : undefined
    return [
      item('layer', 'Layer `greet` has a published version', lv.length > 0, 'Run the publish-layer-version step.'),
      item('fn', 'Function `greeter` is Active and was created with the layer attached', fn?.State === 'Active' && ranOk(ctx.history, /create-function[\s\S]*--layers\s+arn:aws:lambda:\S+:layer:greet:\d+/), 'Edit handler.mjs, then create the function with --layers <LAYER_ARN>.', fn ? fn.State : 'not created'),
      item('works', 'The first invoke returned a message "from a layer"', typeof ok === 'string' && ok.includes('from a layer'), 'Invoke greeter and write the output to ok.json.', ok === undefined ? 'no ok.json yet' : JSON.stringify(ok)),
      item('breakit', 'You saw Runtime.ImportModuleError after removing the layer', sawBreak && ranOk(h, /update-function-configuration[\s\S]*greeter[\s\S]*--layers\s*$/), 'Run the break-it step; the error is in broken.json.'),
      item('fixed', 'The layer is attached again and the function works', sawBreak && attached && Boolean(live?.ok && typeof live.body === 'string' && live.body.includes('from a layer')), 'Run the fix step.', attached ? 'layer attached' : 'no layer attached'),
    ]
  },
}
