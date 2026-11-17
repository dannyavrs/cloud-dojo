import { AUTHZ_HANDLER } from '../../shared/lessons/apigw-sources'
import { createFunction } from './kit2'
import { item, type LessonServer } from '../lesson-kit'
import { sdkInvoke } from './lambda-kit'
import { apigwMayInvoke, authorizersOf, echoOf, findApi, NOTES_ZIP, probesAt, routesOf, seedHttpApi, seedNotesFn } from './apigw-kit'

export const apigwLambdaAuthorizer: LessonServer = {
  id: 'apigw-lambda-authorizer',
  files: { 'authz.mjs': AUTHZ_HANDLER },
  zips: { ...NOTES_ZIP, 'authz.zip': { 'authz.mjs': AUTHZ_HANDLER } },
  async fixture(ctx) {
    await seedNotesFn(ctx)
    await createFunction(ctx, 'authz', 'authz.handler', 'authz.zip', 'lambda-exec')
    await seedHttpApi(ctx, ['POST /notes'])
  },
  async check(ctx) {
    const api = await findApi(ctx)
    const authz = (await authorizersOf(ctx, api?.ApiId)).find((a) => a.AuthorizerType === 'REQUEST' && a.AuthorizerUri?.includes(':function:authz/'))
    const authzOk = Boolean(authz?.EnableSimpleResponses && authz.IdentitySource?.some((s) => /header\.authorization/i.test(s)) && authz.AuthorizerPayloadFormatVersion === '2.0')
    const route = (await routesOf(ctx, api?.ApiId)).find((r) => r.RouteKey === 'POST /notes')
    const posts = probesAt(ctx, api?.ApiEndpoint ? `${api.ApiEndpoint}/notes` : undefined, 'POST')
    const seen = (status: number) => posts.some((p) => p.status === status)
    const allowed = posts.some((p) => p.status === 200 && echoOf(p)?.auth?.lambda?.user === 'danny')
    const broken = seen(500)
    // the function itself, invoked directly, so the API cache cannot mask the answer
    const yes = await sdkInvoke(ctx, 'authz', { headers: { authorization: 'let-me-in' } })
    const no = await sdkInvoke(ctx, 'authz', { headers: { authorization: 'nope' } })
    const handlerOk = yes.ok && no.ok && (yes.body as any)?.isAuthorized === true && (no.body as any)?.isAuthorized === false && !yes.functionError
    return [
      item('authorizer', 'A REQUEST authorizer with simple responses reads the Authorization header', authzOk, 'Run create-authorizer with --enable-simple-responses and the header identity source.', authz ? `${authz.AuthorizerType}, simple ${authz.EnableSimpleResponses}` : 'no authorizer for authz yet'),
      item('perm', 'Lambda allows apigateway.amazonaws.com to invoke `authz`', await apigwMayInvoke(ctx, 'authz'), 'Run the add-permission step for authz.'),
      item('route', 'Route `POST /notes` uses the CUSTOM authorizer', Boolean(authz && route?.AuthorizationType === 'CUSTOM' && route.AuthorizerId === authz.AuthorizerId), 'Run update-route with --authorization-type CUSTOM and the authorizer id.', route ? `${route.AuthorizationType ?? 'NONE'}` : 'no route'),
      item('noheader', 'POST without a header was refused with 401', seen(401), 'Send POST <ApiEndpoint>/notes from the probe with no headers.'),
      item('denied', 'POST with a wrong header was refused with 403', seen(403), 'Send POST with the header `Authorization: nope`.'),
      item('allowed', 'POST with `Authorization: let-me-in` got 200 with context.user from the authorizer', allowed, 'Send POST with the header `Authorization: let-me-in`.'),
      item('breakit', 'A wrong-shaped authorizer response produced a 500', broken, 'Deploy the broken authz.mjs, then POST with a header value you have not used before.'),
      item('fixed', '`authz` is fixed again (after you saw the 500)', broken && handlerOk, 'Restore the working authz.mjs and run update-function-code again.', handlerOk ? 'authz answers correctly' : 'authz does not return isAuthorized'),
    ]
  },
}
