import type { LessonContent } from '../types'

const J = 'https://sqs.us-east-1.amazonaws.com/000000000000/jobs'
const JD = 'https://sqs.us-east-1.amazonaws.com/000000000000/jobs-dlq'
const JA = 'arn:aws:sqs:us-east-1:000000000000:jobs'

export const sqsLambdaBatch: LessonContent = {
  id: 'sqs-lambda-batch',
  n: '5.6',
  trackId: 'messaging',
  level: 'advanced',
  prereqs: ['sqs-dlq-redrive', 'lambda-roles'],
  estMinutes: 40,
  honesty: 'live',
  honestyNote: 'The event source mapping, batching and partial batch responses run for real. Scaling behaviour under heavy load is not representative.',
  examTags: ['DVA:Dev', 'DVA:Troubleshoot', 'SAA:Resilient'],
  breakItCheck: 'breakit',
  editable: ['handler.mjs'],
  title: 'SQS to Lambda at scale: partial batch failures',
  tagline: 'One bad message in a batch of ten should not replay the other nine.',
  predict: [
    { id: 'p1', prompt: "A Lambda handler throws while processing one message of a batch of 10, and ReportBatchItemFailures is not enabled. What happens to the other 9 messages?", options: ["They are deleted, only the bad one stays", "All 10 become visible again and are retried, so the 9 good ones are processed again", "Lambda deletes them and retries only the bad one", "They move to the Lambda function's dead-letter queue"], answer: 1, explain: "A thrown error fails the whole batch. All 10 messages return to the queue after the visibility timeout, so handlers must be idempotent, and the real fix is a partial batch response." },
    { id: 'p2', prompt: "How should the queue's visibility timeout compare with the function timeout?", options: ["Shorter, so retries are fast", "At least the function timeout; AWS recommends six times it", "They are unrelated", "Exactly equal"], answer: 1, explain: "If the visibility timeout is shorter than the function can run, messages become visible while still being processed and are handled twice. AWS rejects a mapping where it is shorter than the function timeout and recommends 6x." },
    { id: 'p3', prompt: "Where do you configure the dead-letter queue for failed messages when SQS triggers Lambda?", options: ["On the Lambda function's DLQ setting", "On the source SQS queue, as a redrive policy", "On the event source mapping only", "It is automatic"], answer: 1, explain: "The function-level DLQ is for asynchronous invocations. For an SQS trigger, failed messages are handled by the source queue's redrive policy." },
  ],
  concept: [
    "An SQS **event source mapping** is a managed poller: Lambda long-polls the queue for you, gathers up to `BatchSize` messages (up to 10,000 with a batching window on standard queues) into one invocation, and **deletes the messages only if the function returns successfully**. Scale is automatic: Lambda starts with a handful of pollers and adds more as the queue grows, up to a concurrency limit you can set with `ScalingConfig` or reserved concurrency to protect a downstream system.",
    "Batching creates the central problem. If the function throws, the **whole batch** is treated as failed: all messages become visible again after the visibility timeout and are retried, including the ones already processed. Good messages are re-processed and, after `maxReceiveCount` attempts, even good messages can be dead-lettered because they travelled with a bad one. The fix is **partial batch responses**: enable `ReportBatchItemFailures` on the mapping and return `{ \"batchItemFailures\": [{ \"itemIdentifier\": messageId }] }`. Lambda deletes everything *not* listed and returns only the failed ones to the queue.",
    "Three settings have to agree. The queue's **visibility timeout** must be at least the function timeout (AWS rejects the mapping otherwise, and recommends six times it, to absorb retries and batching windows). The source queue needs a **redrive policy** with a sensible `maxReceiveCount` (5 or more for Lambda, because throttled invokes also consume receives). And your handler must be **idempotent**, because standard queues are at-least-once and retries are normal.",
    "In this module you edit a handler in the built-in editor (the server rebuilds `handler.zip` from your source), create a function with a 3-second timeout, hit the visibility-timeout rule on purpose, fix the queue, wire the mapping with partial batch responses and prove that only the bad message lands in the DLQ.",
  ],
  goal: "A 3-second function reports partial batch failures, the mapping is wired with ReportBatchItemFailures, queue visibility is 18 s or more, and only `bad2` ended up in `jobs-dlq`.",
  steps: [
    { id: 'look', title: 'Read the naive handler', body: "The fixture created queue `jobs` (visibility timeout **2 s**, redrive to `jobs-dlq` after one receive) and the role `lambda-exec`. Open `handler.mjs`. It throws when a message contains `bad`: with that, one poison message fails the whole batch." },
    { id: 'edit', title: 'Rewrite it to report partial failures', body: "In the editor replace the file with this version and Save. The server rebuilds `handler.zip` from your source. The handler collects the ids of messages that failed and returns them instead of throwing.", code: { file: 'handler.mjs', text: `export const handler = async (event) => {\n  const batchItemFailures = [];\n  for (const r of event.Records) {\n    try {\n      if (r.body.includes("bad")) throw new Error("cannot process " + r.body);\n      console.log("ok", r.body);\n    } catch (e) {\n      batchItemFailures.push({ itemIdentifier: r.messageId });\n    }\n  }\n  return { batchItemFailures };\n};` } },
    { id: 'fn', title: 'Create the function with a 3-second timeout', body: "The timeout is what the queue's visibility timeout is compared with.", commands: [`aws lambda create-function --function-name batch-worker --runtime nodejs22.x --handler handler.handler --role arn:aws:iam::000000000000:role/lambda-exec --zip-file fileb://handler.zip --timeout 3`, `aws lambda wait function-active-v2 --function-name batch-worker`] },
    { id: 'break', title: 'Break it: connect a queue whose visibility timeout is too short', body: "The queue's 2 seconds is shorter than the function's 3. AWS refuses the mapping, because messages would reappear while the function is still working on them.", commands: [`aws lambda create-event-source-mapping --function-name batch-worker --event-source-arn ${JA} --batch-size 10`], breakIt: true },
    { id: 'vis', title: 'Fix the queue: visibility 18 seconds', body: "Six times the function timeout, the AWS recommendation.", commands: [`aws sqs set-queue-attributes --queue-url ${J} --attributes VisibilityTimeout=18`] },
    { id: 'esm', title: 'Create the mapping with partial batch responses', body: "`--function-response-types ReportBatchItemFailures` tells Lambda to honour your `batchItemFailures`. A one-second batching window lets the whole batch accumulate.", commands: [`aws lambda create-event-source-mapping --function-name batch-worker --event-source-arn ${JA} --batch-size 10 --maximum-batching-window-in-seconds 1 --function-response-types ReportBatchItemFailures`] },
    { id: 'send', title: 'Send a batch with one bad message', body: "Give the mapping a few seconds to start, then send two good messages and one bad one in one call.", commands: [`aws sqs send-message-batch --queue-url ${J} --entries Id=1,MessageBody=good1 Id=2,MessageBody=bad2 Id=3,MessageBody=good3`] },
    { id: 'dlq', title: 'Wait about 30 seconds and read the DLQ', body: "Good messages were deleted on the first success. `bad2` was returned, became visible after 18 s, was received a second time and moved to the DLQ. Only `bad2`. Seeing it twice is not a bug: standard queues are at-least-once.", commands: [`aws sqs receive-message --queue-url ${JD} --visibility-timeout 0 --max-number-of-messages 10 --wait-time-seconds 3 --query 'Messages[].Body' --output text`] },
  ],
  breakIt: {
    title: 'Visibility timeout shorter than the function timeout',
    command: `aws lambda create-event-source-mapping --function-name batch-worker --event-source-arn ${JA} --batch-size 10`,
    explain: [
      "`InvalidParameterValueException: Queue visibility timeout: 2 seconds is less than Function timeout: 3 seconds`. Lambda checks the two numbers when you create the mapping, because the alternative is subtle: a message becomes visible again while the first invocation is still running, a second invocation picks it up, and everything is processed twice.",
      "The fix has a second half that the exam loves: even when the numbers are legal, set the visibility timeout to about six times the function timeout, so a retry or batching window does not push the message back into view mid-flight.",
    ],
  },
  realAws: {
    cost: [
      "You pay for the Lambda invocations (requests and GB-seconds) plus the SQS requests the poller makes, including empty polls. Larger batches and a batching window mean fewer invocations and cheaper processing, at the price of latency. Check the Lambda and SQS pricing pages for current rates.",
      "Failed batches are billed too: every retry is another invocation. Partial batch responses are not just correct, they are cheaper, because good messages are not reprocessed.",
    ],
    differences: [
      "Real Lambda scales pollers up to 1,000 concurrent invocations for standard queues (and per message group for FIFO). `MaximumConcurrency` on the mapping caps it. The emulator runs the mapping but not the scale-out behaviour.",
      "On AWS use `maxReceiveCount` of 5 or more for Lambda-triggered queues: a throttled invocation counts as a receive and can dead-letter good messages. This lesson uses 1 only to keep the wait short.",
      "FIFO queues need partial batch responses that also stop on the first failure, to keep ordering. The emulator test used a standard queue.",
    ],
    asOf: '2026-11-13',
    sources: [{ label: 'Using Lambda with Amazon SQS', url: 'https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html' }, { label: 'Handling errors for an SQS event source in Lambda', url: 'https://docs.aws.amazon.com/lambda/latest/dg/services-sqs-errorhandling.html' }],
  },
  fidelity: [{ service: 'SQS', pass: 299, total: 335 }, { service: 'Lambda', pass: 395, total: 788 }],
  files: ['handler.mjs', 'handler.zip'],
  checks: [
    { id: 'fn', label: 'Function `batch-worker` is Active with a 3 s timeout and your partial-failure handler', hint: 'Edit handler.mjs (step 2), save, then run step 3.' },
    { id: 'breakit', label: 'You saw Lambda reject a mapping with a too-short visibility timeout', hint: 'Run the break-it command before fixing the queue.' },
    { id: 'vis', label: 'Queue `jobs` visibility timeout is at least 18 seconds', hint: 'Run step 5.' },
    { id: 'esm', label: 'The mapping uses ReportBatchItemFailures', hint: 'Run step 6 with --function-response-types ReportBatchItemFailures.' },
    { id: 'dlq', label: 'Only `bad2` is in `jobs-dlq`', hint: 'Send the batch (step 7), wait about 30 seconds, then run Check again.' },
  ],
}
