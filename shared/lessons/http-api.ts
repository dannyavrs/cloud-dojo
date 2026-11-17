import type { LessonContent } from '../types'

export const httpApi: LessonContent = {
  id: 'http-api',
  n: '7.1',
  trackId: 'apigw',
  level: 'core',
  prereqs: [],
  estMinutes: 20,
  honesty: 'live',
  examTags: ["DVA:Dev", "DVA:Deploy", "SAA:Performant"],
  predict: [{"id": "p1", "prompt": "An HTTP API proxies to a Lambda function that always throws. What does the client see?", "options": ["200 with the error text", "500 Internal Server Error", "404 Not Found", "The request hangs until timeout"], "answer": 1, "explain": "An unhandled function error becomes a 5xx from the API: the integration failed, not the route."}],

  title: 'API Gateway: a public HTTP endpoint',
  tagline: 'Put a URL in front of a Lambda function.',
  concept: [
    '**API Gateway** gives your function an HTTPS address. An **HTTP API** is the lean, cheap flavor: you create an API with a **target** (here a Lambda function), and it routes every request to it through a `$default` stage. The function receives the request as JSON and returns a response object.',
    'Two separate permissions again: your **caller** may be anyone, but **API Gateway** must be allowed to invoke the function. That is a **resource-based policy** on the function, added with `lambda add-permission`.',
    'The emulator has no browser console and no `curl` in this runner, so use the **HTTP probe** box next to the terminal: it sends a GET to the emulator address only, trusting its certificate for that one connection.',
  ],
  goal: 'An HTTP API whose `GET /` returns JSON from `hello-api`, and a deliberate 500 from `broken-api`.',
  steps: [
    { id: 'perm', title: 'Allow API Gateway to invoke the function', body: 'A resource-based policy statement named `apigw`.', commands: ['aws lambda add-permission --function-name hello-api --statement-id apigw --action lambda:InvokeFunction --principal apigateway.amazonaws.com'] },
    { id: 'api', title: 'Create the API with a Lambda target', body: 'Quick-create: one route, one integration, the `$default` stage, auto-deploy. Copy `ApiEndpoint` from the output.', commands: ['aws apigatewayv2 create-api --name notes-api --protocol-type HTTP --target arn:aws:lambda:us-east-1:000000000000:function:hello-api'] },
    { id: 'call', title: 'Call it', body: 'Paste the `ApiEndpoint` into the HTTP probe and press GET. You should see 200 and a JSON body.', commands: [] },
    { id: 'break', title: 'Break it: an API in front of a function that throws', body: 'Create a second API for `broken-api`, then call its endpoint in the probe.', commands: ['aws apigatewayv2 create-api --name broken-api --protocol-type HTTP --target arn:aws:lambda:us-east-1:000000000000:function:broken-api'], breakIt: true },
    { id: 'stages', title: 'Look at the stage', body: 'The default stage deploys automatically.', commands: ["aws apigatewayv2 get-apis --query 'Items[].[ApiId,Name,ApiEndpoint]' --output text"] },
  ],
  breakIt: {
    title: 'Put an API in front of a function that throws',
    command: 'aws apigatewayv2 create-api --name broken-api --protocol-type HTTP --target arn:aws:lambda:us-east-1:000000000000:function:broken-api',
    explain: [
      'A second function, `broken-api`, always throws. Create an API for it and GET the endpoint in the HTTP probe: you get `500 {"message":"Internal Server Error"}`. API Gateway deliberately hides the function\'s error from the caller; the real reason (`boom: this handler always fails`) is only visible by invoking the function yourself or reading its logs.',
      'Honest note on permissions: on real AWS, removing the `lambda:InvokeFunction` permission for API Gateway also makes the API answer 500. The emulator did not enforce this particular one in our test (API Gateway as the caller still got 200), even though it does enforce Lambda resource policies for direct invokes and function URLs, so this lesson uses a throwing function to show the 500 instead.',
    ],
  },
  realAws: {
    cost: [
      'HTTP APIs cost about $1.00 per million requests for the first tier (from the examples on the API Gateway pricing page; region not stated there) and have 1 million free calls per month for the first 12 months of a new account. You also pay for the Lambda invocations behind it.',
    ],
    differences: [
      'Real endpoints look like `https://<api-id>.execute-api.<region>.amazonaws.com`. The emulator serves them at `https://127.0.0.1:9297/_aws/execute-api/<api-id>`.',
      'Real APIs often add JWT/IAM authorizers, throttling, custom domains and CORS. HTTP API fidelity in the emulator is 56%, so stick to the basics here.',
    ],
    asOf: '2026-11-13',
    sources: [{ label: 'API Gateway pricing', url: 'https://aws.amazon.com/api-gateway/pricing/' }, { label: 'Working with HTTP APIs', url: 'https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api.html' }],
  },
  fidelity: [{ service: 'API Gateway v2', pass: 156, total: 277 }, { service: 'Lambda', pass: 395, total: 788 }],
  files: [],
  httpProbe: true,
  probeNote: 'The call check sends a GET to your API endpoint when you press Check.',
  checks: [
    { id: 'perm', label: 'Lambda allows apigateway.amazonaws.com to invoke `hello-api`', hint: 'Step 1.' },
    { id: 'api', label: 'An HTTP API with a $default stage targets `hello-api`', hint: 'Step 2.' },
    { id: 'call', label: 'GET on the endpoint returns 200 with JSON', hint: 'Press Check after creating the API.' },
    { id: 'broken', label: 'You saw API Gateway answer 500 for the broken function', hint: 'Run the break-it step and GET its endpoint in the probe.' },
  ],
}
