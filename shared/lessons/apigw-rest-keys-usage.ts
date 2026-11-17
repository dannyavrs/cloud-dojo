import type { LessonContent } from '../types'

const KEY = 'dojo-demo-key-0123456789'
const REQ_TEMPLATE = `'{"application/json":"{\\"statusCode\\":200}"}'`
const RESP_TEMPLATE = `'{"application/json":"{\\"mock\\":true}"}'`
const URL_HINT = 'https://127.0.0.1:9297/_aws/execute-api/<REST_ID>/prod/'

export const apigwRestKeysUsage: LessonContent = {
  id: 'apigw-rest-keys-usage',
  n: '7.6',
  trackId: 'apigw',
  level: 'advanced',
  prereqs: ['apigw-routes-stages'],
  estMinutes: 40,
  honesty: 'live',
  honestyNote: 'The emulator enforces API key requirement and usage-plan quotas on a REST API: no key or an unattached key gets 403, and the call after the quota gets 429 "Limit Exceeded". Fidelity for the REST API (API Gateway v1) is not published.',
  examTags: ['SAA:Cost', 'SAA:Secure', 'DVA:Dev', 'DVA:Deploy'],
  breakItCheck: 'breakit',
  httpProbe: true,
  title: 'REST API: API keys, usage plans and a MOCK integration',
  tagline: 'Sell access in tiers: a key, a plan with a daily quota, and a fourth call that gets refused.',
  predict: [
    { id: 'p1', prompt: 'A REST API method has `apiKeyRequired` set to true. A client calls it with no `x-api-key` header. What does API Gateway answer?', options: ['401 Unauthorized', '403 Forbidden', '400 Bad Request', '200, the key requirement only applies when a usage plan exists'], answer: 1, explain: 'A missing or invalid API key is 403 {"message":"Forbidden"}. 401 is what authorizers return for missing credentials, which is why the two are easy to confuse.' },
    { id: 'p2', prompt: 'You create an enabled API key and send it in `x-api-key`, but you never attach it to a usage plan. The method requires a key. What happens?', options: ['200, any enabled key is accepted', '429, the key has no quota yet', '403 Forbidden: a key only works through a usage plan that includes the stage', '500'], answer: 2, explain: 'On a REST API, a key is only honoured when it is associated with a usage plan that covers the API stage. The key alone proves nothing, so the request is Forbidden until you create the usage-plan key association.' },
    { id: 'p3', prompt: 'A usage plan allows 3 requests per day. The key has made 3 successful calls. What is the fourth response?', options: ['403 Forbidden', '429 Too Many Requests, retry in a second', '429 with `Limit Exceeded`: the quota is spent until the period resets', '200, quotas are advisory'], answer: 2, explain: 'Exceeding the quota returns 429 with the message "Limit Exceeded". Exceeding the rate or burst limit also returns 429 but with "Too Many Requests", and that one clears in a moment. A spent quota does not clear until the next day (or week or month) or until you raise it.' },
  ],
  concept: [
    'The **REST API** flavour of API Gateway (the `apigateway` service, sometimes called v1) is the feature-rich, more expensive sibling of the HTTP API. It adds what the HTTP API lacks: **API keys and usage plans**, request validation and transformation with mapping templates, a built-in response cache, AWS WAF, resource policies, private endpoints and canary stages. Its building blocks are explicit: a **rest API** has **resources** (paths), each with **methods** (GET, POST), each method with a **method request** (auth, key, validation), an **integration** (what is called) and responses configured twice, once as a **method response** (the contract) and once as an **integration response** (the mapping). A **deployment** publishes the API to a **stage**.',
    'This module uses the **MOCK integration**: API Gateway answers by itself, with a body from a mapping template and no backend at all. It is how you prototype an API contract before the backend exists, and a frequent exam answer for "return a static response, or handle CORS preflights, without a Lambda". A request template (`{"statusCode":200}`) tells the mock which status to produce, and the integration response template shapes the body.',
    '**API keys and usage plans** meter and limit clients. An **API key** is just an opaque string that identifies a caller; a **usage plan** defines, for the API stages it lists, a **throttle** (rate and burst per second) and a **quota** (a number of requests per day, week or month), and you **attach keys to the plan**. A method opts in with `--api-key-required`. Results: no key, an unknown key or a key that is not attached to a plan for this stage gets **403 Forbidden**; within limits gets 200; over the rate limit gets 429 `Too Many Requests`; over the quota gets 429 `Limit Exceeded`. The exam loves this: **API keys are for metering and monetisation, not for security**. They are sent in plain headers, they are shared secrets and they carry no identity or permissions. Authenticate with IAM (SigV4), a Cognito user pool authorizer or a Lambda authorizer, and add keys on top when you need per-customer quotas. Also remember that usage plans and keys exist on REST APIs only; for an HTTP API you use stage and route throttling (module 7.5).',
    'In this module you build everything from nothing: the REST API, a GET method that requires a key, the MOCK integration with its two response configurations, a deployment to `prod`, an API key with a value you choose (so you can type it in the probe), and a usage plan with a quota of 3 per day. The REST API address is different from the HTTP API one: the emulator serves it at `/_aws/execute-api/<rest-api-id>/prod/`. You will see three kinds of 403/429 in turn: no key, key without a plan, and quota spent.',
  ],
  goal: 'A REST API `legacy` with a key-protected MOCK method on stage `prod`, an API key attached to a usage plan with a 3 per day quota: 403 without a key, 200 three times with it, then 429 Limit Exceeded.',
  steps: [
    { id: 'api', title: 'Create the REST API', body: 'The output has the API `id` and the `rootResourceId` (the `/` resource). Copy both.', commands: ['aws apigateway create-rest-api --name legacy'] },
    { id: 'method', title: 'Add a GET method that requires an API key', body: 'No authorizer (`NONE`) but `--api-key-required`. Replace the placeholders with your ids.', commands: ['aws apigateway put-method --rest-api-id <REST_ID> --resource-id <ROOT_ID> --http-method GET --authorization-type NONE --api-key-required'] },
    { id: 'integration', title: 'Add the MOCK integration', body: 'No backend: the request template makes the mock choose status 200.', commands: [`aws apigateway put-integration --rest-api-id <REST_ID> --resource-id <ROOT_ID> --http-method GET --type MOCK --request-templates ${REQ_TEMPLATE}`] },
    { id: 'responses', title: 'Configure both responses', body: 'A REST method needs a **method response** (the contract for status 200) and an **integration response** (maps the mock to a body). Skipping either gives an error at call time.', commands: ['aws apigateway put-method-response --rest-api-id <REST_ID> --resource-id <ROOT_ID> --http-method GET --status-code 200', `aws apigateway put-integration-response --rest-api-id <REST_ID> --resource-id <ROOT_ID> --http-method GET --status-code 200 --response-templates ${RESP_TEMPLATE}`] },
    { id: 'deploy', title: 'Deploy to a stage called prod', body: 'Nothing is reachable until a deployment exists.', commands: ['aws apigateway create-deployment --rest-api-id <REST_ID> --stage-name prod'] },
    { id: 'nokey', title: 'Call it without a key', body: `GET \`${URL_HINT}\` from the HTTP probe (use your emulator address if it is not 9297, and mind the trailing slash). Expect **403** \`{"message":"Forbidden"}\`: the method requires a key.` },
    { id: 'key', title: 'Create an API key, and try it too early', body: `You choose the key value so you can type it. Copy the key \`id\`. Then GET the URL again with the header \`x-api-key: ${KEY}\`: still **403**, because the key belongs to no usage plan yet.`, commands: [`aws apigateway create-api-key --name partner --enabled --value ${KEY}`] },
    { id: 'plan', title: 'Create a usage plan and attach the key', body: 'Quota 3 per day, a rate of 5 per second, valid for the `prod` stage of your API. Copy the plan `id`, then attach the key to it.', commands: ['aws apigateway create-usage-plan --name basic --api-stages apiId=<REST_ID>,stage=prod --throttle burstLimit=5,rateLimit=5 --quota limit=3,period=DAY', 'aws apigateway create-usage-plan-key --usage-plan-id <PLAN_ID> --key-id <KEY_ID> --key-type API_KEY'] },
    { id: 'allowed', title: 'Spend the quota', body: `GET the URL three times with \`x-api-key: ${KEY}\` (allow a second after attaching the key). Each answer is **200** with \`{"mock":true}\`.` },
    { id: 'break', title: 'Break it: the fourth call', body: 'Send a fourth GET with the key: **429** `{"message":"Limit Exceeded"}`. Then check the plan\'s counters: the key has used 3 and has 0 left today.', commands: ['aws apigateway get-usage --usage-plan-id <PLAN_ID> --key-id <KEY_ID> --start-date 2026-11-01 --end-date 2026-11-30'], breakIt: true },
  ],
  breakIt: {
    title: 'A fourth call against a quota of three',
    command: 'aws apigateway get-usage --usage-plan-id <PLAN_ID> --key-id <KEY_ID> --start-date 2026-11-01 --end-date 2026-11-30',
    explain: [
      'The key is valid and attached, and the rate limit is nowhere near hit, but the daily quota of 3 is spent, so API Gateway answers `429 {"message":"Limit Exceeded"}`. `get-usage` shows the pair `[used, remaining]` per day (`[3, 0]` for today).',
      'Do not confuse the two 429s: `Too Many Requests` is the rate or burst limit and heals within a second; `Limit Exceeded` is the quota and heals at the next period or when you raise `--quota`. On real AWS the usage counters can lag behind the traffic, so a client may overshoot a quota slightly.',
    ],
  },
  realAws: {
    cost: [
      'REST APIs cost about $3.50 per million requests for the first tier (us-east-1, see the pricing page), compared with about $1.00 for HTTP APIs, so use a REST API when you need keys and usage plans, request validation, WAF or the cache, not by default. API keys and usage plans themselves have no separate charge.',
      'The optional REST API cache is billed per hour by cache size. A MOCK integration costs only the API request, which makes it a cheap way to serve static responses.',
    ],
    differences: [
      'Real REST API URLs look like `https://<rest-api-id>.execute-api.us-east-1.amazonaws.com/prod/`. The emulator serves them at `https://127.0.0.1:9297/_aws/execute-api/<rest-api-id>/prod/`.',
      'Real API Gateway generates the key value for you when you omit `--value`, and that value is shown by `get-api-key --include-value`. The lab sets a value so you can type it, which is allowed on real AWS too (a custom value must be 20 to 128 characters).',
      'Real usage counters can lag behind the traffic, so a few requests over the quota can slip through. The emulator counts exactly.',
      'The REST API is a large surface (request validators, models, stage cache, canary, resource policies, private endpoints, authorizers). Only the key, plan and MOCK path is exercised here, and the fidelity of the emulator for the REST API is not published, so test anything beyond this against real AWS.',
    ],
    asOf: '2026-11-15',
    sources: [
      { label: 'Usage plans and API keys for REST APIs', url: 'https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-api-usage-plans.html' },
      { label: 'Choose between REST APIs and HTTP APIs', url: 'https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vs-rest.html' },
      { label: 'Set up a mock integration', url: 'https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-mock-integration.html' },
      { label: 'API Gateway pricing', url: 'https://aws.amazon.com/api-gateway/pricing/' },
    ],
  },
  fidelity: [],
  files: [],
  probeNote: 'These checks read the calls you made from the HTTP probe panel in this module. Pressing Check sends nothing new.',
  checks: [
    { id: 'api', label: 'REST API `legacy` has a GET method that requires an API key and uses a MOCK integration', hint: 'Run create-rest-api, put-method with --api-key-required, then put-integration --type MOCK.' },
    { id: 'deployed', label: 'The API is deployed to the stage `prod`', hint: 'Run put-method-response, put-integration-response and create-deployment --stage-name prod.' },
    { id: 'nokey', label: 'A call without a key was refused with 403', hint: 'GET the prod URL from the HTTP probe with no headers.' },
    { id: 'key', label: 'An enabled API key exists', hint: 'Run create-api-key --enabled with a --value.' },
    { id: 'plan', label: 'A usage plan with a quota of 3 per day covers `prod` and the key is attached to it', hint: 'Run create-usage-plan with --quota limit=3,period=DAY, then create-usage-plan-key.' },
    { id: 'allowed', label: 'Three calls with the key got 200 and the mock body', hint: 'GET the prod URL three times with the header `x-api-key`.' },
    { id: 'breakit', label: 'The fourth call was refused with 429 Limit Exceeded', hint: 'Send a fourth GET with the key from the probe.' },
  ],
}
