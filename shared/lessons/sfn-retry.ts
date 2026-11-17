import type { LessonContent } from '../types'

const ROLE = 'arn:aws:iam::000000000000:role/sfn-exec'
const SM = 'arn:aws:states:us-east-1:000000000000:stateMachine:payment'
const EXEC = (n: string) => `arn:aws:states:us-east-1:000000000000:execution:payment:${n}`
const START = (n: string, failFirst: number) => `aws stepfunctions start-execution --state-machine-arn ${SM} --name ${n} --input '{"id":"${n}","failFirst":${failFirst}}'`

export const CHARGE_SOURCE = `import { DynamoDBClient, UpdateItemCommand } from "@aws-sdk/client-dynamodb";
const ddb = new DynamoDBClient({});

// Counts attempts per input id in DynamoDB (every invoke gets a fresh sandbox, so memory cannot count).
// Fails with a Transient error for the first \`failFirst\` attempts, then succeeds.
export const handler = async (event) => {
  const r = await ddb.send(new UpdateItemCommand({
    TableName: "attempts",
    Key: { id: { S: String(event.id) } },
    UpdateExpression: "ADD n :one",
    ExpressionAttributeValues: { ":one": { N: "1" } },
    ReturnValues: "UPDATED_NEW",
  }));
  const n = Number(r.Attributes.n.N);
  if (n <= (event.failFirst ?? 0)) {
    throw Object.assign(new Error("gateway timeout on attempt " + n), { name: "Transient" });
  }
  return { charged: true, attempts: n };
};
`

export const PLAIN_ASL = `{
  "Comment": "Charge a card through the charge Lambda",
  "StartAt": "Charge",
  "States": {
    "Charge": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": { "FunctionName": "charge", "Payload.$": "$" },
      "OutputPath": "$.Payload",
      "End": true
    }
  }
}
`

export const RETRY_ASL = `{
  "Comment": "Charge a card through the charge Lambda, retrying transient failures",
  "StartAt": "Charge",
  "States": {
    "Charge": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": { "FunctionName": "charge", "Payload.$": "$" },
      "OutputPath": "$.Payload",
      "Retry": [
        {
          "ErrorEquals": ["Transient"],
          "IntervalSeconds": 1,
          "MaxAttempts": 2,
          "BackoffRate": 2
        }
      ],
      "End": true
    }
  }
}
`

