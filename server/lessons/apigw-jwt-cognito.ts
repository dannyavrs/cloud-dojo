import { AdminGetUserCommand, ListUserPoolClientsCommand, ListUserPoolsCommand } from '@aws-sdk/client-cognito-identity-provider'
import { item, ranOk, type LessonServer } from '../lesson-kit'
import { authorizersOf, echoOf, findApi, NOTES_ZIP, probesAt, routesOf, seedHttpApi, seedNotesFn } from './apigw-kit'
import { NOTES_HANDLER } from '../../shared/lessons/apigw-sources'

export const apigwJwtCognito: LessonServer = {
  id: 'apigw-jwt-cognito',
  files: { 'handler.mjs': NOTES_HANDLER },
  zips: NOTES_ZIP,
  async fixture(ctx) {
    await seedNotesFn(ctx)
    await seedHttpApi(ctx, ['GET /notes'])
  },
  async check(ctx) {
    const h = ctx.history
    const api = await findApi(ctx)
    const pool = (await ctx.c.cognito.send(new ListUserPoolsCommand({ MaxResults: 20 })).catch(() => undefined))?.UserPools?.find((p) => p.Name === 'dojo-users')
    const clients = pool?.Id ? ((await ctx.c.cognito.send(new ListUserPoolClientsCommand({ UserPoolId: pool.Id, MaxResults: 20 })).catch(() => undefined))?.UserPoolClients ?? []) : []
    const clientId = clients[0]?.ClientId
    const danny = pool?.Id ? await ctx.c.cognito.send(new AdminGetUserCommand({ UserPoolId: pool.Id, Username: 'danny' })).catch(() => undefined) : undefined
    const authz = (await authorizersOf(ctx, api?.ApiId)).find((a) => a.AuthorizerType === 'JWT')
    const jwt = authz?.JwtConfiguration
    const authzOk = Boolean(clientId && pool?.Id && jwt?.Audience?.includes(clientId) && jwt.Issuer?.endsWith(`/${pool.Id}`) && !jwt.Issuer.endsWith(`/${pool.Id}/`))
    const route = (await routesOf(ctx, api?.ApiId)).find((r) => r.RouteKey === 'GET /notes')
    const gets = probesAt(ctx, api?.ApiEndpoint ? `${api.ApiEndpoint}/notes` : undefined, 'GET')
    // the first command that pointed the authorizer at a client id that is not the learner's
    const wrong = h.find((r) => !r.rejected && r.exitCode === 0 && /update-authorizer/.test(r.command) && clientId && !r.command.includes(`Audience=${clientId}`) && /Audience=/.test(r.command))
    const noToken = gets.some((p) => p.status === 401 && (!wrong || p.at < wrong.at))
    const claims = (p: { body: string; status: number }) => (p.status === 200 ? echoOf(p as never)?.auth?.jwt : undefined)
    const allowed = gets.some((p) => claims(p)?.claims?.['cognito:username'] === 'danny' && claims(p)?.claims?.token_use === 'id')
    const refused = wrong ? gets.find((p) => p.status === 401 && p.at > wrong.at) : undefined
    const fixed = Boolean(refused && authzOk && gets.some((p) => p.status === 200 && p.at > refused.at && claims(p)))
    const scope403 = gets.some((p) => p.status === 403)
    const scope200 = gets.some((p) => claims(p)?.scopes?.includes('aws.cognito.signin.user.admin'))
    return [
      item('pool', 'A user pool with a password-flow app client and the user `danny` exists', Boolean(pool && clients.some((c) => c.ClientName === 'web') && danny), 'Create the pool, the client (ALLOW_USER_PASSWORD_AUTH) and the user.', pool ? `${pool.Id}, ${clients.length} client(s)` : 'no pool'),
      item('token', 'You signed in and received an ID token', ranOk(h, /cognito-idp initiate-auth[\s\S]*IdToken/, (o) => o.trim().split('.').length === 3), 'Run initiate-auth with --query AuthenticationResult.IdToken.'),
      item('authorizer', 'A JWT authorizer lists your client id as audience and your pool as issuer', authzOk, 'Run create-authorizer with --jwt-configuration Audience=<client>,Issuer=<issuer>.', jwt ? `aud ${jwt.Audience?.join(',')} iss ${jwt.Issuer}` : 'no JWT authorizer yet'),
      item('route', 'Route `GET /notes` uses the JWT authorizer', Boolean(authz && route?.AuthorizationType === 'JWT' && route.AuthorizerId === authz.AuthorizerId), 'Run update-route with --authorization-type JWT and the authorizer id.', route?.AuthorizationType ?? 'no route'),
      item('notoken', 'GET without a token was refused with 401', noToken, 'Send GET <ApiEndpoint>/notes from the probe with no headers.'),
      item('allowed', 'GET with the ID token got 200 and the claims in the event', allowed, 'Send GET with the header `Authorization: Bearer <IdToken>`.'),
      item('breakit', 'With the wrong audience the valid token was refused with 401', Boolean(refused), 'Run the break-it update-authorizer, then GET with your token.'),
      item('fixed', 'The audience is correct again and the token works (200 after the 401)', fixed, 'Run the fix update-authorizer, then GET with your token.'),
      item('scope', 'A required scope gave 403 for the ID token and 200 for the access token', Boolean(scope403 && scope200 && (route?.AuthorizationScopes ?? []).includes('aws.cognito.signin.user.admin')), 'Add --authorization-scopes to the route, GET with the ID token, then with the access token.'),
    ]
  },
}
