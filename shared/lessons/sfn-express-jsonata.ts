import type { LessonContent } from '../types'

const ROLE = 'arn:aws:iam::000000000000:role/sfn-exec'
const SM = (n: string) => `arn:aws:states:us-east-1:000000000000:stateMachine:${n}`
const SYNC = (n: string, input: string) => `aws stepfunctions start-sync-execution --state-machine-arn ${SM(n)} --input '${input}' --query '[status,output]'`
const SMALL_IN = '{"a":1,"b":2,"tags":["x","y"]}'

const asl = (limit: number) => `{
  "Comment": "JSONata: arithmetic, variables and conditions without JSONPath",
  "QueryLanguage": "JSONata",
  "StartAt": "Total",
  "States": {
    "Total": {
      "Type": "Pass",
      "Assign": { "limit": ${limit} },
      "Output": {
        "sum": "{% $states.input.a + $states.input.b %}",
        "tags": "{% $count($states.input.tags) %}"
      },
      "Next": "Size"
    },
    "Size": {
      "Type": "Choice",
      "Choices": [
        { "Condition": "{% $states.input.sum >= $limit %}", "Next": "Large" }
      ],
      "Default": "Small"
    },
    "Large": {
      "Type": "Pass",
      "Output": "{% $merge([$states.input, { 'size': 'large' }]) %}",
      "End": true
    },
    "Small": {
      "Type": "Pass",
      "Output": "{% $merge([$states.input, { 'size': 'small' }]) %}",
      "End": true
    }
  }
}
`
export const JSONATA_ASL = asl(10)
export const JSONATA_ASL_LIMIT3 = asl(3)

