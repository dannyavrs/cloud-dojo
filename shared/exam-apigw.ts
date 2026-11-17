import type { QuizQuestion } from './types'

/** Exam-style scenario questions for the API Gateway track (6-10), graded locally. */
export const APIGW_EXAM: QuizQuestion[] = [
  {
    id: 'e1', tag: 'SAA:Secure',
    prompt: 'A mobile app signs users in with an Amazon Cognito user pool and calls a new HTTP API backed by Lambda. The team wants every route to accept only valid tokens, with no authorizer code to maintain and no extra Lambda invocation per request. What should they configure?',
    options: ['A REQUEST Lambda authorizer that validates the token with the Cognito API', 'A JWT authorizer with the user pool issuer URL and the app client id as audience', 'An API key and a usage plan for every user', 'AWS IAM authorization with credentials from a Cognito identity pool'],
    answer: 1,
    explain: 'The built-in JWT authorizer verifies signature, issuer, expiry and audience using the pool\'s published keys, with no code and no Lambda cost. API keys are not authentication, and IAM with an identity pool is a different (heavier) pattern.',
  },
  {
    id: 'e2', tag: 'DVA:Sec',
    prompt: 'A REQUEST Lambda authorizer on an HTTP API is updated so that it now rejects a user. For about five minutes after the deployment that user still gets through with the same token. Which setting explains this and controls it?',
    options: ['The Lambda function\'s reserved concurrency', 'The route\'s throttling burst limit', 'The authorizer result cache TTL (authorizer-result-ttl-in-seconds)', 'The stage variable that holds the function alias'],
    answer: 2,
    explain: 'API Gateway caches the authorizer decision per identity-source value for the TTL (300 seconds by default, 0 disables). A redeploy of the function does not flush it, so lower the TTL for fast revocation or when debugging.',
  },
  {
    id: 'e3', tag: 'SAA:Cost',
    prompt: 'A company sells a public API in a free tier (1,000 calls a day) and a paid tier (100,000 calls a day). Each customer gets their own credential, and calls beyond the quota must be refused automatically. Which design fits with the least custom code?',
    options: ['A REST API with API keys and usage plans that define the quotas', 'An HTTP API with a Lambda authorizer that counts calls in DynamoDB', 'An HTTP API with one JWT authorizer and stage-level throttling', 'A Network Load Balancer with security groups per customer'],
    answer: 0,
    explain: 'Usage plans and API keys, which exist on REST APIs only, give per-key quotas, rate and burst limits and metering. Stage throttling is shared by all callers, and a custom counter works but is code you must build and keep consistent.',
  },
  {
    id: 'e4', tag: 'DVA:Dev',
    prompt: 'A single-page app on https://app.example.com sends a POST with a JSON body and an Authorization header to an HTTP API. The browser console reports a CORS error, yet the same request with curl succeeds. The API CORS configuration allows origin https://app.example.com and method POST. What is most likely missing?',
    options: ['The API must return 204 for POST requests', 'A route for the OPTIONS method that invokes the Lambda function', 'A stage variable named origin', 'Authorization (and content-type) in the allowed headers of the CORS configuration'],
    answer: 3,
    explain: 'A JSON content type and an Authorization header make the browser send a preflight that lists them in Access-Control-Request-Headers. If the CORS configuration does not allow those headers, the browser blocks the call. curl ignores CORS, which is why it works.',
  },
  {
    id: 'e5', tag: 'SAA:Resilient',
    prompt: 'Clients of an order-intake API receive 429 Too Many Requests during short traffic spikes. The orders do not need to be processed synchronously. Which change makes the system most resilient without dropping orders?',
    options: ['Raise the integration timeout to 29 seconds', 'Have the API put each order on an SQS queue and let a Lambda function consume the queue', 'Turn off throttling on the stage', 'Add an API key to every request'],
    answer: 1,
    explain: 'A queue absorbs the spike and the consumer drains it at its own pace, while the client gets a quick acknowledgement. Timeouts do not help a 429, disabling throttling just moves the overload to the backend, and keys do not add capacity.',
  },
  {
    id: 'e6', tag: 'DVA:Deploy',
    prompt: 'A developer adds a new method to an existing REST API and tests it on the stage `prod`. The call returns 403 {"message":"Missing Authentication Token"}, although the method exists in the console. What is the most likely fix?',
    options: ['Attach an API key to the method', 'Enable CORS on the resource', 'Create a new deployment to the prod stage', 'Increase the stage throttling limits'],
    answer: 2,
    explain: 'A REST API stage serves the last deployment, a snapshot. Changes made afterwards are invisible until you deploy again, and an unknown path then shows up as Missing Authentication Token. HTTP APIs avoid this with auto-deploy.',
  },
  {
    id: 'e7', tag: 'SAA:Performant',
    prompt: 'A team proxies simple JSON requests to Lambda and authenticates with JWTs from an OIDC provider. They do not need API keys, usage plans, request validation or a response cache. They want the lowest cost and latency. Which API type should they choose?',
    options: ['REST API with a cache', 'REST API with a Cognito authorizer', 'WebSocket API', 'HTTP API with a JWT authorizer'],
    answer: 3,
    explain: 'HTTP APIs cost roughly a third of REST APIs, add less latency and include JWT authorizers and CORS natively. REST APIs are the right choice only when you need their extra features such as keys, usage plans, validation, WAF or caching.',
  },
  {
    id: 'e8', tag: 'DVA:Troubleshoot',
    prompt: 'After a deployment of the authorizer function, users who signed in earlier keep working, but every new user gets 500 Internal Server Error from an HTTP API protected by a REQUEST authorizer with simple responses enabled. The function returns { principalId, policyDocument }. What is the cause?',
    options: ['The function returns the IAM-policy format, but simple responses require { isAuthorized, context }', 'The function needs more memory', 'The identity source header is missing, which always returns 500', 'The JWT audience is wrong'],
    answer: 0,
    explain: 'With simple responses the authorizer must return isAuthorized. Anything else fails with 500. Earlier users still pass because their decisions are cached for the TTL, which hides the bug until new identity values arrive.',
  },
  {
    id: 'e9', tag: 'SAA:Secure',
    prompt: 'A security review finds that a REST API is protected only by `apiKeyRequired` on every method. The keys are distributed to several partner companies. What is the correct assessment?',
    options: ['It is sufficient: API keys are encrypted and tied to an IAM identity', 'It is sufficient as long as a usage plan limits the call rate', 'It is not real authentication: keys are shared secrets for metering, so add IAM, Cognito or a Lambda authorizer', 'It is sufficient if the keys are rotated every 90 days'],
    answer: 2,
    explain: 'API keys identify a caller for throttling and quotas, nothing more: they have no permissions model and travel as plain headers. Use IAM (SigV4), a Cognito user pool authorizer or a Lambda authorizer for authentication, and keep keys for usage plans.',
  },
]