export const sfnRetry: LessonContent = {
  id: 'sfn-retry',
  n: '8.1',
  trackId: 'stepfunctions',
  level: 'intermediate',
  prereqs: ['lambda-roles'],
  estMinutes: 30,
  honesty: 'live',
  honestyNote: 'The emulator runs real Standard executions: Task states invoke the Lambda, Retry waits and backs off, the execution history records every attempt, and invalid ASL is rejected at create time. It also enforces the state machine role\'s identity policy. It does not check the role\'s trust policy when you create the machine, so do not rely on that on AWS.',
  examTags: ['SAA:Resilient', 'DVA:Dev', 'DVA:Troubleshoot'],
  breakItCheck: 'breakit',
  editable: ['workflow.asl.json'],
  title: 'First workflow: Retry with exponential backoff',
  tagline: 'Let Step Functions retry a flaky Lambda, and read the attempts back out of the execution history.',
  predict: [
    { id: 'p1', prompt: 'A Task has `"Retry": [{"ErrorEquals": ["Transient"], "IntervalSeconds": 1, "MaxAttempts": 2, "BackoffRate": 2}]` and the Lambda fails with `Transient` every time. How many times is the Lambda invoked, and how long are the pauses?', options: ['2 invocations, one 1-second pause', '3 invocations (the first try plus 2 retries), pauses of about 1 s then 2 s', '2 invocations, pauses of 2 s then 4 s', 'Unlimited: Retry only stops on success'], answer: 1, explain: 'MaxAttempts counts retries, not the first try. The wait before retry n is IntervalSeconds x BackoffRate^(n-1): 1 s, then 2 s. After the last retry fails the error is passed on, and with no Catch the whole execution fails.' },
    { id: 'p2', prompt: 'You leave `MaxAttempts` out of a Retry block entirely. What happens on a matching error?', options: ['Retry is ignored', 'It retries forever', 'It uses the default of 3 retries', 'It retries once'], answer: 2, explain: 'The defaults are IntervalSeconds 1, MaxAttempts 3 and BackoffRate 2.0. `MaxAttempts: 0` is how you say "never retry this error". A forgotten limit is therefore not infinite, but 3 retries of a non-idempotent charge can still hurt.' },
    { id: 'p3', prompt: 'A state machine definition has `"StartAt": "X"` but only a state called `Y`. What happens when you call create-state-machine?', options: ['It is created, and every execution fails immediately', 'It is rejected with InvalidDefinition and a MISSING_TRANSITION_TARGET diagnostic', 'It is created and X is added automatically', 'It is created in an INACTIVE status'], answer: 1, explain: 'Step Functions validates the Amazon States Language structure when you create or update a machine, so a dangling StartAt or Next never reaches runtime. `validate-state-machine-definition` runs the same checks without creating anything and returns a list of diagnostics with a code and a location.' },
  ],
  concept: [
    "**Orchestration instead of chaining.** A Lambda that calls the next Lambda has to carry the retry loops, the timeouts, the error routing and the state of \"where am I\" in its own code, and it pays for waiting. Step Functions moves that into a declarative state machine written in **Amazon States Language (ASL)**: a JSON document whose `States` map names every step and whose `Next` fields draw the arrows. A **Standard** workflow keeps a durable, per-execution event history (every state entry, task attempt, failure and exit) for up to a year, runs exactly once per state transition and is billed per **state transition**. The service calls your Lambda through the **optimized integration** `arn:aws:states:::lambda:invoke`, which wraps the result as `{ ExecutedVersion, Payload, StatusCode }`. That wrapper is why `OutputPath: \"$.Payload\"` appears in almost every example: it unwraps the function's real return value.",
    "**Retry** is a list of rules on a Task (also Parallel and Map) evaluated in order when the state raises an error. Each rule has `ErrorEquals` (names such as `Transient`, or the reserved `States.TaskFailed`, `States.Timeout`, `States.Permissions`, `States.ALL`), `IntervalSeconds` (default 1), `MaxAttempts` (default 3, `0` disables) and `BackoffRate` (default 2.0), plus optional `MaxDelaySeconds` and `JitterStrategy: FULL` to avoid synchronised retry storms. The first rule that matches an error name owns it, and its attempt counter is separate from other rules. `States.ALL` matches everything except `States.DataLimitExceeded` and must be the only error name in the last rule. When the attempts are used up the error leaves the state: a `Catch` can route it (next module), otherwise the execution ends `FAILED` with that error and cause. A function's `errorType` becomes the Step Functions error name, so a Node handler that throws an error with `name = \"Transient\"` can be matched exactly.",
    "**Exam traps.** (1) Lambda itself can fail with service-level errors that your code never threw (`Lambda.ServiceException`, `Lambda.AWSLambdaException`, `Lambda.SdkClientException`, `Lambda.TooManyRequestsException`); AWS recommends an explicit Retry for them on every `lambda:invoke` task, and a Retry on only your custom name misses them. (2) Retries re-run a non-idempotent side effect, so a payment Lambda needs an idempotency key (the DynamoDB conditional write from track 3 is the usual fix). (3) Retry is for **transient** errors; business errors such as `PaymentDeclined` belong in Catch, because retrying them just wastes transitions and time. (4) Every retry is another state transition on the bill and another few events in the 25,000-event history cap of a Standard execution. (5) The state machine **role** is separate from the Lambda role: it must trust `states.amazonaws.com` and be allowed `lambda:InvokeFunction`, otherwise the Task fails with a permissions error even though the code is fine. The emulator enforces that identity policy, which you can see by removing the action from `sfn-exec`.",
    "In this module the fixture gives you a `charge` function that counts attempts per `id` in a DynamoDB table and throws `Transient` for the first `failFirst` attempts. You first run a machine with no Retry and watch one failure end the execution. Then you add Retry in the editor, update the machine and run it twice: once with 2 failures (the third attempt succeeds, history shows two `TaskFailed` events and then `TaskSucceeded`) and once with 5 failures (three attempts, all fail, `ExecutionFailed`). Finally you break the definition on purpose and see that `create-state-machine` and `validate-state-machine-definition` catch it before anything runs.",
  ],
  goal: 'A state machine `payment` whose Charge task retries `Transient` errors twice with backoff, one execution that recovered on the third attempt, one that exhausted its retries, and a validated rejection of a broken definition.',
  steps: [
    { id: 'role', title: 'Check who the machine runs as', body: "The fixture created the role `sfn-exec` for state machines and the function `charge` plus a table `attempts`. A state machine **assumes a role** to call other services, and the role must trust `states.amazonaws.com`. Read its trust policy. Open `workflow.asl.json` and `charge.mjs` in Files: the machine has one Task and no Retry.", commands: ['aws iam get-role --role-name sfn-exec --query Role.AssumeRolePolicyDocument'] },
    { id: 'create', title: 'Create the state machine', body: "ASL is read from the file. A Standard machine is the default type. The ARN is predictable: `arn:aws:states:us-east-1:000000000000:stateMachine:payment`.", commands: [`aws stepfunctions create-state-machine --name payment --definition file://workflow.asl.json --role-arn ${ROLE}`] },
    { id: 'plain', title: 'Run it without Retry', body: "Ask for one failure (`failFirst` 1). Executions are asynchronous: `start-execution` returns at once, so wait two seconds and describe it. Without Retry the very first `Transient` error ends the execution.", commands: [START('plain', 1), `aws stepfunctions describe-execution --execution-arn ${EXEC('plain')} --query '[status,error]'`] },
    { id: 'edit', title: 'Add a Retry rule', body: "In the editor replace `workflow.asl.json` with this version and Save. The rule retries `Transient` twice, waiting 1 s then 2 s.", code: { file: 'workflow.asl.json', text: RETRY_ASL } },
    { id: 'update', title: 'Update the machine', body: "`update-state-machine` replaces the definition. Executions already started keep the old definition, new ones use the new one.", commands: [`aws stepfunctions update-state-machine --state-machine-arn ${SM} --definition file://workflow.asl.json`] },
    { id: 'recover', title: 'Two failures, then success', body: "`failFirst` 2 means attempts 1 and 2 throw and attempt 3 works. Wait about five seconds (1 s + 2 s of backoff plus the calls), then read the status, the output and the failed attempts out of the history.", commands: [START('recovered', 2), `aws stepfunctions describe-execution --execution-arn ${EXEC('recovered')} --query '[status,output]'`, `aws stepfunctions get-execution-history --execution-arn ${EXEC('recovered')} --query "events[?type=='TaskFailed'].taskFailedEventDetails.error"`] },
    { id: 'exhaust', title: 'Five failures: retries run out', body: "Now the function fails more often than Retry allows. Three attempts all fail, the last error leaves the state and the execution fails with the Lambda's own error name. Count the `TaskFailed` events: 1 try + 2 retries.", commands: [START('exhausted', 5), `aws stepfunctions describe-execution --execution-arn ${EXEC('exhausted')} --query '[status,error]'`, `aws stepfunctions get-execution-history --execution-arn ${EXEC('exhausted')} --query "length(events[?type=='TaskFailed'])"`] },
    { id: 'break', title: 'Break it: a definition that points nowhere', body: "`StartAt` names a state that does not exist. Step Functions refuses the definition before any execution can run. Then ask `validate-state-machine-definition` for the diagnostics it would give an editor: each has a severity, a code and a location.", commands: [`aws stepfunctions create-state-machine --name broken --definition '{"StartAt":"X","States":{"Y":{"Type":"Pass","End":true}}}' --role-arn ${ROLE}`, `aws stepfunctions validate-state-machine-definition --definition '{"StartAt":"X","States":{"Y":{"Type":"Pass","End":true}}}'`], breakIt: true },
  ],
  breakIt: {
    title: 'A StartAt that points at nothing',
    command: `aws stepfunctions create-state-machine --name broken --definition '{"StartAt":"X","States":{"Y":{"Type":"Pass","End":true}}}' --role-arn ${ROLE}`,
    explain: [
      "`InvalidDefinition: Invalid State Machine Definition: 'MISSING_TRANSITION_TARGET: Missing 'Next' target: X at /StartAt, ...'`. The diagnostics name the code, the message and a JSON-pointer location, and the same list also reports that state `Y` is unreachable. The structural checks run at create and update time, so a typo in a `Next` never becomes a 3 a.m. runtime failure.",
      "What validation cannot catch is semantic: a wrong Lambda name, a JSONPath that points at data that is not there, or a role without permission all surface only when an execution reaches that state. Use `validate-state-machine-definition` in CI for the structure, and `test-state` (module 8.5) to try one state with real input.",
    ],
  },
  realAws: {
    cost: [
      "Standard workflows are billed per state transition: $0.025 per 1,000 transitions after a free tier of 4,000 per month (us-east-1, check the pricing page). Every retry attempt is a transition, so a flaky dependency with 3 attempts costs three times as much as a healthy one.",
      "The Lambda invocations, the DynamoDB writes and the data transfer are billed separately as usual. Waiting inside Step Functions (a Retry pause, a Wait state, a callback) is free, whereas a Lambda that sleeps is billed for every millisecond.",
    ],
    differences: [
      "Real AWS also retries Lambda service errors for you only if you ask: add `Lambda.ServiceException`, `Lambda.AWSLambdaException`, `Lambda.SdkClientException` and `Lambda.TooManyRequestsException` to a Retry rule. The emulator never raises them, so you will not see that trap here.",
      "The emulator accepted a state machine whose role is not trusted by `states.amazonaws.com`. Always trust `states.amazonaws.com` (and scope the role's permissions to the exact function and table ARNs) on real AWS.",
      "On AWS a Standard execution history is capped at 25,000 events and an execution runs for at most one year. Retry timing here comes from the same fields, but a one-second interval can drift by a few hundred milliseconds in both worlds.",
    ],
    asOf: '2026-11-15',
    sources: [
      { label: 'Handling errors in Step Functions workflows (Retry, Catch)', url: 'https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html' },
      { label: 'Amazon States Language: Task state', url: 'https://docs.aws.amazon.com/step-functions/latest/dg/state-task.html' },
      { label: 'Step Functions pricing', url: 'https://aws.amazon.com/step-functions/pricing/' },
    ],
  },
  fidelity: [],
  files: ['workflow.asl.json', 'charge.mjs', 'charge.zip'],
  checks: [
    { id: 'machine', label: 'State machine `payment` exists', hint: 'Run the create-state-machine step.' },
    { id: 'retry', label: 'The Charge state retries Transient at least twice', hint: 'Edit workflow.asl.json to add the Retry block, then run update-state-machine.' },
    { id: 'recovered', label: 'An execution failed, retried and then SUCCEEDED', hint: 'Start an execution with failFirst 2 after the update and wait about five seconds.' },
    { id: 'exhausted', label: 'An execution used up its retries (3 failed attempts) and FAILED', hint: 'Start an execution with failFirst 5 and wait about five seconds.' },
    { id: 'breakit', label: 'You saw create-state-machine reject a broken definition', hint: 'Run the break-it command.' },
  ],
}
