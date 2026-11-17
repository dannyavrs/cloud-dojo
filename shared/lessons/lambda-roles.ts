import type { LessonContent } from '../types'

export const lambdaRoles: LessonContent = {
  id: 'lambda-roles',
  n: '4.1',
  trackId: 'lambda',
  level: 'core',
  prereqs: [],
  estMinutes: 25,
  honesty: 'live',
  examTags: ["DVA:Dev", "DVA:Deploy", "SAA:Performant"],
  predict: [{"id": "p1", "prompt": "The `writer` function runs before its role allows `dynamodb:PutItem`. What does `aws lambda invoke` report?", "options": ["The invoke call itself fails with AccessDenied", "StatusCode 200 with a FunctionError, because the failure happened inside your code", "The function is not created at all", "The write succeeds because Lambda uses the emulator root key"], "answer": 1, "explain": "The invoke API succeeded (200). The AccessDenied is raised inside the function when it calls DynamoDB, so it comes back as FunctionError."}],

  title: 'Lambda: functions, roles, logs',
  tagline: 'Deploy code, call it, read its logs, and fix the permission it is missing.',
  concept: [
    'A **Lambda function** is code AWS runs when something calls it, billed per request and per millisecond of memory-time. It runs as an **execution role**: an IAM role that Lambda is trusted to assume. The function can do only what that role allows. Anything it prints is logged (on real AWS, to **CloudWatch Logs** under `/aws/lambda/<name>`).',
    'The starter folder has `index.mjs` (a tiny handler), `function.zip` (that file zipped), `writer.mjs`/`writer.zip` (a handler that writes to the `Notes` table), `trust.json` and `writer-policy.json`. The Files button shows them. A table `Notes` already exists.',
    'Fidelity note: Lambda is the weakest core service in the emulator (about 50%), so handlers here are tiny and use only the bundled AWS SDK.',
  ],
  goal: 'A working `hello` function, then a `writer` function that fails with AccessDenied until you give its role one scoped permission.',
  steps: [
    { id: 'role', title: 'Create the execution role', body: '`trust.json` says "the Lambda service may assume this role". It has no permissions yet.', commands: ['aws iam create-role --role-name lambda-exec --assume-role-policy-document file://trust.json'] },
    { id: 'create', title: 'Create the function', body: 'Handler `index.handler` = file `index`, export `handler`.', commands: ['aws lambda create-function --function-name hello --runtime nodejs22.x --handler index.handler --role arn:aws:iam::000000000000:role/lambda-exec --zip-file fileb://function.zip'] },
    { id: 'wait', title: 'Wait until it is Active', body: 'Functions start in `Pending`.', commands: ['aws lambda wait function-active-v2 --function-name hello'] },
    { id: 'invoke', title: 'Invoke it', body: 'The response body is written to `out.json` (open it in Files).', commands: [`aws lambda invoke --function-name hello --cli-binary-format raw-in-base64-out --payload '{"name":"Danny"}' out.json`] },
    { id: 'logs', title: 'Read its logs', body: 'Whatever the handler `console.log`s is captured. `--log-type Tail` returns the last lines of the log with the response, base64-encoded (the terminal decodes it for you underneath). In real AWS the same lines also land in CloudWatch Logs under `/aws/lambda/hello`; in this emulator that log group only appears for event-driven invocations (you will use it in lesson 6).', commands: [`aws lambda invoke --function-name hello --log-type Tail --cli-binary-format raw-in-base64-out --payload '{"name":"Danny"}' --query LogResult --output text out.json`] },
    { id: 'writer', title: 'Deploy the writer', body: 'Same role, new function that calls DynamoDB `PutItem`.', commands: ['aws lambda create-function --function-name writer --runtime nodejs22.x --handler writer.handler --role arn:aws:iam::000000000000:role/lambda-exec --zip-file fileb://writer.zip', 'aws lambda wait function-active-v2 --function-name writer'] },
    { id: 'break', title: 'Break it: invoke the writer', body: 'The call succeeds (HTTP 200) but the function itself fails. Open `writer-out.json`.', commands: [`aws lambda invoke --function-name writer --cli-binary-format raw-in-base64-out --payload '{"text":"from lambda"}' writer-out.json`], breakIt: true },
    { id: 'fix', title: 'Grant exactly PutItem on that table', body: '`writer-policy.json` allows `dynamodb:PutItem` on the `Notes` ARN only. Then invoke again and scan the table.', commands: ['aws iam put-role-policy --role-name lambda-exec --policy-name notes-put --policy-document file://writer-policy.json', `aws lambda invoke --function-name writer --cli-binary-format raw-in-base64-out --payload '{"text":"from lambda"}' writer-out.json`, 'aws dynamodb scan --table-name Notes --query "Items[].pk.S" --output text'] },
  ],
  breakIt: {
    title: 'A function whose role lacks dynamodb:PutItem',
    command: `aws lambda invoke --function-name writer --cli-binary-format raw-in-base64-out --payload '{"text":"from lambda"}' writer-out.json`,
    explain: [
      'The invoke itself returns `StatusCode 200` with `FunctionError: Unhandled`; the real error is inside the response file: `AccessDeniedException ... assumed-role/lambda-exec ... not authorized to perform: dynamodb:PutItem`. Always read the payload, not just the status code.',
      'The fix is a statement scoped to one action and one table ARN, not `dynamodb:*` on `*`. That is the habit that keeps real accounts safe.',
    ],
  },
  realAws: {
    cost: [
      'Lambda: $0.20 per million requests and $0.0000166667 per GB-second (x86), with a monthly free tier of 1M requests and 400,000 GB-seconds (AWS Lambda pricing page).',
      'CloudWatch Logs ingestion is billed per GB after a small free allowance (about $0.50/GB in most examples; the page shows conflicting tiers, so treat it as approximate).',
    ],
    differences: [
      'Real Lambda starts a sandbox per concurrent request (cold starts), enforces timeouts/memory limits and many runtimes. The emulator runs handlers in an in-process engine and covers only part of that.',
      'Real execution roles can take a moment to propagate; real AWS may fail the first create-function with "role cannot be assumed" if you act too fast.',
    ],
    asOf: '2026-11-13',
    sources: [{ label: 'Lambda pricing', url: 'https://aws.amazon.com/lambda/pricing/' }, { label: 'CloudWatch pricing', url: 'https://aws.amazon.com/cloudwatch/pricing/' }],
  },
  fidelity: [{ service: 'Lambda', pass: 395, total: 788 }, { service: 'IAM', pass: 502, total: 692 }, { service: 'CloudWatch Logs', pass: 487, total: 643 }],
  files: ['index.mjs', 'function.zip', 'writer.mjs', 'writer.zip', 'trust.json', 'writer-policy.json'],
  probeNote: 'The probe check invokes `hello` with a test payload when you press Check.',
  checks: [
    { id: 'role', label: 'Role `lambda-exec` trusts lambda.amazonaws.com', hint: 'Run step 1.' },
    { id: 'fn', label: 'Function `hello` is Active on nodejs22.x', hint: 'Steps 2 and 3.' },
    { id: 'probe', label: 'Invoking `hello` returns the expected greeting', hint: 'Press Check after deploying `hello`.' },
    { id: 'policy', label: 'Role has a scoped policy (PutItem on Notes, no wildcard action)', hint: 'Run the fix step.' },
    { id: 'written', label: 'The `writer` function wrote an item to Notes', hint: 'Invoke writer after the policy is attached.' },
  ],
}
