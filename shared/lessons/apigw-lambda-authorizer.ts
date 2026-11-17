import type { LessonContent } from '../types'
import { AUTHZ_BROKEN, AUTHZ_HANDLER } from './apigw-sources'

const AUTHZ_URI = 'arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/arn:aws:lambda:us-east-1:000000000000:function:authz/invocations'
const UPDATE_AUTHZ = 'aws lambda update-function-code --function-name authz --zip-file fileb://authz.zip'

export const apigwLambdaAuthorizer: LessonContent = {
  id: 'apigw-lambda-authorizer',
  n: '7.3',
  trackId: 'apigw',
  level: 'advanced',
  prereqs: ['apigw-routes-stages'],
  estMinutes: 40,
  honesty: 'live',
  honestyNote: 'The emulator runs your authorizer function, enforces the simple-response contract, passes `context` to the backend and caches decisions. It does not enforce the Lambda permission that lets API Gateway invoke the authorizer, so forgetting `add-permission` does not break anything here (it does on real AWS).',
  examTags: ['DVA:Sec', 'DVA:Dev', 'SAA:Secure'],
  breakItCheck: 'breakit',
  httpProbe: true,
  editable: ['authz.mjs'],
  title: 'A Lambda authorizer with simple responses',
  tagline: 'Let your own code decide who may call `POST /notes`, and learn how a cached decision hides a bug.',
  predict: [
    { id: 'p1', prompt: 'A route has a REQUEST Lambda authorizer whose identity source is `$request.header.Authorization`. A client calls the route with no Authorization header at all. What happens?', options: ['The authorizer runs with an empty token and usually denies, so 403', '401 Unauthorized: a missing identity source is rejected before the authorizer runs', '200: an empty header counts as anonymous access', '500: the authorizer crashes on the missing header'], answer: 1, explain: 'If any identity source is missing, API Gateway answers 401 itself and never invokes the Lambda function, so it costs nothing. A header that is present but rejected by the function gives 403.' },
    { id: 'p2', prompt: 'With simple responses enabled, which return value from the authorizer lets the request through and passes `user` to the backend?', options: ['`{ "principalId": "u", "policyDocument": {...Allow...} }`', '`{ "isAuthorized": true, "context": { "user": "danny" } }`', '`{ "statusCode": 200, "body": "ok" }`', '`true`'], answer: 1, explain: 'For HTTP APIs with payload format 2.0 and `--enable-simple-responses`, the function returns `isAuthorized` (boolean) and an optional flat `context` map. The IAM-policy shape is for REST API authorizers (and for HTTP APIs only when simple responses are off).' },
    { id: 'p3', prompt: 'You fix a broken authorizer function and redeploy it. A client retries with the SAME Authorization header value as before, within the default cache TTL. What does it see?', options: ['The fixed behaviour, redeploying clears the cache', 'The old cached decision, until the TTL runs out', 'A 429 because the same token was reused', 'A 401 until the client gets a new token'], answer: 1, explain: 'Authorizer results are cached per identity-source value for the TTL (default 300 seconds, 0 disables it). A redeploy does not flush the cache, so bugs and fixes both lag behind. Test with a value the cache has not seen, or set the TTL to 0 while debugging.' },
  ],
  concept: [
    'A **Lambda authorizer** lets your own function decide whether a request may reach a route. API Gateway extracts the **identity source** (here the `Authorization` header), calls the function with the request details, and acts on the answer. HTTP APIs support the **simple response** format: the function returns `{ "isAuthorized": true|false, "context": { ... } }`. `context` is a flat map of strings, numbers and booleans that arrives in the backend as `event.requestContext.authorizer.lambda`, which is how you pass a user id or tenant to your business code without re-parsing a token. The older **IAM-policy response** (`principalId` plus `policyDocument`) is what REST API authorizers return, and what you must return from an HTTP API authorizer only when simple responses are turned off.',
    'The three outcomes you must be able to tell apart: **401 Unauthorized** means API Gateway never ran your function because an identity source was missing; **403 Forbidden** means the function ran and said no (`isAuthorized: false`, or an explicit Deny); **500** means the authorizer itself failed (it threw, timed out, or returned the wrong shape). There are two authorizer types: **REQUEST** (sees headers, query string, stage variables, context, and can combine several identity sources) and **TOKEN** (REST APIs only, one header, regex validation). A REQUEST authorizer with simple responses is the cheapest custom option on an HTTP API, because it costs one Lambda invoke per cache miss.',
    'Exam traps. First, **caching**: results are cached per combination of identity-source values for `authorizer-result-ttl-in-seconds` (default 300, maximum 3600, 0 turns it off). Revoking a token does not take effect until the cache entry expires, and a changed function does not flush it. Second, **permissions**: API Gateway needs a resource-based policy on the authorizer function (`lambda add-permission`, principal `apigateway.amazonaws.com`, source ARN `.../authorizers/<id>`), separate from the permission on the backend function, or real AWS answers 500. Third, authorizers are attached **per route**, so a route you forgot stays public. Fourth, when the identity is an OIDC token from Cognito or any OIDC provider, prefer the built-in **JWT authorizer** (module 7.4): no Lambda to run, no cold starts, no code to get wrong. Use a Lambda authorizer when the decision needs your own data (an API-key table, a tenant lookup) or a non-standard token.',
    'In this module the fixture gives you the API `notes` with `POST /notes` open to everyone, the backend `notes-fn` and the authorizer function `authz` (it allows exactly the header value `let-me-in` and passes `user: danny`). You attach it to the route and call it three ways from the HTTP probe, then break it on purpose by redeploying `authz` with the wrong response shape. The emulator caches decisions like the real service, which makes the break-it instructive: the broken function is invisible for header values that were already cached, so you probe with a fresh value.',
  ],
  goal: 'Route `POST /notes` protected by a REQUEST authorizer: 401 without a header, 403 for a wrong one, 200 with `context.user` for the right one, and a 500 you caused with a wrong-shaped authorizer response and then fixed.',
  steps: [
    { id: 'look', title: 'Read the authorizer function', body: 'The fixture created the API `notes` (stage `$default`, route `POST /notes`, no protection yet), the backend `notes-fn`, and `authz`. Open `authz.mjs`: it returns `isAuthorized: true` only for the exact header value `let-me-in`, and a `context` with `user`.' },
    { id: 'ids', title: 'Find the API and its route', body: 'Copy the `ApiId` and `ApiEndpoint` from the first command and the `RouteId` of `POST /notes` from the second. Then send **POST** `<ApiEndpoint>/notes` from the HTTP probe: today it returns 200 to anyone.', commands: ['aws apigatewayv2 get-apis --query "Items[].[ApiId,ApiEndpoint]" --output text', 'aws apigatewayv2 get-routes --api-id <API_ID> --query "Items[].[RouteKey,RouteId]" --output text'] },
    { id: 'authorizer', title: 'Create the authorizer', body: 'Type REQUEST, payload format 2.0, simple responses, identity source the `Authorization` header (single quotes keep the `$` literal). Copy `AuthorizerId`.', commands: [`aws apigatewayv2 create-authorizer --api-id <API_ID> --name header-check --authorizer-type REQUEST --authorizer-uri ${AUTHZ_URI} --identity-source '$request.header.Authorization' --authorizer-payload-format-version 2.0 --enable-simple-responses`] },
    { id: 'perm', title: 'Let API Gateway invoke the authorizer', body: 'A second resource policy, this time on `authz`, scoped to this one authorizer. The emulator does not enforce it, so skipping it will not fail here, but real AWS would answer 500 on every request.', commands: ['aws lambda add-permission --function-name authz --statement-id apigw-authorizer --action lambda:InvokeFunction --principal apigateway.amazonaws.com --source-arn arn:aws:execute-api:us-east-1:000000000000:<API_ID>/authorizers/<AUTHORIZER_ID>'] },
    { id: 'attach', title: 'Protect the route', body: 'Authorizers are per route. `CUSTOM` is the authorization type for a Lambda authorizer.', commands: ['aws apigatewayv2 update-route --api-id <API_ID> --route-id <ROUTE_ID> --authorization-type CUSTOM --authorizer-id <AUTHORIZER_ID>'] },
    { id: 'try', title: 'Call it three ways from the probe', body: 'POST `<ApiEndpoint>/notes` with: (1) no headers, expect **401**; (2) the header `Authorization: nope`, expect **403**; (3) `Authorization: let-me-in`, expect **200** and `"auth":{"lambda":{"user":"danny"}}` in the body. In the probe panel, headers go one per line as `Name: value`. Allow up to 2 seconds after the route update.' },
    { id: 'break', title: 'Break it: the wrong response shape', body: 'Copy the code below into `authz.mjs` (it is the REST API response format, a very common copy-paste mistake), deploy it, then POST with a header value you have **not** used yet, such as `Authorization: fresh-1`. You get **500 Internal Server Error**. Now POST again with `Authorization: let-me-in`: still 200, because that decision is cached. The cache hides the bug for known values.', code: { file: 'authz.mjs', text: AUTHZ_BROKEN }, commands: [UPDATE_AUTHZ], breakIt: true },
    { id: 'fix', title: 'Fix it and prove it with a fresh value', body: 'Put the working code back in `authz.mjs` and deploy again. POST with another unused value, such as `Authorization: fresh-2`: the function now runs correctly and answers **403**, not 500. (Short of waiting out the TTL you cannot re-test an old value, and that is exactly the lesson about the cache.)', code: { file: 'authz.mjs', text: AUTHZ_HANDLER }, commands: [UPDATE_AUTHZ] },
  ],
  breakIt: {
    title: 'An authorizer that returns the wrong shape',
    command: UPDATE_AUTHZ,
    explain: [
      'With simple responses enabled, API Gateway expects `isAuthorized`. The function returned `principalId` and `policyDocument` instead, so API Gateway cannot interpret the result and answers `500 Internal Server Error` for every request that is not already cached. The caller gets no hint of the cause; you find it by invoking the authorizer yourself or reading its logs.',
      'The cache makes this nastier than it looks: values that were authorized or denied in the last five minutes keep working, so a deploy can look healthy in a smoke test and fail for new users. On real AWS, set a short TTL (or 0) on authorizers you are still debugging, and test with values the cache has not seen.',
    ],
  },
  realAws: {
    cost: [
      'API Gateway bills the request as normal. A Lambda authorizer adds one Lambda invocation per cache miss (about $0.20 per million requests plus compute, us-east-1, see the Lambda pricing page), so a longer TTL is also a cost control. Requests rejected with 401 for a missing identity source never invoke the function.',
    ],
    differences: [
      'On real AWS, omitting the `add-permission` for the authorizer function makes API Gateway answer 500 (or 403, depending on the configuration). The emulator does not enforce it: the API works without that permission.',
      'The emulator returned the same 401, 403 and 500 split and the same `context` pass-through that real HTTP APIs do, and it caches decisions per identity-source value. Cache expiry timing was not measured here.',
      'Real REST APIs have TOKEN authorizers and policy-document responses that can Deny individual routes through the cached policy; HTTP API simple responses are all-or-nothing per request.',
      'Real authorizers can also use a `--identity-validation-expression` on TOKEN authorizers (REST only) and IAM authorization (SigV4) as an alternative, neither covered hands-on here.',
    ],
    asOf: '2026-11-15',
    sources: [
      { label: 'Lambda authorizers for HTTP APIs', url: 'https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-lambda-authorizer.html' },
      { label: 'Controlling access to an HTTP API', url: 'https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-access-control.html' },
      { label: 'AWS Lambda pricing', url: 'https://aws.amazon.com/lambda/pricing/' },
    ],
  },
  fidelity: [{ service: 'API Gateway v2 (HTTP APIs)', pass: 156, total: 277 }, { service: 'Lambda', pass: 395, total: 788 }],
  files: ['authz.mjs', 'authz.zip', 'handler.mjs', 'notes-fn.zip'],
  probeNote: 'These checks read the calls you made from the HTTP probe panel in this module, and invoke `authz` once to confirm it is fixed. Pressing Check sends nothing to the API.',
  checks: [
    { id: 'authorizer', label: 'A REQUEST authorizer with simple responses reads the Authorization header', hint: 'Run create-authorizer with --enable-simple-responses and the header identity source.' },
    { id: 'perm', label: 'Lambda allows apigateway.amazonaws.com to invoke `authz`', hint: 'Run the add-permission step for authz.' },
    { id: 'route', label: 'Route `POST /notes` uses the CUSTOM authorizer', hint: 'Run update-route with --authorization-type CUSTOM and the authorizer id.' },
    { id: 'noheader', label: 'POST without a header was refused with 401', hint: 'Send POST <ApiEndpoint>/notes from the probe with no headers.' },
    { id: 'denied', label: 'POST with a wrong header was refused with 403', hint: 'Send POST with the header `Authorization: nope`.' },
    { id: 'allowed', label: 'POST with `Authorization: let-me-in` got 200 with context.user from the authorizer', hint: 'Send POST with the header `Authorization: let-me-in`.' },
    { id: 'breakit', label: 'A wrong-shaped authorizer response produced a 500', hint: 'Deploy the broken authz.mjs, then POST with a header value you have not used before.' },
    { id: 'fixed', label: '`authz` is fixed again (after you saw the 500)', hint: 'Restore the working authz.mjs and run update-function-code again.' },
  ],
}
