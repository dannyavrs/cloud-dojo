import type { LessonContent } from '../types'

const ROLE = 'arn:aws:iam::000000000000:role/sfn-exec'
const SM = 'arn:aws:states:us-east-1:000000000000:stateMachine:approval'
const EXEC = (n: string) => `arn:aws:states:us-east-1:000000000000:execution:approval:${n}`
const QUEUE = 'https://sqs.us-east-1.amazonaws.com/000000000000/approvals'
const START = (n: string, order: string) => `aws stepfunctions start-execution --state-machine-arn ${SM} --name ${n} --input '{"order":"${order}"}'`
const RECEIVE = `aws sqs receive-message --queue-url ${QUEUE} --visibility-timeout 600 --query 'Messages[0].Body' --output text`

export const APPROVAL_ASL = `{
  "Comment": "Pause until a human approves or rejects the order",
  "StartAt": "AskManager",
  "States": {
    "AskManager": {
      "Type": "Task",
      "Resource": "arn:aws:states:::sqs:sendMessage.waitForTaskToken",
      "Parameters": {
        "QueueUrl": "${QUEUE}",
        "MessageBody": {
          "order.$": "$.order",
          "taskToken.$": "$$.Task.Token"
        }
      },
      "TimeoutSeconds": 900,
      "ResultPath": "$.decision",
      "Catch": [
        {
          "ErrorEquals": ["Rejected"],
          "ResultPath": "$.error",
          "Next": "OrderRejected"
        }
      ],
      "Next": "OrderApproved"
    },
    "OrderApproved": { "Type": "Succeed" },
    "OrderRejected": {
      "Type": "Fail",
      "Error": "Rejected",
      "Cause": "A manager rejected the order"
    }
  }
}
`

