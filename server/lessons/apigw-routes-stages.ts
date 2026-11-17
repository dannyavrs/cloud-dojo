import { NOTES_HANDLER } from '../../shared/lessons/apigw-sources'
import { GetIntegrationsCommand } from '@aws-sdk/client-apigatewayv2'
import { item, type LessonServer } from '../lesson-kit'
import { apigwMayInvoke, echoOf, findApi, NOTES_ZIP, probesAt, routesOf, seedNotesFn, stagesOf } from './apigw-kit'

export const apigwRoutesStages: LessonServer = {
  id: 'apigw-routes-stages',
  files: { 'handler.mjs': NOTES_HANDLER },
  zips: NOTES_ZIP,
  fixture: seedNotesFn,
  async check(ctx) {
    const api = await findApi(ctx)
    const routes = await routesOf(ctx, api?.ApiId)
    const stages = await stagesOf(ctx, api?.ApiId)
    const ints = api?.ApiId ? ((await ctx.c.apigw.send(new GetIntegrationsCommand({ ApiId: api.ApiId })).catch(() => undefined))?.Items ?? []) : []
    const route = routes.find((r) => r.RouteKey === 'GET /notes/{id}')
    const routeInt = ints.find((i) => route?.Target === `integrations/${i.IntegrationId}`)
    const dev = stages.find((s) => s.StageName === 'dev')
    const base = api?.ApiEndpoint
    const hits = probesAt(ctx, base)
    const call = hits.some((p) => { const j = echoOf(p); return p.method === 'GET' && p.status === 200 && p.url.includes('/dev/notes/42') && j?.id === '42' && j?.stage === 'dev' && j?.sv?.env === 'dev' })
    const unrouted = hits.find((p) => p.method === 'DELETE' && p.status === 404)
    const catchAll = hits.some((p) => p.method !== 'GET' && p.status === 200 && echoOf(p)?.route === '$default' && (!unrouted || p.at >= unrouted.at))
    const prod = hits.some((p) => { const j = echoOf(p); return p.status === 200 && j?.stage === 'prod' && j?.sv?.env === 'prod' })
    return [
      item('api', 'An HTTP API `notes` exists', Boolean(api), 'Run the create-api step.', base),
      item('route', 'Route `GET /notes/{id}` targets a Lambda integration for `notes-fn`', Boolean(routeInt?.IntegrationUri?.endsWith(':function:notes-fn')), 'Create the integration, then the route with --target integrations/<id>.', route ? route.Target : 'no such route'),
      item('stage', 'Stage `dev` auto-deploys and carries the variable env=dev', Boolean(dev?.AutoDeploy && dev.StageVariables?.env === 'dev'), 'Run create-stage with --auto-deploy and --stage-variables env=dev.', dev ? `autoDeploy ${dev.AutoDeploy}, vars ${JSON.stringify(dev.StageVariables ?? {})}` : 'no dev stage'),
      item('perm', 'Lambda allows apigateway.amazonaws.com to invoke `notes-fn`', await apigwMayInvoke(ctx, 'notes-fn'), 'Run the add-permission step.'),
      item('call', 'GET /dev/notes/42 returned 200 with id 42, stage dev and env dev', call, 'Send the GET from the HTTP probe panel, with /dev in the path.'),
      item('breakit', 'DELETE on the unrouted method got 404', Boolean(unrouted), 'Send DELETE <ApiEndpoint>/dev/notes/42 from the probe panel before adding a $default route.'),
      item('default', 'A $default route exists and the same DELETE now reaches the function as $default', routes.some((r) => r.RouteKey === '$default') && catchAll, 'Create the $default route, then repeat the DELETE from the probe panel.'),
      item('prod', 'The prod stage answered with stage prod and env prod', prod, 'Create the prod stage, then GET /prod/notes/7 from the probe panel.'),
    ]
  },
}
