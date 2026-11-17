import type { LessonContent } from '../types'

const Q = 'https://sqs.us-east-1.amazonaws.com/000000000000'

export const EIC_STARTER = `{
  "FunctionName": "orders-handler",
  "MaximumRetryAttempts": 5,
  "MaximumEventAgeInSeconds": 30,
  "DestinationConfig": {
    "OnSuccess": { "Destination": "arn:aws:s3:::orders-archive" },
    "OnFailure": { "Destination": "orders-failures" }
  }
}
`

export const EIC_SOLUTION = `{
  "FunctionName": "orders-handler",
  "MaximumRetryAttempts": 1,
  "MaximumEventAgeInSeconds": 3600,
  "DestinationConfig": {
    "OnSuccess": { "Destination": "arn:aws:sqs:us-east-1:000000000000:orders-success" },
    "OnFailure": { "Destination": "arn:aws:sqs:us-east-1:000000000000:orders-failures" }
  }
}`

export const ORDERS_HANDLER = `export const handler = async (event) => {
  if (event.fail) throw new Error("payment declined for order " + event.orderId);
  return { ok: true, orderId: event.orderId };
};`

export const lambdaAsyncDestinations: LessonContent = {
  id: 'lambda-async-destinations',
  n: '4.7',
  trackId: 'lambda',
  level: 'advanced',
  prereqs: ['lambda-config-errors', 'sqs-dlq-redrive'],
  estMinutes: 30,
  honesty: 'concept',
  requires: ['lambda-async-destination'],
  honestyNote: 'CONCEPT module: the emulator accepts the event invoke config, destinations and DLQ settings but delivers nothing to them. The check is a static review of your JSON plus the quiz. For hands-on failure handling use the SQS redrive module (5.3).',
  examTags: ['DVA:Dev', 'DVA:Troubleshoot', 'SAA:Resilient'],
  editable: ['event-invoke-config.json'],
  title: 'Async invocation, destinations and DLQs',
  tagline: 'What Lambda does with an event it cannot process, and where the failure ends up.',
  predict: [
    { id: 'p1', prompt: 'An asynchronous invoke of a function fails with an exception. With default settings, how many times does Lambda run it in total?', options: ['Once, async invokes are never retried', 'Three times: the first attempt plus two retries', 'Until it succeeds', 'Five times'], answer: 1, explain: 'Async invokes get the original attempt plus up to 2 retries (MaximumRetryAttempts 2 by default, configurable 0 to 2) with delays of about 1 and then 2 minutes. Events are kept for up to 6 hours (MaximumEventAgeInSeconds, 60 to 21,600) while Lambda retries throttles and system errors.' },
    { id: 'p2', prompt: 'You want failed async invocations delivered together with the error and the original request. DLQ or OnFailure destination?', options: ['DLQ: it carries the full response context', 'OnFailure destination: it delivers the original event, the error details and retry count as a JSON record', 'Both are identical', 'Neither, you must read CloudWatch Logs'], answer: 1, explain: 'A destination record includes requestContext (condition, approximateInvokeCount), requestPayload, responsePayload with the error and, for success, the response. A DLQ receives only the original event, with the error in message attributes. AWS recommends destinations for new work, and a destination also covers OnSuccess.' },
    { id: 'p3', prompt: 'A function is triggered by an SQS queue and keeps failing. Where do you configure the dead-letter queue?', options: ['On the function (DeadLetterConfig)', 'On the source queue as a redrive policy', 'On the event source mapping only', 'Lambda creates one automatically'], answer: 1, explain: 'SQS triggers are synchronous polling by an event source mapping, not an async invoke, so the function-level DLQ and destinations do not apply. Failed messages go back to the queue and eventually to the queue\'s own DLQ through its redrive policy (see module 5.3).' },
  ],
  concept: [
    "Lambda has three invocation models and the failure story differs for each. **Synchronous** (`RequestResponse`, API Gateway, ALB, Function URLs, SDK default): the caller waits, gets the result or error, and owns the retries. **Asynchronous** (`Event`; S3, SNS, EventBridge, CloudWatch Logs, CodeCommit and others): Lambda puts the event on an internal queue and returns 202 immediately, then invokes your function and **retries on failure up to 2 times** (about 1 minute and then 2 minutes later). Throttling and internal service errors are retried with backoff for up to `MaximumEventAgeInSeconds` (60 seconds to 6 hours, default 6 hours). **Polling** (event source mappings: SQS, Kinesis, DynamoDB Streams, MSK, MQ): Lambda reads a batch and invokes your function synchronously, so retry behaviour belongs to the source (the message returns to the queue, a shard is blocked until the record succeeds or expires).",
    "For async events you choose where discarded ones go. A **dead-letter queue** (an SQS standard queue or SNS standard topic on `DeadLetterConfig`) receives only failed events: the original payload, with `ErrorCode`, `ErrorMessage` and `RequestID` as message attributes. **Destinations** (SQS, SNS, another Lambda function or an EventBridge bus) are the newer, preferred mechanism: they can fire on **success and on failure**, and the record carries more context: `requestContext` (condition such as `RetriesExhausted`, `approximateInvokeCount`), the `requestPayload`, and the `responsePayload` or the error. You configure them with `put-function-event-invoke-config` (together with `MaximumRetryAttempts` and `MaximumEventAgeInSeconds`) per function, version or alias. The execution role needs the matching send permission (`sqs:SendMessage`, `sns:Publish`, `lambda:InvokeFunction`, `events:PutEvents`), and S3 is **not** a valid destination for async invocation (it is a failure destination only for stream event source mappings). If both a DLQ and an OnFailure destination exist, both receive the event.",
    "Idempotency is the part exams like to hide. Async delivery is **at least once**: after a timeout or a partial failure the same event can run twice, and a retry re-runs everything your handler did before it failed. Make handlers idempotent with a key from the event (the order id, not the request id), a conditional write in DynamoDB (`attribute_not_exists`) or the Powertools idempotency utility, and treat a destination or DLQ message as 'investigate and replay', not 'processed'. Two more traps: setting `MaximumRetryAttempts` to 0 is correct for non-idempotent side effects but turns every blip into a dropped event unless a destination catches it; and the **async payload limit** is much smaller than the synchronous 6 MB (historically 256 KB), so large events travel as references (an S3 key).",
    "Why this module is a concept module: the emulator accepts the configuration, even checks that the execution role may send to the destination, and then **never delivers** a success or failure record to the queue or the DLQ, so you cannot watch the mechanism work. You will edit a realistic config file, have it statically reviewed (ARN form, allowed destination types, retry and age ranges), apply it to see it accepted, and read the empty queue as 'accepted, not delivered'. For a failure path that really runs, build it with an SQS redrive policy in module 5.3 (`sqs-dlq-redrive`) or a Step Functions `Catch` in the orchestration track.",
  ],
  goal: 'Fix `event-invoke-config.json` so both destinations are valid ARNs of an allowed type with legal retry and age settings, apply it, and understand what the emulator does not deliver.',
  steps: [
    { id: 'look', title: 'Review the broken config', body: "The fixture created the role, a function `orders-handler` that throws when `fail` is set, and queues `orders-failures`, `orders-success` and `orders-dlq`. Open `event-invoke-config.json`. Find four problems: the retry count, the event age, a destination that is not an ARN, and a destination type Lambda does not accept." },
    { id: 'edit', title: 'Fix the config', body: "Replace the file with this version and Save. Both destinations are SQS ARNs (the account id `000000000000` is the emulator's), one retry, an hour of event age.", code: { file: 'event-invoke-config.json', text: EIC_SOLUTION } },
    { id: 'apply', title: 'Apply it and read it back', body: "The emulator accepts the config (and checks that the role may send to SQS). Real AWS does the same and then really delivers.", commands: ['aws lambda put-function-event-invoke-config --cli-input-json file://event-invoke-config.json', 'aws lambda get-function-event-invoke-config --function-name orders-handler'] },
    { id: 'fire', title: 'Fire a failing async event and look at the queue', body: `Send an event that makes the handler throw, wait a few seconds, then count messages in \`orders-failures\`. On AWS you would find one record (condition RetriesExhausted) after about a minute. The emulator reports 0: the config is accepted, nothing is delivered. That is the limit of this concept module.`, commands: [`aws lambda invoke --function-name orders-handler --invocation-type Event --cli-binary-format raw-in-base64-out --payload '{"fail":true,"orderId":"o-1"}' async.json`, `aws sqs get-queue-attributes --queue-url ${Q}/orders-failures --attribute-names ApproximateNumberOfMessages --query Attributes`] },
    { id: 'dlq', title: 'The older way: a function DLQ', body: "`DeadLetterConfig` points the function at an SQS queue or SNS topic. It only catches failures and only carries the original event, which is why destinations are preferred. Again, accepted but not delivered here.", commands: ['aws lambda update-function-configuration --function-name orders-handler --dead-letter-config TargetArn=arn:aws:sqs:us-east-1:000000000000:orders-dlq'] },
    { id: 'next', title: 'Do the hands-on version', body: "For a failure path that runs for real, open module 5.3 `sqs-dlq-redrive` (poison messages, `maxReceiveCount`, redrive) and the Step Functions Retry/Catch module. Both really move failed work to a quarantine, which this module cannot." },
  ],
  breakIt: {
    title: 'What goes wrong when async failure handling is misconfigured',
    command: '',
    explain: [
      "No destination and no DLQ: after the retries are exhausted (or the event is older than `MaximumEventAgeInSeconds`) Lambda drops the event. There is no error to the original sender, because it already got a 202. The only trace is the `AsyncEventsDropped` metric and your logs.",
      "A destination whose role permission is missing, or of a type Lambda does not support (S3, a FIFO misconfiguration), is rejected when you save the config, or silently never receives data if the permission is removed later. Retries of 0 without a destination lose events on every transient error; a non-idempotent handler with retries 2 charges a customer twice. The SQS-trigger case is the third classic: putting a DLQ on the function does nothing, because the failure is handled by the source queue's redrive policy.",
    ],
  },
  realAws: {
    cost: [
      "Destinations and DLQs cost the SQS/SNS/EventBridge requests they generate plus the extra Lambda retries (each retry is a billed invocation). Check the Lambda and SQS pricing pages for current rates.",
    ],
    differences: [
      "On AWS the OnSuccess and OnFailure records are delivered within seconds of the final attempt and the DLQ message carries ErrorCode, ErrorMessage and RequestID attributes. The emulator accepts the same configuration but delivers none of them.",
      "Real AWS retries after roughly 1 and 2 minutes; waiting for that here would teach nothing because nothing arrives at the end.",
      "AWS also offers on-failure destinations for stream event source mappings (Kinesis, DynamoDB Streams) with SQS, SNS or S3 targets; that is a different setting from this async config.",
    ],
    asOf: '2026-11-13',
    sources: [
      { label: 'Invoking a Lambda function asynchronously', url: 'https://docs.aws.amazon.com/lambda/latest/dg/invocation-async.html' },
      { label: 'Capturing records of Lambda asynchronous invocations', url: 'https://docs.aws.amazon.com/lambda/latest/dg/invocation-async-retain-records.html' },
      { label: 'Handling errors for an SQS event source in Lambda', url: 'https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html' },
    ],
  },
  fidelity: [{ service: 'Lambda', pass: 395, total: 788 }, { service: 'SQS', pass: 299, total: 335 }],
  files: ['event-invoke-config.json', 'orders.mjs', 'orders.zip'],
  checks: [
    { id: 'json', label: '`event-invoke-config.json` is valid JSON for function `orders-handler`', hint: 'Keep it valid JSON with FunctionName "orders-handler".' },
    { id: 'failure', label: 'OnFailure is a well-formed ARN of an allowed type (SQS, SNS, Lambda or EventBridge)', hint: 'Use a full ARN such as arn:aws:sqs:us-east-1:000000000000:orders-failures.' },
    { id: 'success', label: 'OnSuccess is a well-formed ARN of an allowed type (not S3)', hint: 'S3 is not a valid async destination. Use SQS, SNS, Lambda or EventBridge.' },
    { id: 'retries', label: 'MaximumRetryAttempts is between 0 and 2', hint: 'Async invokes allow 0, 1 or 2 retries.' },
    { id: 'age', label: 'MaximumEventAgeInSeconds is between 60 and 21600', hint: 'The range is 60 seconds to 6 hours (21600).' },
    { id: 'applied', label: 'The emulator accepted your config with put-function-event-invoke-config', hint: 'Run the apply step after saving the file.' },
  ],
}
