import type { LessonContent } from '../types'

const FN = 'arn:aws:lambda:us-east-1:000000000000:function:notes-fn'

export const apigwRoutesStages: LessonContent = {
  id: 'apigw-routes-stages',
  n: '7.2',
  trackId: 'apigw',
  level: 'intermediate',
  prereqs: ['http-api'],
  estMinutes: 30,
  honesty: 'live',
  honestyNote: 'Route matching, stages, stage variables and auto-deploy are all enforced by the emulator. It answers 403 (not 404) for a stage that has no deployment or a path with no matching stage, and it does not enforce the Lambda permission for API Gateway.',
  examTags: ['DVA:Dev', 'DVA:Deploy', 'SAA:Performant'],
  breakItCheck: 'breakit',
  httpProbe: true,
  title: 'Routes, stages and stage variables',
  tagline: 'Wire one function to a path parameter, then run the same API as dev and prod.',
  predict: [
    { id: 'p1', prompt: 'An HTTP API has one route, `GET /notes/{id}`, and no `$default` route. A client sends `DELETE /notes/42`. What does API Gateway answer?', options: ['405 Method Not Allowed', '404 Not Found, with no Lambda invoke', '403 Forbidden', 'It calls the function anyway with the path parameters empty'], answer: 1, explain: 'A route key is method plus path. If nothing matches and there is no `$default` route, API Gateway answers 404 without touching the integration. There is no 405 for HTTP APIs: the method is part of the route.' },
    { id: 'p2', prompt: 'You create the stage `dev` WITHOUT `--auto-deploy`, deploy once, and then add a new route. When does the new route start answering?', options: ['Immediately, routes are live as soon as they exist', 'After you create another deployment to the stage', 'After the stage variables change', 'Never, routes can only be added before the first deployment'], answer: 1, explain: 'A deployment is a snapshot of the routes and integrations. Without auto-deploy the stage keeps serving the last snapshot until you run `create-deployment`. Forgetting that is the classic "I added the route but I still get 404" bug.' },
    { id: 'p3', prompt: 'A request matches both `GET /notes/{id}` and `GET /{proxy+}`. Which route gets it?', options: ['The one created first', '`GET /{proxy+}`, greedy routes win', '`GET /notes/{id}`, the most specific match wins', 'API Gateway rejects the ambiguity with a 500'], answer: 2, explain: 'API Gateway picks the most specific route: an exact path beats a path parameter, which beats a greedy `{proxy+}`, which beats `$default`. Order of creation does not matter.' },
  ],
  concept: [
    'An **HTTP API** is a set of **routes** that point at **integrations**, published through **stages**. A route key is `METHOD /path`, for example `GET /notes/{id}`. Curly braces capture a path segment into `pathParameters`, `{proxy+}` captures the rest of the path, `ANY` matches every method, and `$default` is the catch-all that receives whatever nothing else matched. When several keys match, the **most specific** one wins. The integration here is `AWS_PROXY` with **payload format 2.0**: API Gateway passes the whole request to Lambda as one JSON event (`routeKey`, `rawPath`, `pathParameters`, `stageVariables`, `requestContext`) and expects `{ statusCode, headers, body }` back.',
    'A **stage** is a named, deployed snapshot of the API: `dev`, `prod`, or the special `$default` stage that is served at the root with no stage name in the URL. A named stage adds its name to the path (`/dev/notes/42`), and that is also what shows up as `requestContext.stage`. A **deployment** is the snapshot a stage serves. HTTP APIs can **auto-deploy**: every change to routes or integrations creates a deployment for that stage. Without it you must run `create-deployment`, and anything you changed since is invisible to clients. **Stage variables** are key/value strings attached to the stage (`env=dev`) that reach the function in `event.stageVariables`, and can also be referenced in integration settings as `${stageVariables.env}`, for example to point `dev` at one function alias and `prod` at another with one API definition.',
    'Exam traps. HTTP API versus REST API: HTTP APIs are cheaper and faster, use payload 2.0 by default and have JWT authorizers and automatic CORS, but have no API keys, usage plans, request validation or WAF integration (those are REST API features, module 7.6). Lambda proxy event shape differs between the two (`rawPath` and `routeKey` in 2.0, `path`, `resource` and `httpMethod` in 1.0). The integration timeout is capped around 30 seconds (29 for REST by default) and the payload at 10 MB, so long jobs belong behind SQS or Step Functions. API Gateway needs a **resource-based permission** on the function (`lambda add-permission` with principal `apigateway.amazonaws.com` and a `source-arn` that names the API) or real AWS answers 500. Use a source ARN with the API id and `/*` to scope it to this API only, not to all of API Gateway.',
    'In this module the fixture gives you the role and the echo function `notes-fn`, which returns the route key, stage, path parameter and stage variables it saw. You build the API from nothing: create it, create the `dev` stage with `--auto-deploy` first so every later change is live, add the integration and the `GET /notes/{id}` route, then call it from the HTTP probe. The break-it is a method nobody routed (404), and the fix is a `$default` route, which then swallows everything, including typos. You finish with a `prod` stage on the same API carrying different variables. The emulator is faithful here except for two things recorded in the real-AWS notes.',
  ],
  goal: 'An HTTP API `notes` with a `GET /notes/{id}` route, a `dev` stage (env=dev) and a `prod` stage (env=prod) that both answer, plus a 404 you caused on purpose and a `$default` route that catches it.',
  steps: [
    { id: 'look', title: 'Read the backend', body: 'The fixture created the role `lambda-exec` and the function `notes-fn`. Open `handler.mjs`: it echoes `routeKey`, the stage, `pathParameters.id` and `stageVariables`, so every call shows you exactly what API Gateway decided.' },
    { id: 'api', title: 'Create the API', body: 'No quick-create target this time: an empty HTTP API. Copy `ApiId` and `ApiEndpoint` from the output, you need both.', commands: ['aws apigatewayv2 create-api --name notes --protocol-type HTTP'] },
    { id: 'stage', title: 'Create the dev stage first, with auto-deploy', body: '`--auto-deploy` makes every later route or integration change go live by itself. `--stage-variables` attaches `env=dev`. Replace `<API_ID>` with your `ApiId`.', commands: ['aws apigatewayv2 create-stage --api-id <API_ID> --stage-name dev --auto-deploy --stage-variables env=dev'] },
    { id: 'integration', title: 'Create the Lambda integration', body: 'Payload format 2.0 means the event has `routeKey` and `rawPath`. Copy `IntegrationId`.', commands: [`aws apigatewayv2 create-integration --api-id <API_ID> --integration-type AWS_PROXY --integration-uri ${FN} --payload-format-version 2.0`] },
    { id: 'route', title: 'Add the route', body: 'The key has a method and a path parameter. The target is `integrations/<id>`. Single quotes keep the braces literal.', commands: ["aws apigatewayv2 create-route --api-id <API_ID> --route-key 'GET /notes/{id}' --target integrations/<INTEGRATION_ID>"] },
    { id: 'perm', title: 'Let API Gateway invoke the function', body: 'The resource policy, scoped to this API only. The emulator does not enforce it (the real service would answer 500 without it), but write it anyway: it is what you would ship.', commands: ['aws lambda add-permission --function-name notes-fn --statement-id apigw-notes --action lambda:InvokeFunction --principal apigateway.amazonaws.com --source-arn arn:aws:execute-api:us-east-1:000000000000:<API_ID>/*'] },
    { id: 'call', title: 'Call it from the HTTP probe', body: 'GET `<ApiEndpoint>/dev/notes/42` in the HTTP probe panel. You should get 200 with `"route":"GET /notes/{id}"`, `"id":"42"`, `"stage":"dev"` and `"sv":{"env":"dev"}`. Now drop the `/dev` and try `<ApiEndpoint>/notes/42`: there is no `$default` stage, so there is no stage to serve it (the emulator answers 403).' },
    { id: 'break', title: 'Break it: a method nobody routed', body: 'List the routes, then send **DELETE** `<ApiEndpoint>/dev/notes/42` from the probe panel. The path is right, the method is not, so no route matches: **404 Not Found** and the function is never invoked.', commands: ['aws apigatewayv2 get-routes --api-id <API_ID> --query "Items[].[RouteKey,RouteId]" --output text'], breakIt: true },
    { id: 'default', title: 'Fix it with a $default route, then see the cost', body: 'A `$default` route catches everything no other route matched. Create it and repeat the DELETE: the function now answers with `"route":"$default"`. Also try `/dev/anything`. A catch-all hides client typos, so use it deliberately (a proxy to one backend), not as a safety net.', commands: ["aws apigatewayv2 create-route --api-id <API_ID> --route-key '$default' --target integrations/<INTEGRATION_ID>"] },
    { id: 'prod', title: 'Same API, second environment', body: 'A `prod` stage with `env=prod` serves the same routes. GET `<ApiEndpoint>/prod/notes/7` in the probe: same function, `"stage":"prod"`, `"sv":{"env":"prod"}`. One API definition, per-environment configuration.', commands: ['aws apigatewayv2 create-stage --api-id <API_ID> --stage-name prod --auto-deploy --stage-variables env=prod'] },
  ],
  breakIt: {
    title: 'A method nobody routed',
    command: 'aws apigatewayv2 get-routes --api-id <API_ID> --query "Items[].[RouteKey,RouteId]" --output text',
    explain: [
      'Only `GET /notes/{id}` exists, so `DELETE /notes/42` matches no route. API Gateway answers `404 {"message":"Not Found"}` itself, which you can confirm by the missing invocation in the function logs. An HTTP API has no 405: the method is part of the route key.',
      'The tempting fix, a `$default` route, works but changes the failure mode from "client gets a clear 404" to "your function receives every stray request and must reject it". Prefer explicit routes, and add `$default` only when one backend really owns everything else.',
    ],
  },
  realAws: {
    cost: [
      'HTTP APIs are billed per request (about $1.00 per million for the first tier, versus about $3.50 per million for REST APIs, us-east-1, see the pricing page) plus the Lambda invocations behind them. Stages, routes and variables themselves are free.',
      'The first 12 months of a new account include a free allowance of HTTP API calls (1 million per month at the time of writing).',
    ],
    differences: [
      'Real endpoints look like `https://<api-id>.execute-api.us-east-1.amazonaws.com/dev/notes/42`. The emulator serves the same thing at `https://127.0.0.1:9297/_aws/execute-api/<api-id>/dev/notes/42`.',
      'For a path with no matching stage the emulator answers 403 `Forbidden`. A stage that was created without a deployment answers the same. Do not memorise those two; the unmatched-route 404 is the one that matches real HTTP APIs.',
      'The emulator does not enforce the Lambda resource policy for API Gateway (the http-api module found the same). On real AWS, a missing `add-permission` makes the API answer 500.',
      'The real service also supports custom domain names with API mappings, per-route throttling and access logging per stage; this module covers none of them hands-on.',
    ],
    asOf: '2026-11-15',
    sources: [
      { label: 'HTTP API routes', url: 'https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-routes.html' },
      { label: 'HTTP API stages and auto-deploy', url: 'https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-stages.html' },
      { label: 'API Gateway pricing', url: 'https://aws.amazon.com/api-gateway/pricing/' },
    ],
  },
  fidelity: [{ service: 'API Gateway v2 (HTTP APIs)', pass: 156, total: 277 }],
  files: ['handler.mjs', 'notes-fn.zip'],
  probeNote: 'These checks read the calls you made from the HTTP probe panel in this module. Pressing Check sends nothing new.',
  checks: [
    { id: 'api', label: 'An HTTP API `notes` exists', hint: 'Run the create-api step.' },
    { id: 'route', label: 'Route `GET /notes/{id}` targets a Lambda integration for `notes-fn`', hint: 'Create the integration, then the route with --target integrations/<id>.' },
    { id: 'stage', label: 'Stage `dev` auto-deploys and carries the variable env=dev', hint: 'Run create-stage with --auto-deploy and --stage-variables env=dev.' },
    { id: 'perm', label: 'Lambda allows apigateway.amazonaws.com to invoke `notes-fn`', hint: 'Run the add-permission step.' },
    { id: 'call', label: 'GET /dev/notes/42 returned 200 with id 42, stage dev and env dev', hint: 'Send the GET from the HTTP probe panel, with /dev in the path.' },
    { id: 'breakit', label: 'DELETE on the unrouted method got 404', hint: 'Send DELETE <ApiEndpoint>/dev/notes/42 from the probe panel before adding a $default route.' },
    { id: 'default', label: 'A $default route exists and the same DELETE now reaches the function as $default', hint: 'Create the $default route, then repeat the DELETE from the probe panel.' },
    { id: 'prod', label: 'The prod stage answered with stage prod and env prod', hint: 'Create the prod stage, then GET /prod/notes/7 from the probe panel.' },
  ],
}
