import type { LessonContent } from '../types'

const ROLE = 'arn:aws:iam::000000000000:role/sfn-exec'
const SM = 'arn:aws:states:us-east-1:000000000000:stateMachine:checkout'
const EXEC = (n: string) => `arn:aws:states:us-east-1:000000000000:execution:checkout:${n}`
const START = (n: string, order: string, card: string) => `aws stepfunctions start-execution --state-machine-arn ${SM} --name ${n} --input '{"orderId":"${order}","card":"${card}"}'`
const DESCRIBE = (n: string) => `aws stepfunctions describe-execution --execution-arn ${EXEC(n)} --query '[status,error,cause]'`
const UPDATE = `aws stepfunctions update-state-machine --state-machine-arn ${SM} --definition file://workflow.asl.json`

export const PAYMENT_SOURCE = `// A business error, not an outage: retrying a declined card will not help.
export const handler = async (event) => {
  if (event.card === "declined") {
    throw Object.assign(new Error("card declined"), { name: "PaymentDeclined" });
  }
  return { charged: true };
};
`

const RECORD_PAID = `    "RecordPaid": {
      "Type": "Task",
      "Resource": "arn:aws:states:::dynamodb:putItem",
      "Parameters": {
        "TableName": "Orders",
        "Item": { "orderId": { "S.$": "$.orderId" }, "status": { "S": "paid" } }
      },
      "ResultPath": null,
      "Next": "Done"
    },`

export const PAID_ASL = `{
  "Comment": "Charge an order and record it",
  "StartAt": "Charge",
  "States": {
    "Charge": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": { "FunctionName": "payment", "Payload.$": "$" },
      "ResultSelector": { "charged.$": "$.Payload.charged" },
      "ResultPath": "$.payment",
      "Next": "RecordPaid"
    },
${RECORD_PAID}
    "Done": { "Type": "Succeed" }
  }
}
`

export const CATCH_ASL = `{
  "Comment": "Charge an order; a declined card is recorded and fails the workflow on purpose",
  "StartAt": "Charge",
  "States": {
    "Charge": {
      "Type": "Task",
      "Resource": "arn:aws:states:::lambda:invoke",
      "Parameters": { "FunctionName": "payment", "Payload.$": "$" },
      "ResultSelector": { "charged.$": "$.Payload.charged" },
      "ResultPath": "$.payment",
      "Catch": [
        {
          "ErrorEquals": ["PaymentDeclined"],
          "ResultPath": "$.error",
          "Next": "RecordDecline"
        }
      ],
      "Next": "RecordPaid"
    },
${RECORD_PAID}
    "RecordDecline": {
      "Type": "Task",
      "Resource": "arn:aws:states:::dynamodb:putItem",
      "Parameters": {
        "TableName": "Orders",
        "Item": {
          "orderId": { "S.$": "$.orderId" },
          "status": { "S": "declined" },
          "reason": { "S.$": "$.error.Error" }
        }
      },
      "ResultPath": null,
      "Next": "Declined"
    },
    "Declined": {
      "Type": "Fail",
      "Error": "OrderDeclined",
      "Cause": "The card was declined"
    },
    "Done": { "Type": "Succeed" }
  }
}
`

