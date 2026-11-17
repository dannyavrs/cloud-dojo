import type { LessonContent } from '../types'

const ROLE = 'arn:aws:iam::000000000000:role/lambda-exec'
const INV = `aws lambda invoke --function-name cfg --cli-binary-format raw-in-base64-out`

export const WARM_HANDLER = `let calls = 0; // module scope: survives between invokes only if the sandbox is reused

export const handler = async (event) => {
  calls += 1;
  console.log("event", JSON.stringify(event));
  if (event.mode === "throw") throw new Error("boom: bad input");
  if (event.mode === "soft") return { ok: false, error: "bad input (returned, not thrown)" };
  if (event.mode === "sleep") await new Promise((r) => setTimeout(r, 5000));
  return {
    greeting: process.env.GREETING,
    memory: process.env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE,
    version: process.env.AWS_LAMBDA_FUNCTION_VERSION,
    calls,
  };
};`

export const lambdaConfigErrors: LessonContent = {
  id: 'lambda-config-errors',
  n: '4.2',
  trackId: 'lambda',
  level: 'intermediate',
  prereqs: ['lambda-roles'],
  estMinutes: 40,
  honesty: 'live',
  honestyNote: 'Configuration, FunctionError, timeouts and log tails are enforced by the emulator. Cold versus warm starts and real latency cannot be shown: every invoke gets a fresh sandbox, so a module-level counter is always 1.',
  examTags: ['DVA:Dev', 'DVA:Troubleshoot', 'SAA:Performant'],
  breakItCheck: 'breakit',
  editable: ['handler.mjs'],
  title: 'Lambda configuration and error shapes',
  tagline: 'Memory, timeout and env vars decide how a function runs. FunctionError decides whether you notice it failed.',
  predict: [
    { id: 'p1', prompt: 'You invoke a function synchronously and its handler throws. What does the Invoke API return?', options: ['An HTTP 500 and the CLI exits non-zero', 'HTTP 200 with a FunctionError header; the error details are in the response payload', 'HTTP 502 Bad Gateway', 'HTTP 429 TooManyRequestsException'], answer: 1, explain: 'The Invoke call itself worked, so the status is 200. A failure inside your code is reported through the X-Amz-Function-Error header (Handled or Unhandled) and an {errorType, errorMessage} JSON payload. Only service-level problems (throttling, bad request, missing permission) are real API errors.' },
    { id: 'p2', prompt: 'A handler sleeps 5 seconds and the function timeout is 3 seconds. What do you get?', options: ['The invoke waits 5 seconds and succeeds', 'FunctionError with a "Task timed out after 3.00 seconds" message, and you are billed for the 3 seconds', 'The invoke call fails with HTTP 408', 'Lambda silently extends the timeout to 5 seconds'], answer: 1, explain: 'The runtime is killed at the timeout. The call returns 200 with FunctionError and a timeout message, and you pay for the time used. The maximum timeout you can configure is 900 seconds (15 minutes).' },
    { id: 'p3', prompt: 'A handler catches its own error and returns { statusCode: 500, body: "failed" } instead of throwing. How does Lambda see that invocation?', options: ['As a failure, because of statusCode 500', 'As a success: there is no FunctionError, and an async caller would not retry it', 'As a Handled error', 'It depends on the runtime'], answer: 1, explain: 'Lambda only knows "returned" or "threw". A returned object, whatever it says inside, is a successful invocation. Retries, error metrics and destinations react to thrown errors, which is why swallowing an error can hide failures from your alarms.' },
  ],
  concept: [
    "A function's **configuration** is small but exam-dense. Memory runs from 128 MB to 10,240 MB, and **CPU is allocated in proportion to memory** (about one full vCPU at 1,769 MB, up to six vCPUs at the top), so raising memory is the standard way to make CPU-bound code faster and is sometimes cheaper overall because the duration drops. The **timeout** defaults to 3 seconds and tops out at **900 seconds (15 minutes)**; anything longer belongs in Step Functions, ECS/Fargate or Batch. `/tmp` gives 512 MB by default and up to 10 GB. **Environment variables** are limited to 4 KB in total, are encrypted at rest with an AWS managed key by default, and can use a customer managed KMS key; for real secrets prefer Secrets Manager or Parameter Store, because an env var is visible to anyone with `lambda:GetFunctionConfiguration`. Updating variables **replaces the whole map**: send only the key you changed and the others disappear. A change applies to `$LATEST` only, never to a published version.",
    "The error model trips people up. A **synchronous** invoke returns HTTP 200 whenever the service ran your code, even if the code failed. Failure shows up as the `FunctionError` field (`Unhandled` for a thrown error, a timeout or an out-of-memory kill) and a payload shaped like `{\"errorType\", \"errorMessage\", \"trace\"}`. Real API errors are different: `TooManyRequestsException` (429, throttling), `ResourceNotFoundException`, `AccessDeniedException`, `RequestEntityTooLargeException` (6 MB sync payload limit) are failures of the call, not of your code. For **asynchronous** invokes (`--invocation-type Event`) the caller gets 202 immediately and Lambda retries a failed function twice (after about 1 and then 2 minutes) before giving up, so a handler that throws is retried while a handler that returns an error object is considered done. For synchronous callers retries are your job. Returning `{ statusCode: 500 }` is a normal success to Lambda, which is correct behaviour behind API Gateway and a trap when you wanted an alarm.",
    "Diagnosing in practice: `--log-type Tail` returns the last 4 KB of the invocation log in `LogResult` (base64, only on synchronous invokes) with the START/END/REPORT lines, where REPORT shows duration, billed duration and the memory you configured versus the memory you used. On real AWS the full log goes to CloudWatch Logs `/aws/lambda/<name>`, which requires the execution role to allow `logs:CreateLogGroup`, `CreateLogStream` and `PutLogEvents` (the managed `AWSLambdaBasicExecutionRole`). A missing log group is almost always a missing permission. Out of memory shows up as `Runtime.OutOfMemory` and a timeout as a message containing `Task timed out`; both are `Unhandled`. Initialisation code (everything outside the handler) runs once per sandbox, which is why SDK clients are created at module scope and reused across invokes.",
    "Be clear about what this emulator cannot teach. On real AWS the module-level `calls` counter below would climb on repeated invokes while a sandbox stays warm, the first invoke after a deploy or idle period pays a **cold start** (runtime init plus your init code, tens of milliseconds to several seconds), and **SnapStart** or **provisioned concurrency** exist to remove it. Here every invoke gets a fresh sandbox, so the counter is always 1 and latency numbers mean nothing. You will run that experiment at the end and read the result as 'what the emulator does', not 'what AWS does'. Everything else in this module, memory, timeout, env, FunctionError, Sandbox.Timedout and log tails, is enforced for real.",
  ],
  goal: 'A function with a 256 MB memory size, a 3 s timeout and an env var; you saw Unhandled and returned errors side by side, read a log tail, broke the timeout on purpose and fixed it.',
  steps: [
    { id: 'look', title: 'Read the handler', body: "The fixture created the role `lambda-exec`. Open `handler.mjs`: one function with four behaviours chosen by `event.mode`: normal, `throw`, `soft` (returns an error object) and `sleep` (waits 5 seconds). It reports `GREETING` and the configured memory from its environment." },
    { id: 'create', title: 'Create it with explicit configuration', body: "Memory 256, timeout 3 and one environment variable. The `Variables={...}` shorthand is the CLI's way to pass the map.", commands: [`aws lambda create-function --function-name cfg --runtime nodejs22.x --handler handler.handler --role ${ROLE} --zip-file fileb://handler.zip --memory-size 256 --timeout 3 --environment 'Variables={GREETING=hello}'`, 'aws lambda wait function-active-v2 --function-name cfg'] },
    { id: 'ok', title: 'Invoke it: the happy path', body: "`ok.json` holds the function's return value. The terminal shows only the invoke metadata (`StatusCode`, `ExecutedVersion`). Open `ok.json` in Files and find `greeting` and `memory`.", commands: [`${INV} --payload '{}' ok.json`] },
    { id: 'throw', title: 'Make the handler throw', body: "Look at the metadata: the status is still **200**, but now there is a `FunctionError` of `Unhandled`. The shape of `err.json` is `errorType`, `errorMessage` and a `trace`.", commands: [`${INV} --payload '{"mode":"throw"}' err.json`] },
    { id: 'soft', title: 'Return an error instead of throwing', body: "Same bad input, but the handler returns an error object. There is no `FunctionError` this time: Lambda considers it a success. This is the difference an async retry or a CloudWatch error alarm cares about.", commands: [`${INV} --payload '{"mode":"soft"}' soft.json`] },
    { id: 'env', title: 'Change an env var, then invoke again', body: "`update-function-configuration` replaces the entire variable map. Wait for the update to finish before invoking, otherwise you may still hit the old configuration.", commands: ['aws lambda update-function-configuration --function-name cfg --environment \'Variables={GREETING=hola}\'', 'aws lambda wait function-updated-v2 --function-name cfg', `${INV} --payload '{}' ok2.json`] },
    { id: 'logs', title: 'Read the log tail', body: "`--log-type Tail` adds the last 4 KB of the log to the response as base64 (the terminal decodes it for you). Find the START, your `event` line, END and REPORT with duration and memory size.", commands: [`${INV} --payload '{"mode":"throw"}' tail.json --log-type Tail --query LogResult --output text`] },
    { id: 'break', title: 'Break it: sleep longer than the timeout', body: "The handler sleeps 5 s and the timeout is 3 s. You get 200 + `Unhandled` again, but this time the message in `timeout.json` says the task timed out (the emulator names it `Sandbox.Timedout`). You are billed for the 3 seconds you used.", commands: [`${INV} --payload '{"mode":"sleep"}' timeout.json`], breakIt: true },
    { id: 'fix', title: 'Fix it: raise the timeout above the work', body: "Set the timeout to 8 seconds and run the same invoke. It takes about 5 seconds now and succeeds. Real AWS would tell you to fix the cause first (why does it take 5 s?), then size the timeout with headroom.", commands: ['aws lambda update-function-configuration --function-name cfg --timeout 8', 'aws lambda wait function-updated-v2 --function-name cfg', `${INV} --payload '{"mode":"sleep"}' fixed.json`] },
    { id: 'edit', title: 'Cold versus warm: the honest experiment', body: "Replace `handler.mjs` with this version (it keeps a counter at module scope) and Save; the editor rebuilds `handler.zip`. Deploy it with `update-function-code`, then invoke twice and compare `calls` in `warm1.json` and `warm2.json`. On real AWS the second call usually reports 2 (warm sandbox). Here both report 1, because the emulator starts a fresh sandbox for every invoke. That is a limit of the emulator, not how Lambda behaves.", code: { file: 'handler.mjs', text: WARM_HANDLER } },
    { id: 'warm', title: 'Deploy the new code and invoke twice', body: "`update-function-code` changes `$LATEST` only. Wait for `function-updated-v2` before invoking.", commands: ['aws lambda update-function-code --function-name cfg --zip-file fileb://handler.zip', 'aws lambda wait function-updated-v2 --function-name cfg', `${INV} --payload '{}' warm1.json`, `${INV} --payload '{}' warm2.json`] },
  ],
  breakIt: {
    title: 'A handler that runs longer than its timeout',
    command: `${INV} --payload '{"mode":"sleep"}' timeout.json`,
    explain: [
      "The invoke returns `StatusCode: 200` and `FunctionError: Unhandled`; the payload says the task timed out after 3.00 seconds (the emulator labels the type `Sandbox.Timedout`). Nothing about the HTTP status tells you something went wrong, which is why every client needs to check `FunctionError`.",
      "On real AWS the same thing happens with one extra cost: you are billed for the full 3 seconds of a failed run, and for an async invoke Lambda would retry it twice. The right fix is rarely 'a bigger timeout': look at what the function waits for (a downstream API, a VPC cold ENI, a heavy init), consider more memory for more CPU, and keep the timeout comfortably below the caller's own timeout (API Gateway cuts off at 29 seconds, whatever your function does).",
    ],
  },
  realAws: {
    cost: [
      "Lambda bills requests plus GB-seconds, where the GB is your configured memory, not what you used. Doubling memory doubles the per-ms price but can halve the duration, so cost is flat or lower for CPU-bound work; measure with the Lambda Power Tuning approach before guessing. Free tier and exact prices are on the Lambda pricing page.",
      "Failed and timed-out invocations are billed for their duration. Init time is billed too for most runtimes. Check current rates before relying on a number.",
    ],
    differences: [
      "Real Lambda reuses warm sandboxes, so module-level state, `/tmp` contents and open connections survive between invokes; the emulator does not, so never infer caching or connection-reuse behaviour from it.",
      "Real timeouts are enforced by killing the runtime; the message is `Task timed out after N seconds` and the `errorType` is not `Sandbox.Timedout` in every runtime. Treat the type string as emulator-specific.",
      "Real AWS also enforces the 6 MB synchronous payload limit (256 KB async), the 4 KB env var cap and the 10 GB memory ceiling. The emulator accepts the configuration but you should know the numbers for the exam.",
    ],
    asOf: '2026-11-13',
    sources: [
      { label: 'Configuring Lambda function memory', url: 'https://docs.aws.amazon.com/lambda/latest/dg/configuration-memory.html' },
      { label: 'Using Lambda environment variables', url: 'https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars.html' },
      { label: 'Understanding the Lambda execution environment lifecycle', url: 'https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html' },
      { label: 'Lambda quotas', url: 'https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html' },
    ],
  },
  fidelity: [{ service: 'Lambda', pass: 395, total: 788 }, { service: 'IAM', pass: 502, total: 692 }],
  files: ['handler.mjs', 'handler.zip'],
  checks: [
    { id: 'fn', label: 'Function `cfg` is Active with 256 MB memory and the `GREETING` variable', hint: 'Run the create step with --memory-size 256 and --environment.' },
    { id: 'ok', label: 'You invoked it and the payload shows the env var and the 256 MB memory size', hint: 'Run the happy-path invoke and write the result to ok.json.' },
    { id: 'unhandled', label: 'You saw FunctionError: Unhandled from a handler that throws', hint: 'Invoke with the payload {"mode":"throw"}.' },
    { id: 'env', label: 'The `GREETING` variable was updated to `hola`', hint: 'Run update-function-configuration with Variables={GREETING=hola}.' },
    { id: 'logs', label: 'You read an invocation log tail with --log-type Tail', hint: 'Run the log tail step.' },
    { id: 'breakit', label: 'You triggered a timeout (handler slept 5 s with a 3 s timeout)', hint: 'Run the break-it invoke while the timeout is still 3 seconds.' },
    { id: 'fixed', label: 'The timeout is 6 s or more and the slow invoke now succeeds', hint: 'Raise the timeout (step 9) and invoke the sleep payload again.' },
    { id: 'warm', label: 'You deployed the counter handler and invoked it (the emulator always reports calls = 1)', hint: 'Edit handler.mjs, update-function-code, then invoke twice.' },
  ],
}
