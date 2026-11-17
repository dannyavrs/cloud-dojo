import type { LessonContent } from '../types'

const ROLE = 'arn:aws:iam::000000000000:role/sfn-exec'
const SM = 'arn:aws:states:us-east-1:000000000000:stateMachine:fulfil'
const EXEC = (n: string) => `arn:aws:states:us-east-1:000000000000:execution:fulfil:${n}`
const UPDATE = `aws stepfunctions update-state-machine --state-machine-arn ${SM} --definition file://workflow.asl.json`
const SMALL = `{"orderId":"o-1","items":[{"sku":"pen","qty":2},{"sku":"book","qty":1}]}`
const BULK = `{"orderId":"o-2","items":[{"sku":"pen","qty":2},{"sku":"lamp","qty":1},{"sku":"desk","qty":1}]}`
const START = (n: string, input: string) => `aws stepfunctions start-execution --state-machine-arn ${SM} --name ${n} --input '${input}'`
const DESCRIBE = (n: string) => `aws stepfunctions describe-execution --execution-arn ${EXEC(n)} --query '[status,error,cause]'`

export const PRICE_SOURCE = `const PRICES = { pen: 3, book: 12, lamp: 40, desk: 150 };

export const handler = async ({ sku, qty }) => {
  if (!(sku in PRICES)) {
    throw Object.assign(new Error("unknown sku " + sku), { name: "UnknownSku" });
  }
  return { sku, total: PRICES[sku] * qty };
};
`

const record = (tier: string) => `    "Record${tier[0].toUpperCase()}${tier.slice(1)}": {
      "Type": "Task",
      "Resource": "arn:aws:states:::dynamodb:putItem",
      "Parameters": {
        "TableName": "Fulfilment",
        "Item": {
          "orderId": { "S.$": "$.orderId" },
          "tier": { "S": "${tier}" },
          "lines": { "N.$": "States.Format('{}', $.lineCount)" },
          "execution": { "S.$": "$$.Execution.Name" }
        }
      },
      "ResultPath": null,
      "Next": "Cooldown"
    },`

export const FULFIL_ASL = `{
  "Comment": "Price every line in parallel, route by order size, record it, wait",
  "StartAt": "PriceLines",
  "States": {
    "PriceLines": {
      "Type": "Map",
      "ItemsPath": "$.items",
      "MaxConcurrency": 2,
      "ItemSelector": {
        "sku.$": "$$.Map.Item.Value.sku",
        "qty.$": "$$.Map.Item.Value.qty"
      },
      "ItemProcessor": {
        "ProcessorConfig": { "Mode": "INLINE" },
        "StartAt": "Price",
        "States": {
          "Price": {
            "Type": "Task",
            "Resource": "arn:aws:states:::lambda:invoke",
            "Parameters": { "FunctionName": "price", "Payload.$": "$" },
            "OutputPath": "$.Payload",
            "End": true
          }
        }
      },
      "ResultPath": "$.lines",
      "Next": "Count"
    },
    "Count": {
      "Type": "Pass",
      "Parameters": {
        "orderId.$": "$.orderId",
        "lines.$": "$.lines",
        "lineCount.$": "States.ArrayLength($.lines)"
      },
      "Next": "Size"
    },
    "Size": {
      "Type": "Choice",
      "Choices": [
        { "Variable": "$.lineCount", "NumericGreaterThanEquals": 3, "Next": "RecordBulk" }
      ],
      "Default": "RecordSmall"
    },
${record('bulk')}
${record('small')}
    "Cooldown": { "Type": "Wait", "Seconds": 1, "Next": "Done" },
    "Done": { "Type": "Succeed" }
  }
}
`