export const sfnCatchFail: LessonContent = {
  id: 'sfn-catch-fail',
  n: '8.2',
  trackId: 'stepfunctions',
  level: 'intermediate',
  prereqs: ['sfn-retry'],
  estMinutes: 35,
  honesty: 'live',
  honestyNote: 'Catch, ResultPath, DynamoDB service integration and the Fail state all run for real in the emulator, and the JSONPath errors you get from a bad ResultPath are the same States.Runtime errors AWS gives. Only the exact wording of messages may differ from AWS.',
  examTags: ['SAA:Resilient', 'DVA:Dev', 'DVA:Troubleshoot'],
  breakItCheck: 'breakit',
  editable: ['workflow.asl.json'],
  title: 'Catch, Fail and ResultPath: route errors without losing the input',
  tagline: 'Send a declined card down its own branch, record it, then fail on purpose with a business error name.',
  predict: [
    { id: 'p1', prompt: 'A Task has a `Catch` for `PaymentDeclined` with no `ResultPath`. When the error is caught, what does the next state receive as its input?', options: ['The original state input, unchanged', 'Only the error object: `{ "Error": ..., "Cause": ... }`', 'The original input with an `error` field added', 'Nothing: the next state starts with `{}`'], answer: 1, explain: 'In a Catch, the default `ResultPath` is `$`, which means the error output replaces the whole input. To keep the order id and add the error beside it you set `"ResultPath": "$.error"`. Forgetting it is one of the most common ASL bugs.' },
    { id: 'p2', prompt: 'A Fail state ends the execution. What status does that execution get?', options: ['SUCCEEDED, because the workflow handled the error', 'FAILED, with the Fail state\'s `Error` and `Cause`', 'ABORTED', 'TIMED_OUT'], answer: 1, explain: 'A Fail state is a deliberate failure: the execution is FAILED and carries the Error and Cause you put on the state, which is what a caller, an alarm or an EventBridge rule sees. Use Succeed with a status field instead when "declined" is a normal business outcome.' },
    { id: 'p3', prompt: 'A Task has both a Retry and a Catch for the same error name. In which order do they act?', options: ['Catch first, then Retry if the next state fails', 'Retry first; only after the retries are used up does Catch see the error', 'Whichever is listed first in the JSON', 'They run in parallel'], answer: 1, explain: 'Retry is evaluated before Catch. The error only leaves the state, and reaches Catch, once the matching Retry rule has exhausted its attempts (or if there is no matching rule). That is why a Catch on a retried error fires after the full backoff.' },
  ],
  concept: [
    "**Catch** turns an error into a transition instead of a failed execution. A Catch rule has `ErrorEquals`, a `Next` state and an optional `ResultPath`, and the error object it hands on has two fields: `Error` (the name, for a Lambda the `errorType` such as `PaymentDeclined`) and `Cause` (a string, for a Lambda the whole serialized error with message and stack trace). The reserved names are the same as for Retry: `States.ALL`, `States.TaskFailed`, `States.Timeout`, `States.Permissions`, `States.Runtime`. `States.ALL` matches every error name **except** `States.DataLimitExceeded` and `States.Runtime`: a runtime error such as a missing JSONPath is not retriable, not catchable and always fails the execution (you will trigger one in the break-it). The first matching rule wins, so list specific errors first and `States.ALL` last. Retry runs before Catch: the error reaches Catch only after the matching Retry rule gave up.",
    "**ResultPath, InputPath, OutputPath** are the data plumbing of the JSONPath query language, and the exam loves them. The order inside a state is `InputPath` (filter what the state sees), `Parameters` (build the task input), the work, `ResultSelector` (reshape the result), `ResultPath` (where to merge the result into the **original input**), then `OutputPath` (filter what leaves the state). `ResultPath: \"$.payment\"` keeps the input and adds the result beside it, the default `$` **replaces** the input with the result, and `null` **discards** the result and passes the input through untouched (what you want after a side-effect like `putItem`). The same rule applies to Catch, which is why `\"ResultPath\": \"$.error\"` keeps `orderId` available to the next state. `OutputPath` is the dangerous one: it throws data away for everything downstream.",
    "A **Fail** state terminates the execution with an `Error` and a `Cause` of your choosing, so a dashboard, an alarm or an EventBridge rule on `Execution Status Change` sees `OrderDeclined` instead of a Lambda stack trace. It has no `Next` and no `End`. Compare the three ways to end a branch: `Succeed` (SUCCEEDED, output is the input), `Fail` (FAILED) and a Task or Pass with `\"End\": true`. Another trap: a Catch that routes to a state which succeeds makes the **execution** SUCCEEDED even though a task failed, so decide on purpose whether a handled error should still be a failed execution. Here it should: the order is recorded as declined in DynamoDB first, then the workflow fails so callers know. Direct service integrations make that recording step free of any Lambda: `arn:aws:states:::dynamodb:putItem` takes the table name and DynamoDB-typed attributes (`{ \"S.$\": \"$.orderId\" }`) straight in `Parameters`.",
    "In this module you start from a machine with only the happy path. You run a declined card and see the raw Lambda error kill the execution. You then add a Catch with `ResultPath: \"$.error\"`, a `RecordDecline` task that writes the order and the reason to DynamoDB, and a Fail state. A declined run ends FAILED with `OrderDeclined` **and** leaves a row behind, and a good card ends SUCCEEDED with a `paid` row. The break-it removes the `ResultPath` from the Catch, and the recording step cannot find `$.orderId` any more. The fixture waits a few seconds after creating the `Orders` table because the emulator's Step Functions integration needs a moment before it sees a brand-new table.",
  ],
  goal: 'A `checkout` machine that records both outcomes in DynamoDB, ends FAILED with `OrderDeclined` for a declined card, and keeps the order id after a caught error.',
  steps: [
    { id: 'create', title: 'Create the happy-path machine', body: "`workflow.asl.json` charges the order through the `payment` Lambda, keeps the order beside the result with `ResultPath: \"$.payment\"`, writes a `paid` row to the `Orders` table with a direct DynamoDB integration and succeeds. There is no error handling yet.", commands: [`aws stepfunctions create-state-machine --name checkout --definition file://workflow.asl.json --role-arn ${ROLE}`] },
    { id: 'uncaught', title: 'Run a declined card with no Catch', body: "Wait two seconds, then describe. The Lambda's `PaymentDeclined` error propagates out of the Task and the execution fails with that raw name. Nothing was recorded: scan the table to see it is empty.", commands: [START('uncaught', 'o-1', 'declined'), DESCRIBE('uncaught'), 'aws dynamodb scan --table-name Orders --query Items'] },
    { id: 'edit', title: 'Add Catch, RecordDecline and Fail', body: "Replace `workflow.asl.json` with this version and Save. Read the Catch: it names the business error, stores the error object at `$.error` and moves on to `RecordDecline`, which writes the reason; then `Declined` fails the execution with a name callers can use.", code: { file: 'workflow.asl.json', text: CATCH_ASL } },
    { id: 'update', title: 'Update the machine', body: 'New executions use the new definition.', commands: [UPDATE] },
    { id: 'declined', title: 'Declined card: recorded, then failed on purpose', body: "Run the declined order again, with a new execution name and order id. The status is still FAILED, but now the error is `OrderDeclined` (from the Fail state) and `Orders` holds a row with the reason copied from `$.error`. Read the history too: you will see `TaskFailed`, then the DynamoDB task, then `FailStateEntered`.", commands: [START('declined', 'o-2', 'declined'), DESCRIBE('declined'), `aws stepfunctions get-execution-history --execution-arn ${EXEC('declined')} --query "events[].type"`, 'aws dynamodb scan --table-name Orders --query Items'] },
    { id: 'paid', title: 'A good card takes the other branch', body: "The same machine, a card that works. The execution SUCCEEDED, the output still contains the order id and the `payment` result, and the table has a `paid` row.", commands: [START('paid', 'o-3', 'ok'), `aws stepfunctions describe-execution --execution-arn ${EXEC('paid')} --query '[status,output]'`, 'aws dynamodb scan --table-name Orders --query Items'] },
    { id: 'break', title: 'Break it: a Catch that forgets ResultPath', body: "In the editor delete the line `\"ResultPath\": \"$.error\",` from the Catch block and Save. Update the machine, run a declined order and describe it. The error object has replaced the whole input, so `RecordDecline` cannot find `$.orderId`: the execution fails with `States.Runtime` and the message prints the input it actually received.", commands: [UPDATE, START('lost', 'o-4', 'declined'), DESCRIBE('lost')], breakIt: true },
    { id: 'fix', title: 'Restore the ResultPath', body: "Put the line back (or paste the full definition again), update the machine and confirm a declined order is recorded again.", code: { file: 'workflow.asl.json', text: CATCH_ASL }, commands: [UPDATE, START('fixed', 'o-5', 'declined'), DESCRIBE('fixed')] },
  ],
  breakIt: {
    title: 'A Catch without ResultPath replaces the input',
    command: DESCRIBE('lost'),
    explain: [
      "`States.Runtime: ... The JSONPath '$.orderId' specified for the field 'S.$' could not be found in the input '{\"Error\":\"PaymentDeclined\",\"Cause\":\"...\"}'`. With the default `ResultPath` of `$` the caught error object **is** the next state's input, so the order id is gone and the recording step crashes. The execution fails for a different reason than the one you were handling.",
      "The fix is `ResultPath: \"$.error\"`. The same family of mistakes happens on success paths: an `OutputPath` such as `$.Payload` throws away every field the next state needs, and a Choice on a field that was dropped fails with `Invalid path`. When you debug a `States.Runtime` error, read the input printed in the message first.",
    ],
  },
  realAws: {
    cost: [
      "The happy path here is about 3 to 4 state transitions (Charge, RecordPaid, Done, plus the start). Standard workflows cost $0.025 per 1,000 transitions after a free tier of 4,000 a month (us-east-1, check the pricing page).",
      "The DynamoDB integration replaces a Lambda: no function to write, deploy or pay for, and no cold start. You pay DynamoDB write units as usual. DynamoDB on-demand charges per request, so the lesson table costs next to nothing.",
    ],
    differences: [
      "The Lambda's `Cause` is the serialized error including a stack trace, in both worlds. Truncation and exact message wording of `States.Runtime` errors can differ on AWS.",
      "On AWS the state machine role needs `dynamodb:PutItem` on the table (and `lambda:InvokeFunction` on the function). The emulator enforces the role's identity policy, so a missing action fails the Task with an authorization error.",
      "The emulator needed a few seconds after `create-table` before the Step Functions DynamoDB integration could see the table. On AWS a newly created table is also CREATING for a short while, so production code waits for ACTIVE or relies on a Retry for `DynamoDB.ResourceNotFoundException`.",
    ],
    asOf: '2026-11-15',
    sources: [
      { label: 'Fallback states (Catch) in Step Functions', url: 'https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html#error-handling-fallback-states' },
      { label: 'Processing input and output with JSONPath (ResultPath)', url: 'https://docs.aws.amazon.com/step-functions/latest/dg/input-output-resultpath.html' },
      { label: 'Fail state', url: 'https://docs.aws.amazon.com/step-functions/latest/dg/state-fail.html' },
    ],
  },
  fidelity: [],
  files: ['workflow.asl.json', 'payment.mjs', 'payment.zip'],
  checks: [
    { id: 'machine', label: 'State machine `checkout` exists', hint: 'Run the create-state-machine step.' },
    { id: 'uncaught', label: 'You saw a declined card fail the execution with the raw PaymentDeclined error', hint: 'Run a declined order before adding the Catch.' },
    { id: 'catch', label: 'A declined order was caught: execution FAILED with OrderDeclined and a `declined` row exists', hint: 'Add the Catch, update the machine and run a declined order.' },
    { id: 'paid', label: 'A good card SUCCEEDED and left a `paid` row', hint: 'Run an order with card "ok".' },
    { id: 'breakit', label: 'You saw States.Runtime when the Catch lost the input', hint: 'Remove ResultPath from the Catch, update, run a declined order and describe it.' },
    { id: 'fixed', label: 'The Catch keeps the input again (ResultPath restored)', hint: 'Put `"ResultPath": "$.error"` back in the Catch and update the machine.' },
  ],
}
