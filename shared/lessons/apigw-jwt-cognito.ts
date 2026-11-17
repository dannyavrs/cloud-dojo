import type { LessonContent } from '../types'

const FLOW = '--explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH'
const PASSWORD = "'Dojo#2026pw'"

export const apigwJwtCognito: LessonContent = {
  id: 'apigw-jwt-cognito',
  n: '7.4',
  trackId: 'apigw',
  level: 'advanced',
  prereqs: ['apigw-routes-stages'],
  estMinutes: 45,
  honesty: 'live',
  honestyNote: 'The emulator issues real RS256 Cognito-style tokens and its JWT authorizer verifies issuer, audience (or client_id) and scopes, and passes the claims to the backend. The issuer is the emulator address, not cognito-idp.us-east-1.amazonaws.com.',
  examTags: ['DVA:Sec', 'DVA:Dev', 'SAA:Secure'],
  breakItCheck: 'breakit',
  httpProbe: true,
  title: 'JWT authorizer with Cognito',
  tagline: 'Sign a user in, send the token, and let API Gateway verify it with no code of yours.',
  predict: [
    { id: 'p1', prompt: 'A JWT authorizer protects `GET /notes`. A client sends a perfectly valid Cognito ID token, but the authorizer is configured with a different app client id as its audience. What does the client get?', options: ['200, the signature is valid so the audience is ignored', '401 Unauthorized', '403 Forbidden', '500 because the configuration is inconsistent'], answer: 1, explain: 'A JWT authorizer validates the signature, issuer, expiry and audience (`aud` of an ID token, `client_id` of an access token). Any mismatch is 401. 403 is reserved for a valid token that lacks the scopes the route requires.' },
    { id: 'p2', prompt: 'The same user signs in once. You send the ID token to a route that requires the scope `aws.cognito.signin.user.admin`. What happens?', options: ['200, a valid token passes every scope check', '401, scope checks happen before signature checks', '403: an ID token carries no `scope` claim, only an access token does', '500'], answer: 2, explain: 'Route scopes are matched against the `scope` or `scp` claim. Cognito ID tokens do not have it, so they fail with 403 even though the token itself is valid. Send the access token to scope-protected routes.' },
    { id: 'p3', prompt: 'What does the JWT authorizer fetch from the issuer to verify a signature?', options: ['A shared secret stored in the authorizer configuration', 'The public keys (JWKS) published at the issuer\'s well-known URL', 'It calls the Cognito `GetUser` API with the token', 'Nothing, tokens are validated by decoding them'], answer: 1, explain: 'The issuer exposes `/.well-known/openid-configuration`, which points at a JWKS document with its public keys. API Gateway verifies the RS256 signature with those keys, so there is no secret to share and no call per request to Cognito.' },
  ],
  concept: [
    'A **JWT authorizer** is the built-in way to protect an HTTP API route with tokens from any OpenID Connect provider, Cognito included. You give API Gateway two things: an **issuer** (the `iss` claim, a URL) and a list of **audiences** (the app client ids allowed). For each request API Gateway reads the token from the identity source (`$request.header.Authorization`, normally `Bearer <token>`), downloads the issuer\'s public keys from `<issuer>/.well-known/openid-configuration` and its JWKS, and checks the RS256 signature, `iss`, `exp`, `nbf` and the audience. If everything holds, the decoded claims are handed to your backend in `event.requestContext.authorizer.jwt.claims` (and `scopes`). There is no Lambda to write, run or pay for, and no cold start.',
    'Know which token goes where. Cognito issues three: the **ID token** (who the user is; `aud` is the app client id; carries `cognito:username` and any attributes; has no `scope`), the **access token** (what the client may do; `client_id` instead of `aud`; carries `scope`, for example `aws.cognito.signin.user.admin`) and the **refresh token** (opaque, only used to get new ones). A JWT authorizer matches the audience against `aud` **or** `client_id`, so either works until you add route **scopes**: scopes are checked against the `scope` claim, so an ID token then fails with **403** while an access token passes. Failure codes: missing or invalid token, wrong issuer, wrong audience or expired token is **401**; a valid token without the required scope is **403**. Tokens last one hour by default, so clients must refresh.',
    'Exam traps. The issuer must match `iss` **exactly**, character for character: for a user pool on AWS it is `https://cognito-idp.<region>.amazonaws.com/<user-pool-id>`, with no trailing slash. HTTP APIs have the JWT authorizer; **REST APIs** use a **Cognito user pool authorizer** (a different resource type, the token is validated against a pool) or a Lambda authorizer. Cognito **user pools** authenticate users and issue tokens; **identity pools** exchange tokens for temporary AWS credentials, which is a different job and a classic distractor (an identity pool is not what protects an API route). API keys are not authentication. A JWT authorizer cannot revoke a token before it expires, and it does not do fine-grained authorisation: use scopes or check claims such as `cognito:groups` in the backend.',
    'In this module the fixture gives you the API `notes` with `GET /notes` open and the echo backend `notes-fn`. You build the whole chain yourself: a user pool, an app client with the password flow, a user, and a token from `initiate-auth`. You paste the token into the HTTP probe, read the issuer from the pool\'s discovery document, create the authorizer, attach it, and call the route three ways. The break-it points the authorizer at the wrong audience, the fix puts it right, and a final step adds a route scope to show 403 versus 401. The sign-in uses the user-password flow with a fixed password, fine for a lab and not what you would ship for a browser app (use the hosted UI or SRP and PKCE).',
  ],
  goal: 'A Cognito user pool, client and user; a JWT authorizer (issuer plus audience) on `GET /notes`: 401 without a token, 200 with the ID token and its claims in the event, 401 when the audience is wrong, and 403 when a required scope is missing.',
  steps: [
    { id: 'ids', title: 'Find the API and its route', body: 'Copy `ApiId` and `ApiEndpoint` from the first command and the `RouteId` of `GET /notes` from the second. Send **GET** `<ApiEndpoint>/notes` from the HTTP probe: today it answers 200 to anyone.', commands: ['aws apigatewayv2 get-apis --query "Items[].[ApiId,ApiEndpoint]" --output text', 'aws apigatewayv2 get-routes --api-id <API_ID> --query "Items[].[RouteKey,RouteId]" --output text'] },
    { id: 'pool', title: 'Create a user pool and an app client', body: 'The pool holds users. The app client is the thing that signs them in, and its id becomes the **audience**. Copy the pool id (like `us-east-1_xxxx`) and the client id.', commands: ['aws cognito-idp create-user-pool --pool-name dojo-users --query UserPool.Id --output text', `aws cognito-idp create-user-pool-client --user-pool-id <POOL_ID> --client-name web ${FLOW} --query UserPoolClient.ClientId --output text`] },
    { id: 'user', title: 'Create a user with a permanent password', body: '`SUPPRESS` skips the invitation message. `--permanent` skips the forced password change on first sign-in.', commands: ['aws cognito-idp admin-create-user --user-pool-id <POOL_ID> --username danny --message-action SUPPRESS', `aws cognito-idp admin-set-user-password --user-pool-id <POOL_ID> --username danny --password ${PASSWORD} --permanent`] },
    { id: 'token', title: 'Sign in and get the ID token', body: 'Copy the whole output (about 900 characters, three dot-separated parts). In the probe panel you will send it as the header `Authorization: Bearer <token>`.', commands: [`aws cognito-idp initiate-auth --client-id <CLIENT_ID> --auth-flow USER_PASSWORD_AUTH --auth-parameters USERNAME=danny,PASSWORD=${PASSWORD} --query AuthenticationResult.IdToken --output text`] },
    { id: 'issuer', title: 'Read the issuer from the discovery document', body: 'In the probe panel GET `https://127.0.0.1:9297/<POOL_ID>/.well-known/openid-configuration` (use your emulator address if it is not 9297). Copy the `issuer` value: that string, exactly, is what the authorizer must be configured with. It also shows `jwks_uri`, where API Gateway gets the signing keys.' },
    { id: 'authorizer', title: 'Create the JWT authorizer', body: 'Type JWT, the same header as identity source, and a `--jwt-configuration` with the audience (your client id) and the issuer you just copied. Copy `AuthorizerId`.', commands: ["aws apigatewayv2 create-authorizer --api-id <API_ID> --name cognito-jwt --authorizer-type JWT --identity-source '$request.header.Authorization' --jwt-configuration Audience=<CLIENT_ID>,Issuer=<ISSUER>"] },
    { id: 'attach', title: 'Protect the route', body: 'The authorization type for a JWT authorizer is `JWT`.', commands: ['aws apigatewayv2 update-route --api-id <API_ID> --route-id <ROUTE_ID> --authorization-type JWT --authorizer-id <AUTHORIZER_ID>'] },
    { id: 'try', title: 'Call it with and without a token', body: 'From the probe, GET `<ApiEndpoint>/notes` (1) with no headers: **401**; (2) with the header `Authorization: Bearer <token>`: **200**. Read the body: `auth.jwt.claims` holds `sub`, `iss`, `aud`, `cognito:username`, `token_use` and more, which is everything your backend gets for free. Allow 2 seconds after the route update.' },
    { id: 'break', title: 'Break it: the wrong audience', body: 'Point the authorizer at an app client that is not yours, then repeat the GET with your perfectly valid token: **401**. The signature is fine, the audience is not.', commands: ['aws apigatewayv2 update-authorizer --api-id <API_ID> --authorizer-id <AUTHORIZER_ID> --jwt-configuration Audience=not-my-client,Issuer=<ISSUER>'], breakIt: true },
    { id: 'fix', title: 'Fix it', body: 'Restore the real client id as the audience and send the same token again: **200**.', commands: ['aws apigatewayv2 update-authorizer --api-id <API_ID> --authorizer-id <AUTHORIZER_ID> --jwt-configuration Audience=<CLIENT_ID>,Issuer=<ISSUER>'] },
    { id: 'scope', title: 'Require a scope: 403 versus 401', body: 'Require the scope `aws.cognito.signin.user.admin` on the route, then GET with the **ID token**: **403** (valid token, but ID tokens have no scope). Get the **access token** with the second command and GET with that: **200**, and the body now lists `scopes`. Note the wording of the failure: a missing scope is 403, a bad token is 401.', commands: ['aws apigatewayv2 update-route --api-id <API_ID> --route-id <ROUTE_ID> --authorization-type JWT --authorizer-id <AUTHORIZER_ID> --authorization-scopes aws.cognito.signin.user.admin', `aws cognito-idp initiate-auth --client-id <CLIENT_ID> --auth-flow USER_PASSWORD_AUTH --auth-parameters USERNAME=danny,PASSWORD=${PASSWORD} --query AuthenticationResult.AccessToken --output text`] },
  ],
  breakIt: {
    title: 'A valid token for the wrong audience',
    command: 'aws apigatewayv2 update-authorizer --api-id <API_ID> --authorizer-id <AUTHORIZER_ID> --jwt-configuration Audience=not-my-client,Issuer=<ISSUER>',
    explain: [
      'The token did not change and its signature is still valid, but its `aud` is your app client id and the authorizer now only accepts `not-my-client`. API Gateway answers a bare `401 Unauthorized` with no reason, so the failing audience is easy to miss. Wrong issuer behaves the same way, and so does an expired token.',
      'On real AWS the usual culprits are an issuer with a trailing slash or the wrong region in the URL, a token from a different app client (a mobile client and a web client in one pool have different ids, both must be listed as audiences), and clock skew on a token that has just expired.',
    ],
  },
  realAws: {
    cost: [
      'JWT authorization adds no charge beyond the API request itself (HTTP APIs, about $1.00 per million requests, us-east-1, see the pricing page). Cognito user pools bill per monthly active user after a free tier (check the Cognito pricing page for current numbers; the Lite tier and free allowance have changed over time).',
    ],
    differences: [
      'The real issuer is `https://cognito-idp.us-east-1.amazonaws.com/<pool-id>`. On the emulator it is `https://127.0.0.1:<port>/<pool-id>` (the port you reach the emulator on, 9297 by default), so the issuer you configure must be read from the token or the discovery document, not guessed.',
      'Real Cognito can add a hosted UI, MFA, custom attributes, groups (`cognito:groups` in the token), Lambda triggers and an authorization-code flow with PKCE. This module only uses the password flow with admin-created users.',
      'The emulator accepted a token sent without the `Bearer ` prefix. Treat the prefix as required in real clients.',
      'Token lifetimes, key rotation and the exact JWKS caching behaviour of API Gateway were not measured here.',
    ],
    asOf: '2026-11-15',
    sources: [
      { label: 'JWT authorizers for HTTP APIs', url: 'https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html' },
      { label: 'Using tokens with Amazon Cognito user pools', url: 'https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-with-identity-providers.html' },
      { label: 'Amazon Cognito pricing', url: 'https://aws.amazon.com/cognito/pricing/' },
    ],
  },
  fidelity: [{ service: 'API Gateway v2 (HTTP APIs)', pass: 156, total: 277 }],
  files: ['handler.mjs', 'notes-fn.zip'],
  probeNote: 'These checks read the calls you made from the HTTP probe panel in this module. Pressing Check sends nothing new.',
  checks: [
    { id: 'pool', label: 'A user pool with a password-flow app client and the user `danny` exists', hint: 'Create the pool, the client (ALLOW_USER_PASSWORD_AUTH) and the user.' },
    { id: 'token', label: 'You signed in and received an ID token', hint: 'Run initiate-auth with --query AuthenticationResult.IdToken.' },
    { id: 'authorizer', label: 'A JWT authorizer lists your client id as audience and your pool as issuer', hint: 'Run create-authorizer with --jwt-configuration Audience=<client>,Issuer=<issuer>.' },
    { id: 'route', label: 'Route `GET /notes` uses the JWT authorizer', hint: 'Run update-route with --authorization-type JWT and the authorizer id.' },
    { id: 'notoken', label: 'GET without a token was refused with 401', hint: 'Send GET <ApiEndpoint>/notes from the probe with no headers.' },
    { id: 'allowed', label: 'GET with the ID token got 200 and the claims in the event', hint: 'Send GET with the header `Authorization: Bearer <IdToken>`.' },
    { id: 'breakit', label: 'With the wrong audience the valid token was refused with 401', hint: 'Run the break-it update-authorizer, then GET with your token.' },
    { id: 'fixed', label: 'The audience is correct again and the token works (200 after the 401)', hint: 'Run the fix update-authorizer, then GET with your token.' },
    { id: 'scope', label: 'A required scope gave 403 for the ID token and 200 for the access token', hint: 'Add --authorization-scopes to the route, GET with the ID token, then with the access token.' },
  ],
}