export const sfnExpressJsonata: LessonContent = {
  id: 'sfn-express-jsonata',
  n: '8.5',
  trackId: 'stepfunctions',
  level: 'advanced',
  prereqs: ['sfn-retry'],
  estMinutes: 35,
  honesty: 'live',
  honestyNote: 'Express machines, start-sync-execution, JSONata (Output, Assign, Condition) and test-state for non-Task states all work, and the Standard-only operations are refused the way AWS refuses them. test-state on a Task state is not supported without a mock, so this module tests Pass and Choice states only.',
  examTags: ['SAA:Cost', 'SAA:Performant', 'DVA:Dev', 'DVA:Deploy'],
  breakItCheck: 'breakit',
  editable: ['workflow.asl.json'],
  title: 'Express workflows, synchronous runs and JSONata',
  tagline: 'Run a workflow and get its answer back in one call, compute with JSONata, and test a single state.',
  predict: [
    { id: 'p1', prompt: 'A client calls StartSyncExecution on a Standard state machine. What happens?', options: ['It works, but only for executions under 5 minutes', 'It is refused with StateMachineTypeNotSupported: only Express workflows can run synchronously', 'It starts the execution and returns immediately like StartExecution', 'It works and bills as Express'], answer: 1, explain: 'StartSyncExecution is an Express-only API: it starts the execution, waits for it (up to 5 minutes) and returns the status and output in the same HTTP response. A Standard machine must be started with StartExecution and polled or called back.' },
    { id: 'p2', prompt: 'A mobile backend needs a workflow that runs for about 2 seconds, is called 20,000 times per second, and can tolerate at-least-once execution. Which workflow type fits and why?', options: ['Standard: it has exactly-once execution and a full history', 'Express: it is built for high-rate, short (up to 5 minutes), idempotent work and is billed per request and duration, not per transition', 'Standard with a Map state to absorb the load', 'Neither; Step Functions cannot exceed 100 executions per second'], answer: 1, explain: 'Express workflows start over 100,000 executions per second, run up to 5 minutes, are at-least-once (asynchronous) or at-most-once (synchronous) and cost per request plus duration. Standard bills per state transition, which is far more expensive at that rate, and caps the start rate much lower.' },
    { id: 'p3', prompt: 'In a state with `"QueryLanguage": "JSONata"`, which fields can you NOT use?', options: ['Output and Assign', 'Arguments and Condition', 'InputPath, Parameters, ResultSelector, ResultPath and OutputPath', 'Next and End'], answer: 2, explain: 'JSONata states replace the five JSONPath data-plumbing fields with `Arguments` (task input), `Output` (state output) and `Assign` (variables), plus `Condition` in Choice rules. Mixing the two families in one state is rejected. The reading variables are `$states.input`, `$states.result`, `$states.context` and `$states.errorOutput`.' },
  ],
  concept: [
    "**Standard versus Express.** A **Standard** workflow is the durable one: exactly-once state transitions, executions up to one year, a per-execution history you can read with `GetExecutionHistory` and in the console, `.sync` and callback patterns, and billing per **state transition**. An **Express** workflow is for volume: executions up to **5 minutes**, over 100,000 starts per second, **at-least-once** semantics when started asynchronously and **at-most-once** when started synchronously (so the work should be idempotent), billing per **request and duration/memory**, and no durable history in the API. Express history exists only if you configure logging to CloudWatch Logs, `ListExecutions` and `DescribeExecution` do not work on it (you will see this error here), and callbacks (`.waitForTaskToken`) and `.sync` integrations are Standard-only. Rule of thumb for the exam: long-running, human steps, audit trail, rare and valuable work means Standard; high-volume, short, event-processing, mobile or web back ends means Express.",
    "**Synchronous invocation.** `StartExecution` is asynchronous for both types: it returns an execution ARN immediately and you find the result later. `StartSyncExecution` exists only for Express. The call blocks until the workflow ends and returns `status`, `output`, `error`, `cause` and billing details in the response, so an API Gateway integration or a Lambda can use a state machine as a synchronous backend with no polling. API Gateway can call it directly as a service integration, which is a common exam answer for \"orchestrate several steps behind one REST call without a Lambda\". An Express execution that does not finish within 5 minutes fails, so a synchronous caller should also set its own client timeout.",
    "**JSONata** is the newer query and transformation language for Amazon States Language (since late 2024). You switch it on with `\"QueryLanguage\": \"JSONata\"` at the top of the definition or per state. The fields change: the state input is `$states.input`, a task's result is `$states.result`, the context object is `$states.context`, and every expression is a string wrapped in `{% ... %}`. `Arguments` replaces `Parameters`, `Output` replaces ResultSelector/ResultPath/OutputPath in one step, `Condition` replaces the typed comparators in Choice (so `{% $states.input.sum >= $limit %}` is a rule), and `Assign` stores **variables** that every later state can read as `$limit`, so you stop threading values through the input. JSONata has real arithmetic, string and array functions (`$count`, `$sum`, `$merge`, `$map`), where JSONPath relied on intrinsic functions like `States.MathAdd`. Two details: variables assigned in a state are not visible inside the **same** state's `Output` (they apply after it), and a JSONata expression that evaluates to nothing becomes an empty value, which later fails with a type error such as comparing \"\" with a number.",
    "**test-state** runs one state definition you pass in, with an input you pass in, and returns the output, the next state and the status, so you can debug a Choice or a transformation without creating a machine or running a whole execution. `--inspection-level DEBUG` also returns the data after each processing stage (`afterInputPath`, `afterParameters`, `afterResultPath`). On AWS you can also test a Task state against a mocked response or with a real call; the emulator only supports non-Task states. In this module you build an Express machine that totals two numbers and routes on a variable, run it synchronously, edit the limit to flip the branch, test a single state, see what Express cannot do, and finally try a synchronous run on a Standard copy of the same machine and read the refusal.",
  ],
  goal: 'An Express machine `quote` using JSONata, a synchronous run of it for each branch, a test-state result, and the refusal you get from a synchronous call on a Standard machine.',
  steps: [
    { id: 'create', title: 'Create an Express machine', body: "Read `workflow.asl.json`: `QueryLanguage: JSONata`, a Pass that adds `a` and `b` and counts `tags`, a Choice with a JSONata `Condition` against the variable `limit`, and two branches that merge a `size` field. `--type EXPRESS` makes it Express; the default is Standard.", commands: [`aws stepfunctions create-state-machine --name quote --type EXPRESS --definition file://workflow.asl.json --role-arn ${ROLE}`] },
    { id: 'sync', title: 'Run it synchronously', body: "`start-sync-execution` returns the result in the same call: no polling. `a + b` is 3, which is below the `limit` of 10, so you should get `\"size\":\"small\"`.", commands: [SYNC('quote', SMALL_IN)] },
    { id: 'edit', title: 'Change the limit to 3', body: "Edit `workflow.asl.json`, set `\"Assign\": { \"limit\": 3 }` (or paste this whole file) and Save. Update the machine and run the same input: the Choice now takes the other branch.", code: { file: 'workflow.asl.json', text: JSONATA_ASL_LIMIT3 }, commands: [`aws stepfunctions update-state-machine --state-machine-arn ${SM('quote')} --definition file://workflow.asl.json`, SYNC('quote', SMALL_IN)] },
    { id: 'test', title: 'Test one state without a machine', body: "`test-state` takes a single state definition and an input. First a JSONata Pass that adds 1 (expect output `2`), then the Choice from the file with `a` large enough to match, where `nextState` tells you the branch that would run.", commands: [`aws stepfunctions test-state --definition '{"Type":"Pass","QueryLanguage":"JSONata","Output":"{% $states.input.a + 1 %}","End":true}' --role-arn ${ROLE} --input '{"a":1}'`, `aws stepfunctions test-state --definition '{"Type":"Choice","QueryLanguage":"JSONata","Choices":[{"Condition":"{% $states.input.a >= 10 %}","Next":"Large"}],"Default":"Small"}' --role-arn ${ROLE} --input '{"a":12}'`] },
    { id: 'limits', title: 'What Express does not give you', body: "Express executions have no history in the API. Try to list the executions of `quote`: the call is refused (expected failure). On AWS you would read Express history from the CloudWatch Logs group configured in the machine's logging configuration.", commands: [`aws stepfunctions list-executions --state-machine-arn ${SM('quote')}`] },
    { id: 'break', title: 'Break it: a synchronous run on a Standard machine', body: "Create a Standard copy of the same definition, then call `start-sync-execution` on it. It is refused with `StateMachineTypeNotSupported`: only Express workflows can run synchronously. Use `start-execution` and poll for Standard.", commands: [`aws stepfunctions create-state-machine --name quote-std --definition file://workflow.asl.json --role-arn ${ROLE}`, SYNC('quote-std', SMALL_IN)], breakIt: true },
  ],
  breakIt: {
    title: 'start-sync-execution on a Standard machine',
    command: SYNC('quote-std', SMALL_IN),
    explain: [
      "`StateMachineTypeNotSupported: This operation is not supported by this type of state machine`. The type is fixed at creation: you cannot turn a Standard machine into an Express one, only create a new machine. The same error appears for `list-executions` and `describe-execution` on an Express machine, because those operations belong to Standard history.",
      "Decide the type from the workload, not from habit: callbacks, `.sync` jobs, durations over 5 minutes and per-execution audit trails need Standard. Synchronous request/response, very high rates and cheap short workflows need Express, and Express work must tolerate being run more than once.",
    ],
  },
  realAws: {
    cost: [
      "Standard: $0.025 per 1,000 state transitions (4,000 free per month). Express: about $1.00 per million requests plus a duration charge of roughly $0.06 per GB-hour of memory used, billed in 100 ms steps (us-east-1, check the pricing page). As a rough sum: a 2-second workflow with 5 transitions at 64 MB run 10 million times is about $1,250 on Standard and about $30 on Express.",
      "Express logging to CloudWatch Logs is billed as log ingestion and storage; at high volume use `ERROR` level only. The emulator's sync output shows `billedDurationInMilliseconds` and a 64 MB memory figure just like the real response.",
    ],
    differences: [
      "On AWS, Express history comes only from CloudWatch Logs (set `LoggingConfiguration`) and from X-Ray; the emulator does not produce either for this module.",
      "`test-state` on AWS can test Task states (with a real call or a mocked response, depending on the inspection level). The emulator refuses a Task state with a message that no mock was named, so this module only tests Pass and Choice states.",
      "JSONata key order in `$merge` output is not guaranteed, in either world; compare fields, not strings.",
    ],
    asOf: '2026-11-15',
    sources: [
      { label: 'Choosing workflow type: Standard vs Express', url: 'https://docs.aws.amazon.com/step-functions/latest/dg/choosing-workflow-type.html' },
      { label: 'Transforming data with JSONata in Step Functions', url: 'https://docs.aws.amazon.com/step-functions/latest/dg/transforming-data.html' },
      { label: 'TestState API', url: 'https://docs.aws.amazon.com/step-functions/latest/apireference/API_TestState.html' },
    ],
  },
  fidelity: [],
  files: ['workflow.asl.json'],
  checks: [
    { id: 'express', label: 'An Express state machine `quote` exists and uses JSONata', hint: 'Run the create-state-machine step with --type EXPRESS.' },
    { id: 'sync', label: 'A synchronous run returned SUCCEEDED with the `small` branch', hint: 'Run start-sync-execution with the first input before changing the limit.' },
    { id: 'large', label: 'After lowering the limit, a synchronous run took the `large` branch', hint: 'Edit the limit to 3, update the machine and run the sync call again.' },
    { id: 'teststate', label: 'test-state returned SUCCEEDED for a JSONata state', hint: 'Run the two test-state commands.' },
    { id: 'breakit', label: 'You saw start-sync-execution refused on a Standard machine', hint: 'Create quote-std and run the synchronous call on it.' },
  ],
}
