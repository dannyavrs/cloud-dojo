import type { LessonContent } from '../types'

export const WEB_HANDLER = `export const handler = async (event) => ({
  statusCode: 200,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ hello: "from a function URL", method: event.requestContext?.http?.method, path: event.rawPath }),
});`

export const lambdaFunctionUrl: LessonContent = {
  id: 'lambda-function-url',
  n: '4.6',
  trackId: 'lambda',
  level: 'intermediate',
  prereqs: ['lambda-roles'],
  estMinutes: 30,
  honesty: 'live',
  honestyNote: 'The Function URL, its 403 without a resource policy and the 200 after add-permission are enforced by the emulator. The emulator opens the URL after the InvokeFunctionUrl statement alone; real AWS needs both statements (shown here). The URL is an emulator address, not a *.lambda-url.<region>.on.aws host.',
  examTags: ['DVA:Dev', 'DVA:Sec', 'SAA:Secure'],
  breakItCheck: 'breakit',
  httpProbe: true,
  title: 'Function URLs and the resource policy that opens them',
  tagline: 'A public HTTPS endpoint in one command, and the two policy statements that decide whether anyone can use it.',
  predict: [
    { id: 'p1', prompt: 'You create a Function URL with auth type NONE and immediately call it from a browser. What do you get?', options: ['200, NONE means public', '403 Forbidden: the URL exists but the function resource policy does not allow public invokes yet', '404, the URL is not ready', '401 with a WWW-Authenticate header'], answer: 1, explain: 'Since the permissions change, creating a NONE URL is not enough: the function needs resource-based policy statements granting lambda:InvokeFunctionUrl (with the lambda:FunctionUrlAuthType NONE condition) and lambda:InvokeFunction to the principal *. Until then the caller gets {"Message":"Forbidden"}.' },
    { id: 'p2', prompt: 'Which auth type makes callers sign the request with SigV4?', options: ['NONE', 'AWS_IAM', 'JWT', 'COGNITO'], answer: 1, explain: 'Function URLs support exactly two auth types: NONE (public, you do your own auth) and AWS_IAM (SigV4; the caller needs lambda:InvokeFunctionUrl through an identity policy or the resource policy). There is no built-in JWT or Cognito authoriser on a Function URL: that is API Gateway.' },
    { id: 'p3', prompt: 'Why might you still choose API Gateway over a Function URL?', options: ['Function URLs cannot invoke Lambda', 'API Gateway adds throttling, usage plans, WAF, JWT/Cognito/Lambda authorisers, request validation and custom domains', 'Function URLs are slower', 'API Gateway is free'], answer: 1, explain: 'A Function URL is the cheapest way to expose a single function over HTTPS: no extra cost, up to a 15 minute timeout when streaming. It has no built-in throttling, API keys, WAF integration or custom domains; for those features you front the function with API Gateway or CloudFront.' },
  ],
  concept: [
    "A **Function URL** is a dedicated HTTPS endpoint for one function (or alias): `https://<url-id>.lambda-url.<region>.on.aws`. You enable it with `create-function-url-config` and choose an **auth type**. `AWS_IAM` requires callers to sign requests with SigV4 and to hold `lambda:InvokeFunctionUrl`; `NONE` makes the endpoint public and moves authentication into your code. It costs nothing beyond normal invocation charges, the request and response use the same payload format as API Gateway HTTP APIs (payload format 2.0), it supports `BUFFERED` (6 MB) and `RESPONSE_STREAM` invoke modes, and you can configure CORS on it. What it does not have: throttling controls, API keys and usage plans, WAF, built-in authorisers, custom domains (put CloudFront in front) or request validation.",
    "The security model is the exam core. A Function URL does not bypass Lambda authorisation: access is decided by IAM, which for a public endpoint means the **function's resource-based policy**. For an auth type of NONE you need two statements for `Principal: \"*\"`. One allows **`lambda:InvokeFunctionUrl`** with the condition `lambda:FunctionUrlAuthType = NONE`. Since the 2025 change a second statement allowing **`lambda:InvokeFunction`** (with `lambda:InvokedViaFunctionUrl = true` when you want to limit it to the URL path) is also required. The console adds them for you; the CLI and IaC (CloudFormation, SAM, CDK `FunctionUrlAuthType`) do not always, which is why 'I created a NONE URL and it returns 403' is a common troubleshooting question. For `AWS_IAM` the caller needs the permission in its identity policy, or in the resource policy for cross-account callers, and **both sides** are evaluated for cross-account.",
    "Read the failure modes by status code. `403 {\"Message\":\"Forbidden\"}` means the call reached Lambda but authorisation failed: wrong or missing resource policy for NONE, or an unsigned/under-permissioned request for AWS_IAM. A `502` means the function ran but failed (it threw, timed out) or returned something that cannot be turned into an HTTP response. Throttling shows as `429`. Because the URL is public the moment the policy exists, treat `NONE` as 'anyone on the internet can run this and I pay for it': add your own auth, rate-limit upstream, and set reserved concurrency to cap the blast radius and cost.",
    "In this module you create the URL, open it in the HTTP probe panel and see the 403, then add the two statements one at a time and watch it open. Honest note: this emulator opens the URL after the `InvokeFunctionUrl` statement alone, while real AWS requires both, so add both and read the policy with `get-policy`.",
  ],
  goal: 'A NONE Function URL on `web`, a 403 seen first, the two resource policy statements added, and the HTTP probe returning 200.',
  steps: [
    { id: 'look', title: 'Meet the function', body: "The fixture created the role and a function `web` that returns a small JSON response in the HTTP API payload shape (statusCode, headers, body). It has no URL yet." },
    { id: 'create', title: 'Create a public Function URL', body: "Auth type `NONE` means unsigned callers are allowed, as far as the URL goes. Authorisation is still checked against the function's resource policy.", commands: ['aws lambda create-function-url-config --function-name web --auth-type NONE'] },
    { id: 'break', title: 'Break it: call the URL before granting access', body: "Print the URL, then open the **HTTP probe** panel, paste it and press Send with GET. You get **403** and `{\"Message\":\"Forbidden\"}`: the endpoint exists, but nobody is authorised to invoke the function through it.", commands: ['aws lambda get-function-url-config --function-name web --query FunctionUrl --output text'], breakIt: true },
    { id: 'perm-url', title: 'Allow lambda:InvokeFunctionUrl for everyone', body: "The `--function-url-auth-type NONE` option adds the condition `lambda:FunctionUrlAuthType = NONE`, so this statement cannot be abused if you later switch the URL to `AWS_IAM`. `'*'` is quoted so nothing expands it.", commands: [`aws lambda add-permission --function-name web --statement-id url-public --action lambda:InvokeFunctionUrl --principal '*' --function-url-auth-type NONE`] },
    { id: 'perm-invoke', title: 'Also allow lambda:InvokeFunction', body: "Real AWS requires this second statement for a public URL. `--invoked-via-function-url` limits it to calls that come through the URL (condition `lambda:InvokedViaFunctionUrl = true`), so the function is not made publicly invocable through the API.", commands: [`aws lambda add-permission --function-name web --statement-id invoke-via-url --action lambda:InvokeFunction --principal '*' --invoked-via-function-url`] },
    { id: 'open', title: 'Send the same GET again', body: "Go back to the HTTP probe and press Send again: now **200** with the JSON body. Read the policy to see exactly what you granted.", commands: ["aws lambda get-policy --function-name web --query Policy --output text"] },
  ],
  breakIt: {
    title: 'A NONE Function URL with no resource policy',
    command: 'aws lambda get-function-url-config --function-name web --query FunctionUrl --output text',
    explain: [
      "`403` and `{\"Message\":\"Forbidden\"}` from the URL, even though auth type is NONE. NONE only says 'do not require SigV4'. Lambda still evaluates the function's resource-based policy and, with no statement allowing `lambda:InvokeFunctionUrl` for the caller, denies the request. The handler never runs, so there is nothing in CloudWatch Logs to find.",
      "The fix is two statements on the function (not on the role): `lambda:InvokeFunctionUrl` with `lambda:FunctionUrlAuthType = NONE`, and `lambda:InvokeFunction`. For `AWS_IAM` URLs the 403 has a different cause: the request was unsigned or the caller's IAM policy lacks `lambda:InvokeFunctionUrl`.",
    ],
  },
  realAws: {
    cost: [
      "A Function URL itself is free: you pay normal Lambda requests and duration. Because a NONE URL is reachable by anyone, a public endpoint can be hit by bots and you pay for those invocations, so cap it with reserved concurrency and front it with CloudFront or API Gateway with WAF when it matters.",
    ],
    differences: [
      "The emulator serves the URL from its own address (`https://127.0.0.1:<port>/_aws/lambda-url/<id>/`); real URLs look like `https://<id>.lambda-url.<region>.on.aws`, are HTTPS only, and can be put behind CloudFront for a custom domain.",
      "The emulator opens a NONE URL after the InvokeFunctionUrl statement alone. Real AWS needs InvokeFunctionUrl and InvokeFunction, so a policy that works here with one statement can still 403 on AWS.",
      "Real Function URLs also support CORS configuration, RESPONSE_STREAM streaming and AWS_IAM with SigV4; this module exercises the public NONE path only.",
    ],
    asOf: '2026-11-13',
    sources: [
      { label: 'Creating and managing Lambda function URLs', url: 'https://docs.aws.amazon.com/lambda/latest/dg/urls-configuration.html' },
      { label: 'Control access to Lambda function URLs', url: 'https://docs.aws.amazon.com/lambda/latest/dg/urls-auth.html' },
      { label: 'Resource-based policies for Lambda', url: 'https://docs.aws.amazon.com/lambda/latest/dg/access-control-resource-based.html' },
    ],
  },
  fidelity: [{ service: 'Lambda', pass: 395, total: 788 }, { service: 'IAM', pass: 502, total: 692 }],
  files: ['web.mjs', 'web.zip'],
  probeNote: 'The checks call the Function URL themselves, and read the calls you made from the HTTP probe panel.',
  checks: [
    { id: 'url', label: 'Function `web` has a Function URL with auth type NONE', hint: 'Run create-function-url-config --auth-type NONE.' },
    { id: 'breakit', label: 'You saw 403 Forbidden from the URL in the HTTP probe, before granting access', hint: 'Open the URL in the HTTP probe before running add-permission.' },
    { id: 'perm-url', label: 'The policy allows lambda:InvokeFunctionUrl for * with FunctionUrlAuthType NONE', hint: 'Run the first add-permission command.' },
    { id: 'perm-invoke', label: 'The policy also allows lambda:InvokeFunction', hint: 'Run the second add-permission command.' },
    { id: 'open', label: 'The URL now answers 200 with the JSON body', hint: 'Send the GET again in the HTTP probe.' },
  ],
}