export const sfnWaitForToken: LessonContent = {
  id: 'sfn-wait-for-token',
  n: '8.4',
  trackId: 'stepfunctions',
  level: 'advanced',
  prereqs: ['sfn-retry', 'sqs-visibility'],
  estMinutes: 35,
  honesty: 'live',
  honestyNote: 'The callback pattern runs for real: the execution parks at RUNNING, the task token arrives in SQS, and send-task-success or send-task-failure resumes it. Only the sender (you at the CLI, standing in for a person or a worker) is simulated. A made-up token is refused with InvalidToken; the TaskDoesNotExist error AWS documents for a task that is not waiting could not be produced from the CLI.',
  examTags: ['SAA:Resilient', 'DVA:Dev', 'DVA:Troubleshoot'],
  breakItCheck: 'breakit',
  editable: ['workflow.asl.json'],
  title: 'Human approval with waitForTaskToken',
  tagline: 'Park a workflow until somebody sends the task token back, then resume it with their answer.',
  predict: [
    { id: 'p1', prompt: 'A Task uses `sqs:sendMessage.waitForTaskToken`. The message is delivered to SQS. What is the execution status a minute later if nobody has called SendTaskSuccess?', options: ['SUCCEEDED, the message was sent', 'RUNNING, parked at the Task until a callback, a timeout or a failure', 'FAILED, because the Task did not return', 'PAUSED'], answer: 1, explain: 'With `.waitForTaskToken` the Task does not complete when the SQS call returns. Step Functions generates a token, puts it into the message through `$$.Task.Token`, and waits. The execution stays RUNNING (and a Standard execution may wait up to a year) until SendTaskSuccess, SendTaskFailure, a timeout or a heartbeat failure.' },
    { id: 'p2', prompt: 'You omit `TimeoutSeconds` on a waitForTaskToken Task and the approver never answers. What happens?', options: ['It fails after 60 seconds by default', 'It waits, and Standard bills per hour while it is parked', 'It waits up to the one-year execution limit; nothing is billed while parked, but nothing ends it sooner either', 'The message is returned to the queue and retried'], answer: 2, explain: 'There is no default task timeout. A parked Standard execution costs nothing while it waits, but it keeps running for up to a year unless you set `TimeoutSeconds` (and `HeartbeatSeconds` if the worker should report in). Setting both is the standard defensive pattern.' },
    { id: 'p3', prompt: 'Who must be given the task token for the workflow to resume?', options: ['Nobody, the execution ARN is enough', 'Whatever component performs the work: it receives the token in the message and returns it with SendTaskSuccess or SendTaskFailure', 'Only the person who started the execution', 'The state machine role'], answer: 1, explain: 'The token is a bearer secret tied to one Task in one execution. The worker that got the message calls `SendTaskSuccess` (with output) or `SendTaskFailure` (with an error name and cause) using that token, and needs `states:SendTaskSuccess` permission in its own role.' },
  ],
  concept: [
    "**Callback pattern.** Some steps are not a function call: a person approves a payment, a partner system processes a batch, a legacy job runs for an hour. With the **Wait for a Callback** integration pattern you add `.waitForTaskToken` to the resource ARN (`arn:aws:states:::sqs:sendMessage.waitForTaskToken`, also available for SNS, Lambda, ECS, EventBridge `putEvents`, Step Functions and others). Step Functions generates a **task token**, makes it available as `$$.Task.Token` in the context object, performs the call and then **stops advancing**: the execution is `RUNNING`, parked at that Task. You are responsible for carrying the token to whoever will answer, usually inside the message body. The worker later calls `SendTaskSuccess` with the token and a JSON output (which becomes the Task's result and respects `ResultPath`), or `SendTaskFailure` with an `error` name and a `cause`, which Retry and Catch handle like any other task error. `SendTaskHeartbeat` keeps a long task alive when `HeartbeatSeconds` is set.",
    "**Timeouts and failure modes** are the exam material. `TimeoutSeconds` on the Task ends the wait with `States.Timeout`; `HeartbeatSeconds` ends it with `States.Timeout` if the worker stops sending heartbeats. With neither, a Standard execution waits up to the one-year limit (free while parked, but the execution never finishes). Express workflows do not support callbacks at all. A token works **once**: after the Task has completed, timed out or failed, another call is refused (the emulator answers `TaskTimedOut`), and a token that is malformed or simply wrong returns `InvalidToken`. AWS documents three errors for the callback calls: `InvalidToken`, `TaskDoesNotExist` (no such task is waiting) and `TaskTimedOut`; which of the last two a finished task gets is worth checking in the docs rather than assuming. Tokens are secrets: anyone who holds one can complete that step, so do not log them, keep the queue and the callback API private, and in production prefer a worker role with `states:SendTaskSuccess` over handing tokens to browsers.",
    "**Design choices.** Why not poll? A Lambda looping on a status check bills for every second and has to survive 15 minutes; a callback bills nothing while it waits. Why not just chain Lambdas through SQS? Because then you rebuild the timeout, error routing and audit trail yourself. Typical shapes: a human approval over email or Slack (SNS or SQS carries the token, an API Gateway endpoint receives the answer and calls SendTaskSuccess), a job on ECS or a SageMaker batch that reports back, and a legacy system that only speaks queues. The pattern pairs with SQS well because the queue gives you durability and a DLQ for the request. Pitfalls: the message must carry the token (forget it and the execution sits there until it times out), the SQS message size limit is 256 KiB, and a redelivered SQS message does not create a second Step Functions task: the token is the same.",
    "In this module the fixture gives you the role and an `approvals` queue. You start the approval machine, read the token message from SQS (the same thing a worker would do), approve it with `send-task-success` and see the execution finish with your output merged in at `$.decision`. Then you start a second one and reject it with `send-task-failure`, which the Catch routes to a Fail state. The break-it sends a made-up token. You will copy the token out of the message body into the command yourself, because on a real system that handoff is the part that goes wrong.",
  ],
  goal: 'An `approval` machine that parks at a waitForTaskToken task, one execution resumed with send-task-success, one rejected with send-task-failure, and a refused made-up token.',
  steps: [
    { id: 'create', title: 'Create the approval machine', body: "Read `workflow.asl.json`. The Task sends a message to the `approvals` queue with the order and the task token (`$$.Task.Token`), has a 15-minute timeout, stores the approver's answer at `$.decision` and routes a `Rejected` error to a Fail state.", commands: [`aws stepfunctions create-state-machine --name approval --definition file://workflow.asl.json --role-arn ${ROLE}`] },
    { id: 'start', title: 'Start an approval and watch it park', body: "The SQS call succeeds immediately, but the execution stays `RUNNING`: it is waiting for a callback.", commands: [START('req1', 'o-1'), `aws stepfunctions describe-execution --execution-arn ${EXEC('req1')} --query status`] },
    { id: 'inbox', title: 'Read the message as the approver', body: "Receive the message. The body holds the order and a long `taskToken`. `--visibility-timeout 600` keeps the message hidden so the next execution gets its own. Select the whole token value (no quotes) and copy it.", commands: [RECEIVE] },
    { id: 'approve', title: 'Approve: resume with send-task-success', body: "Replace `<TASK_TOKEN>` with the token you copied and send the answer. The output must be valid JSON. Describe the execution afterwards: `SUCCEEDED`, and the output holds your answer at `decision`.", commands: [`aws stepfunctions send-task-success --task-token <TASK_TOKEN> --task-output '{"approved":true}'`, `aws stepfunctions describe-execution --execution-arn ${EXEC('req1')} --query '[status,output]'`] },
    { id: 'reject', title: 'Reject: resume with send-task-failure', body: "Start a second approval, receive its message (a different token) and fail the task with the error name the Catch is waiting for. The execution ends `FAILED` with `Rejected`.", commands: [START('req2', 'o-2'), RECEIVE, `aws stepfunctions send-task-failure --task-token <TASK_TOKEN> --error Rejected --cause 'manager said no'`, `aws stepfunctions describe-execution --execution-arn ${EXEC('req2')} --query '[status,error]'`] },
    { id: 'break', title: 'Break it: a token that is not real', body: "Send a callback with a made-up token. Step Functions refuses it with `InvalidToken` and nothing changes. Also try sending the first (already used) token again with `send-task-success`: that one is answered with `TaskTimedOut`, because its task is finished.", commands: [`aws stepfunctions send-task-success --task-token not-a-real-token --task-output '{"approved":true}'`], breakIt: true },
  ],
  breakIt: {
    title: 'A callback with a wrong token',
    command: `aws stepfunctions send-task-success --task-token not-a-real-token --task-output '{"approved":true}'`,
    explain: [
      "`InvalidToken: Invalid token`. The emulator rejects a token it cannot decode. A malformed token gives `InvalidToken` on AWS too. A token whose task already finished gave `TaskTimedOut` on the emulator (tested here), and AWS documents `TaskDoesNotExist` for a task that is not waiting. In every case the parked execution is untouched, so a typo cannot corrupt a workflow, but it also means the workflow will sit there until its timeout if the real token never arrives.",
      "Copy errors are the classic callback bug in production: the token is truncated by a log line, URL-encoded twice in a link, or the message never carried it. Set `TimeoutSeconds` so a lost token becomes a visible `States.Timeout` and a Catch can escalate, instead of a silent execution that waits for a year.",
    ],
  },
  realAws: {
    cost: [
      "A parked Standard execution costs nothing while it waits: you pay for the state transitions ($0.025 per 1,000 after 4,000 free per month, us-east-1, check the pricing page), the SQS requests (first 1 million per month free) and nothing for the waiting hours.",
      "Compare a polling Lambda: a function that checks status every 10 seconds for an hour is 360 invocations plus the duration, and has to be written and kept alive. The callback pattern replaces all of it.",
    ],
    differences: [
      "On AWS the approver would usually reach SendTaskSuccess through an API Gateway endpoint, an email link or a Lambda, with its own IAM permission `states:SendTaskSuccess`. Here the CLI plays that role with the same emulator credentials.",
      "The emulator answers a made-up token with `InvalidToken` and a used token with `TaskTimedOut`. AWS documents `TaskDoesNotExist` for a task that is not waiting, which could not be produced with the CLI here, so which error a finished task gets on AWS is documented rather than demonstrated.",
      "Express workflows do not support `.waitForTaskToken` on AWS. Use Standard for any callback.",
    ],
    asOf: '2026-11-15',
    sources: [
      { label: 'Wait for a callback with the task token', url: 'https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html#connect-wait-token' },
      { label: 'SendTaskSuccess API', url: 'https://docs.aws.amazon.com/step-functions/latest/apireference/API_SendTaskSuccess.html' },
      { label: 'Task state: timeouts and heartbeats', url: 'https://docs.aws.amazon.com/step-functions/latest/dg/state-task.html' },
    ],
  },
  fidelity: [],
  files: ['workflow.asl.json'],
  checks: [
    { id: 'machine', label: 'State machine `approval` exists', hint: 'Run the create-state-machine step.' },
    { id: 'inbox', label: 'You read a task token message from the approvals queue', hint: 'Start an execution, then run the receive-message command.' },
    { id: 'approved', label: 'An execution resumed with send-task-success and SUCCEEDED with your answer', hint: 'Send the token you copied with send-task-success and the JSON output.' },
    { id: 'rejected', label: 'An execution was failed with send-task-failure and ended FAILED with `Rejected`', hint: 'Start a second approval and send-task-failure with --error Rejected.' },
    { id: 'breakit', label: 'You saw Step Functions refuse a made-up token', hint: 'Run the break-it command.' },
  ],
}
