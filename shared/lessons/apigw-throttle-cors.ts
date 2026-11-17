import type { LessonContent } from '../types'

const ORIGIN = 'http://localhost:5173'

export const apigwThrottleCors: LessonContent = {
  id: 'apigw-throttle-cors',
  n: '7.5',
  trackId: 'apigw',
  level: 'intermediate',
  prereqs: ['apigw-routes-stages'],
  estMinutes: 30,
  honesty: 'live',
  honestyNote: 'The emulator enforces stage throttling with a token bucket (rate and burst) and returns 429, and it answers CORS preflights with the allow-origin, allow-methods and allow-headers you configured. Its preflight status is 404, where real HTTP APIs answer 204; read the headers, not the status.',
  examTags: ['SAA:Resilient', 'SAA:Performant', 'DVA:Dev'],
  breakItCheck: 'breakit',
  httpProbe: true,
  title: 'Throttling and CORS',
  tagline: 'Protect a backend with a 1 request-per-second stage limit, and let one browser origin call it.',
  predict: [
    { id: 'p1', prompt: 'A stage has a throttling rate of 1 request per second and a burst of 1. Twelve requests arrive at the same instant. What do the callers see?', options: ['All twelve get 200, they are queued and served one per second', 'About one gets 200 and the rest get 429 Too Many Requests', 'Every request gets 503 until the limit is raised', 'Half get 200 and half get 429'], answer: 1, explain: 'Throttling is a token bucket: the burst limit is the bucket size (1 here), the rate is how fast it refills. API Gateway does not queue, it rejects the excess immediately with 429 and the client must retry with backoff.' },
    { id: 'p2', prompt: 'You configure CORS to allow only `http://localhost:5173`. A script on another origin simply calls the API with `curl -H "Origin: http://evil.example"`. Does API Gateway refuse the request?', options: ['Yes, 403 for any origin not in the list', 'No: the request is served normally, the response just lacks the allow-origin header, and only a browser then blocks the page from reading it', 'Yes, but only for POST requests', 'No, and API Gateway adds the evil origin to the allow list'], answer: 1, explain: 'CORS is enforced by the browser, not the server. The API still runs the request (and charges for it), it just does not say the origin is allowed. CORS is not an access control: use authorizers for that.' },
    { id: 'p3', prompt: 'You enable CORS on an HTTP API and your Lambda function also returns its own `Access-Control-Allow-Origin: *` header. Which one reaches the browser?', options: ['The function\'s `*`, the backend always wins', 'Both, the browser takes the first', 'The API\'s own CORS configuration: API Gateway ignores CORS headers from the backend when CORS is configured on the API', 'Neither, the response is rejected as ambiguous'], answer: 2, explain: 'When you configure CORS on an HTTP API, API Gateway answers preflights itself and sets the CORS response headers; the documentation says it ignores CORS headers coming from the integration. Configure it in one place only.' },
  ],
  concept: [
    '**Throttling** protects your backend and your bill. API Gateway uses a **token bucket**: the **rate** limit is how many requests per second the bucket refills, the **burst** limit is the bucket size. A request that finds no token gets **429 Too Many Requests** immediately; nothing is queued. Limits apply at several levels and the strictest wins: an **account-level** limit per Region (10,000 requests per second with a 5,000 burst by default, shared across all APIs in the Region), a **stage** default (`--default-route-settings`) and a **per-route** override (`--route-settings`). For HTTP APIs that is all there is. REST APIs add **usage plans** with per-key rate, burst and quota (module 7.6).',
    'Exam thinking about 429: it is a **client-visible, retryable** failure, so clients should retry with exponential backoff and jitter, and a burst-heavy workload should either raise the limit (a quota increase request for the account limit), smooth the traffic with SQS in front, or cache (REST API stage cache). Throttling is not a security control against abuse: use AWS WAF (REST APIs) or a CDN for that. For quotas that are per customer, REST API usage plans are the tool. The payload and timeout limits (10 MB, about 30 seconds) are separate hard limits and produce 413 and 504, not 429.',
    '**CORS** (Cross-Origin Resource Sharing) is a **browser** protocol. A page on `http://localhost:5173` calling `https://api.example.com` is cross-origin; for anything beyond a simple GET or POST (a JSON content type, an Authorization header, PUT or DELETE) the browser first sends an **OPTIONS preflight** carrying `Origin`, `Access-Control-Request-Method` and `Access-Control-Request-Headers`. The server must answer with `Access-Control-Allow-Origin`, `-Allow-Methods` and `-Allow-Headers` (and optionally `-Max-Age` to cache the answer) or the browser blocks the real request. The real request then needs `Access-Control-Allow-Origin` on its response too. An HTTP API can do all of this from one setting, `--cors-configuration`, without a route or a Lambda; if you also enable credentials, `*` is not allowed as an origin.',
    'Traps worth knowing. **CORS is not authentication**: a non-browser client ignores it and the request still reaches your backend (and costs you money). **A 4xx or 5xx that carries no CORS headers looks like a CORS error in the browser console**, so a throttled 429, an authorizer 401 or a Lambda crash often shows up as "blocked by CORS policy" and sends people debugging the wrong thing. On REST APIs CORS is manual (an `OPTIONS` mock method plus headers on your own responses), which is a classic reason to choose an HTTP API. In this module you set the CORS configuration and read the preflight in the HTTP probe panel, then set a 1 rps stage limit and watch a burst of twelve requests: one gets through and the rest get 429. Press **Check** to send that burst yourself.',
  ],
  goal: 'An HTTP API whose stage limits you to 1 request per second (and you saw the 429s) and whose CORS configuration lets `http://localhost:5173` call `GET` and `POST`, verified with a preflight.',
  steps: [
    { id: 'ids', title: 'Find the API', body: 'The fixture created the API `notes` (`$default` stage, `GET /notes`, no limits, no CORS). Copy `ApiId` and `ApiEndpoint`, then GET `<ApiEndpoint>/notes` from the HTTP probe: **200**.', commands: ['aws apigatewayv2 get-apis --query "Items[].[ApiId,ApiEndpoint]" --output text'] },
    { id: 'preflight0', title: 'Send a preflight before any CORS setup', body: 'In the probe choose method **OPTIONS**, URL `<ApiEndpoint>/notes`, and these headers (one per line). Look at the response headers: there is no `access-control-allow-origin`, so a browser would refuse the real call.', code: { text: `Origin: ${ORIGIN}\nAccess-Control-Request-Method: GET` } },
    { id: 'cors', title: 'Configure CORS on the API', body: 'One origin, two methods, one header, cache the preflight for 10 minutes. No Lambda and no extra route are involved.', commands: [`aws apigatewayv2 update-api --api-id <API_ID> --cors-configuration AllowOrigins=${ORIGIN},AllowMethods=GET,POST,AllowHeaders=content-type,MaxAge=600`] },
    { id: 'preflight1', title: 'Send the same preflight again', body: 'Repeat the OPTIONS from step 2 (allow 2 seconds). The response headers now include `access-control-allow-origin: http://localhost:5173`, `access-control-allow-methods: GET,POST`, `access-control-allow-headers: content-type` and `access-control-max-age: 600`. The emulator shows status 404 on a preflight (real HTTP APIs answer 204): trust the headers. Then change the `Origin` header to `http://evil.example`: no allow headers, but a plain GET with that Origin still returns 200 because CORS is the browser\'s job.' },
    { id: 'throttle', title: 'Set a stage limit of 1 request per second', body: 'The `$default` stage gets a rate of 1 and a burst of 1 for every route. Single quotes keep the `$` literal.', commands: ["aws apigatewayv2 update-stage --api-id <API_ID> --stage-name '$default' --default-route-settings ThrottlingBurstLimit=1,ThrottlingRateLimit=1"] },
    { id: 'burst', title: 'Break it: twelve quick calls', body: 'Press **Check** in the checklist: it sends twelve simultaneous GETs to `<ApiEndpoint>/notes` and reports how many got 200 and how many 429 (about one and eleven). You can also press Send in the probe twice within a second: the second answer is `429 {"message":"Too Many Requests"}`. After a second the bucket has a token again and the next call is 200.', commands: ["aws apigatewayv2 get-stage --api-id <API_ID> --stage-name '$default' --query DefaultRouteSettings"], breakIt: true },
  ],
  breakIt: {
    title: 'Twelve calls at a 1 rps limit',
    command: "aws apigatewayv2 get-stage --api-id <API_ID> --stage-name '$default' --query DefaultRouteSettings",
    explain: [
      'With a bucket of one token and a refill of one per second, one request gets through and the others are rejected at once with `429 {"message":"Too Many Requests"}`. Nothing waits in a queue, and your function is never invoked for the rejected calls, which is the point: the limit sits in front of the backend.',
      'The practical lesson is on the client side: a 429 is retryable, so use exponential backoff with jitter (the AWS SDKs do this by default for throttling errors). If legitimate traffic is bursty, raise the burst limit, put SQS between the API and the work, or ask for a higher account-level quota.',
    ],
  },
  realAws: {
    cost: [
      'Throttling and CORS settings are free. A request rejected with 429 never reaches your Lambda function, so you do not pay for an invocation. Check the API Gateway pricing page for how throttled requests themselves are billed before using throttling in cost planning.',
      'HTTP API requests are about $1.00 per million (us-east-1, first tier), so a CORS preflight per call roughly doubles the request count for browser clients. `MaxAge` lets browsers cache the answer and avoid that.',
    ],
    differences: [
      'Real HTTP APIs answer a CORS preflight with `204 No Content`. The emulator answers 404 with the right CORS headers. Read the headers.',
      'Real account-level throttling (10,000 rps, 5,000 burst by default per Region) is not reproduced; only the stage and route limits you set are enforced. Real throttling is also approximate and distributed across API Gateway nodes, so a burst may let a few more through than the configured numbers.',
      'The burst you see here (one 200, the rest 429) is deterministic because the emulator has one bucket. Real throttling is distributed, so do not assert exact counts against real AWS.',
      'REST APIs configure throttling per stage and per method, plus usage plans per key. They have no `--cors-configuration`: CORS there is an OPTIONS method you build yourself.',
    ],
    asOf: '2026-11-15',
    sources: [
      { label: 'Throttle requests to your HTTP API', url: 'https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-throttling.html' },
      { label: 'Configuring CORS for an HTTP API', url: 'https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-cors.html' },
      { label: 'API Gateway quotas', url: 'https://docs.aws.amazon.com/apigateway/latest/developerguide/limits.html' },
    ],
  },
  fidelity: [{ service: 'API Gateway v2 (HTTP APIs)', pass: 156, total: 277 }],
  files: ['handler.mjs', 'notes-fn.zip'],
  probeNote: 'Check sends a preflight and a burst of twelve GETs to your API. Everything else reads the calls you made from the probe panel.',
  checks: [
    { id: 'call', label: 'GET /notes returned 200 from the probe', hint: 'Send GET <ApiEndpoint>/notes from the HTTP probe (before the limit, or after waiting a second).' },
    { id: 'cors-config', label: 'The API allows http://localhost:5173 for GET and POST', hint: 'Run update-api with --cors-configuration.' },
    { id: 'preflight', label: 'A preflight from that origin gets the allow-origin and allow-methods headers', hint: 'Press Check after configuring CORS; it sends the preflight.' },
    { id: 'throttle', label: 'The `$default` stage limits to 1 request per second (burst 1)', hint: 'Run update-stage with --default-route-settings ThrottlingBurstLimit=1,ThrottlingRateLimit=1.' },
    { id: 'burst', label: 'Twelve simultaneous calls: some 200, the rest 429', hint: 'Press Check after setting the limit; it sends the burst.' },
    { id: 'breakit', label: 'You saw a 429 from the throttled stage', hint: 'Press Check (it sends the burst) or press Send twice within a second in the probe.' },
  ],
}