export const sfnMapChoiceDdb: LessonContent = {
  id: 'sfn-map-choice-ddb',
  n: '8.3',
  trackId: 'stepfunctions',
  level: 'advanced',
  prereqs: ['sfn-catch-fail'],
  estMinutes: 40,
  honesty: 'live',
  honestyNote: 'Inline Map, Choice, Wait and the DynamoDB service integration all execute in the emulator, including `$$.Map.Item.Value`, intrinsic functions and execution context. Distributed Map (S3 input, child executions) is described but not run here.',
  examTags: ['SAA:Performant', 'DVA:Dev', 'DVA:Troubleshoot'],
  breakItCheck: 'breakit',
  editable: ['workflow.asl.json'],
  title: 'Map, Choice, Wait and a direct DynamoDB integration',
  tagline: 'Fan out over the lines of an order, branch on its size and write the result with no Lambda in between.',
  predict: [
    { id: 'p1', prompt: 'A Map state runs an inline iterator over 3 items with `MaxConcurrency: 2`. How are the iterations run?', options: ['All 3 at once, MaxConcurrency is only advice', 'At most 2 at the same time; the third starts when one finishes', 'One after another, always', '2 iterations only; the third item is dropped'], answer: 1, explain: 'MaxConcurrency caps parallel iterations (0 means "as many as the service allows", up to 40 for Inline Map). Every item is still processed, and the Map output is an array in the same order as the input regardless of which iteration finishes first.' },
    { id: 'p2', prompt: 'A Choice state has no `Default` and none of its rules match the input. What happens?', options: ['The workflow continues with the next state in the file', 'The execution fails with States.NoChoiceMatched', 'The first rule is used', 'The execution succeeds with the input as output'], answer: 1, explain: 'With no matching rule and no Default, the execution fails with `States.NoChoiceMatched`. Always add a Default, even if it points at a Fail state with a clear message.' },
    { id: 'p3', prompt: 'Which Task Resource writes an item to DynamoDB without any Lambda function?', options: ['`arn:aws:states:::lambda:invoke`', '`arn:aws:states:::dynamodb:putItem`', '`arn:aws:lambda:...:function:putItem`', 'Not possible; Step Functions only calls Lambda'], answer: 1, explain: 'Step Functions has optimized integrations (`arn:aws:states:::dynamodb:putItem`, `sqs:sendMessage`, `sns:publish`, `ecs:runTask`, ...) and an AWS SDK integration (`arn:aws:states:::aws-sdk:dynamodb:putItem`) that reaches most service APIs. The state machine role needs the matching IAM permission.' },
  ],
  concept: [
    "**Map** runs the same sub-workflow for every element of an array. In **Inline** mode (what you write with `ProcessorConfig.Mode: INLINE`) the iterations are part of the parent execution: they share its 25,000-event history, run up to 40 at a time, and their events appear in the parent's history as `MapIterationStarted` and `MapIterationSucceeded`. `ItemsPath` chooses the array, `ItemSelector` (the successor of the older `Parameters`) shapes each iteration's input from the context object `$$.Map.Item.Value` and `$$.Map.Item.Index`, and `ResultPath` decides where the array of iteration results goes, in input order. **Distributed Map** (`Mode: DISTRIBUTED`) is for large jobs: it reads items from S3 (a JSON array, CSV or an inventory manifest) and starts up to 10,000 parallel **child executions**, each with its own history, with tolerated-failure thresholds, batching and a result writer to S3. Distributed Map is not run in this module.",
    "**Choice** adds branching with no Lambda: each rule compares a `Variable` (a JSONPath) with a comparator such as `StringEquals`, `NumericGreaterThanEquals`, `BooleanEquals`, `IsPresent` or `TimestampLessThan`, combinable with `And`, `Or` and `Not`, and names a `Next`. The rules are tried in order, the first match wins, and `Default` catches the rest, because without it the execution fails with `States.NoChoiceMatched`. A `Variable` that points at a field that does not exist is a **runtime error** (`States.Runtime`, `Invalid path`), not a non-match, unless you guard it with `IsPresent`. **Wait** pauses for `Seconds`, until a `Timestamp`, or for values read from the input (`SecondsPath`, `TimestampPath`); waiting is free and a Standard execution can wait up to a year, which is how you build reminders and delayed retries without a scheduler. **Intrinsic functions** such as `States.ArrayLength`, `States.Format`, `States.JsonToString`, `States.MathAdd` and `States.UUID` let a Pass or Task `Parameters` block compute small things without code.",
    "**Direct service integrations** are the cost and reliability argument for Step Functions. The `arn:aws:states:::dynamodb:putItem` resource calls DynamoDB itself, with the state machine's role, and DynamoDB's typed attribute JSON (`{ \"S.$\": \"$.orderId\" }`, `{ \"N.$\": \"States.Format('{}', $.lineCount)\" }`; numbers are strings inside the `N` key). That removes a function you would otherwise write, version, secure, pay for and cold-start. There are three integration patterns, selected by a suffix on the resource: **Request Response** (the default, returns when the call returns), **Run a Job** (`.sync`, waits until the job finishes, used for ECS tasks, Glue, Batch and nested state machines) and **Wait for a Callback** (`.waitForTaskToken`, next module). Beyond the optimized integrations there is the **AWS SDK integration** (`arn:aws:states:::aws-sdk:<service>:<apiAction>`) that reaches over 200 services; it is request-response only and uses the SDK's lower-camel action name. The IAM permissions are the part the exam asks about: the **state machine role** must allow the underlying action (`dynamodb:PutItem`), and `.sync` patterns additionally need EventBridge rule permissions because the service polls through managed rules.",
    "Here the fixture gives you the role, a `price` function that returns a line total, and a `Fulfilment` table. The machine maps over the order lines, counts them with `States.ArrayLength`, routes orders of three or more lines to a bulk record and others to a small record, writes the record with the execution name, waits one second and succeeds. You run a 2-line and a 3-line order, read the Map iterations out of the history and the two tiers out of the table. The break-it points the Choice at a field that does not exist and you read the runtime error. A short wait is built into the fixture because the emulator's Step Functions integration needs a few seconds before it sees a brand-new table.",
  ],
  goal: 'A `fulfil` machine that prices order lines in a Map, routes them with a Choice, records both a small and a bulk order in DynamoDB with the execution name, and fails loudly when the Choice looks at a missing field.',
  steps: [
    { id: 'create', title: 'Create the machine', body: "Open `workflow.asl.json` and read it top to bottom: Map -> Pass (computes `lineCount`) -> Choice -> one of two DynamoDB `putItem` tasks -> Wait 1 s -> Succeed. Note there is no Lambda between the machine and DynamoDB. Only `price`, which runs once per line, is a function.", commands: [`aws stepfunctions create-state-machine --name fulfil --definition file://workflow.asl.json --role-arn ${ROLE}`] },
    { id: 'small', title: 'A 2-line order', body: "Start it, wait about four seconds (Map, a Lambda per line, one second of Wait) and describe it. `lineCount` is 2, below the Choice threshold of 3, so the small branch runs.", commands: [START('small1', SMALL), DESCRIBE('small1')] },
    { id: 'bulk', title: 'A 3-line order', body: "Same machine, three lines. Different branch. Then read the execution output to see the priced lines the Map collected at `$.lines`, in input order.", commands: [START('bulk1', BULK), `aws stepfunctions describe-execution --execution-arn ${EXEC('bulk1')} --query '[status,output]'`] },
    { id: 'history', title: 'Read the Map and Wait out of the history', body: "Count the Map iterations, then list the event types of the bulk run: you will see `MapIterationStarted` for each line, `ChoiceStateEntered` and `WaitStateEntered`.", commands: [`aws stepfunctions get-execution-history --execution-arn ${EXEC('bulk1')} --query "length(events[?type=='MapIterationSucceeded'])"`, `aws stepfunctions get-execution-history --execution-arn ${EXEC('bulk1')} --query "events[].type"`] },
    { id: 'table', title: 'Check what was written', body: "Two rows, one per tier. The `execution` attribute holds the execution name from `$$.Execution.Name`, which is how you trace a row back to the run that wrote it.", commands: ['aws dynamodb scan --table-name Fulfilment --query Items'] },
    { id: 'break', title: 'Break it: a Choice on a missing field', body: "In the editor change the Choice's `\"Variable\": \"$.lineCount\"` to `\"Variable\": \"$.total\"` (no state has produced a `total`) and Save. Update the machine, run the small order and describe it: the execution does not take the Default branch, it fails with `States.Runtime` and `Invalid path '$.total'`.", commands: [UPDATE, START('missing1', SMALL), DESCRIBE('missing1')], breakIt: true },
    { id: 'fix', title: 'Restore the Choice', body: "Change the Variable back to `$.lineCount` (or paste the full definition again), update the machine and run once more to confirm the small branch works again.", code: { file: 'workflow.asl.json', text: FULFIL_ASL }, commands: [UPDATE, START('small2', SMALL), DESCRIBE('small2')] },
  ],
  breakIt: {
    title: 'Choice on a path that does not exist',
    command: DESCRIBE('missing1'),
    explain: [
      "`States.Runtime: An error occurred while executing the state 'Size' ... Invalid path '$.total': The choice state's condition path references an invalid value.` A missing field is not a rule that does not match, it is an error, and `States.Runtime` cannot be retried or caught, so the whole execution fails even though a Default branch exists.",
      "Defend against optional fields with `IsPresent: true` as a first rule (or `IsNull`), and read the failing state's name and the input shown in the message before touching the definition. The same error shape appears when an `OutputPath` or `ResultPath` earlier in the workflow dropped the field you are testing.",
    ],
  },
  realAws: {
    cost: [
      "Standard workflows bill per state transition ($0.025 per 1,000 after 4,000 free per month, us-east-1, check the pricing page). Inline Map iterations count: each line adds the transitions of its sub-workflow, so 3 lines here cost 3 Price transitions plus the parent's. A Wait does not cost anything while it waits.",
      "A direct DynamoDB integration saves the Lambda invocation per write (about $0.20 per million requests plus duration). For very large fan-outs Distributed Map runs child executions that are billed as their own executions; Express child workflows are billed per request and duration instead of per transition.",
    ],
    differences: [
      "Distributed Map (S3 sources, up to 10,000 concurrent child executions, tolerated failure thresholds, result writer) is not exercised here; the Inline Map in this module matches the real syntax and history events.",
      "On AWS the history of one Standard execution is capped at 25,000 events, so a big inline Map can exhaust it; that is the exam signal for Distributed Map. The emulator does not reproduce the cap here.",
      "The emulator needed a few seconds after `create-table` before the integration could see the table. Real DynamoDB tables are CREATING for a short time too.",
    ],
    asOf: '2026-11-15',
    sources: [
      { label: 'Map state', url: 'https://docs.aws.amazon.com/step-functions/latest/dg/state-map.html' },
      { label: 'Choice state', url: 'https://docs.aws.amazon.com/step-functions/latest/dg/state-choice.html' },
      { label: 'Integrating services with Step Functions', url: 'https://docs.aws.amazon.com/step-functions/latest/dg/integrate-services.html' },
    ],
  },
  fidelity: [],
  files: ['workflow.asl.json', 'price.mjs', 'price.zip'],
  checks: [
    { id: 'machine', label: 'State machine `fulfil` exists', hint: 'Run the create-state-machine step.' },
    { id: 'small', label: 'A 2-line order SUCCEEDED and was recorded as `small` with its execution name', hint: 'Run the small order and wait about four seconds.' },
    { id: 'bulk', label: 'A 3-line order SUCCEEDED through the Map, was recorded as `bulk` with its execution name', hint: 'Run the 3-line order and wait about four seconds.' },
    { id: 'wait', label: 'The history shows the Wait state ran', hint: 'A successful run goes through the Cooldown Wait.' },
    { id: 'breakit', label: 'You saw the runtime error from a Choice on a missing field', hint: 'Point the Choice at $.total, update, run and describe the execution.' },
    { id: 'fixed', label: 'The Choice reads $.lineCount again and a later order SUCCEEDED', hint: 'Restore the Variable, update the machine and run a new order.' },
  ],
}
