import type { LessonContent } from '../types'

const Q = 'https://sqs.us-east-1.amazonaws.com/000000000000/jobs'
const L = 'https://sqs.us-east-1.amazonaws.com/000000000000/later'

export const sqsVisibility: LessonContent = {
  id: 'sqs-visibility',
  n: '5.2',
  trackId: 'messaging',
  level: 'intermediate',
  prereqs: ['sns-sqs'],
  estMinutes: 25,
  honesty: 'live',
  examTags: ['SAA:Resilient', 'DVA:Dev'],
  breakItCheck: 'dup',
  title: 'Visibility timeout, long polling and delay queues',
  tagline: 'At-least-once delivery, felt in your hands: why a message you forgot to delete comes back.',
  predict: [
    { id: 'p1', prompt: "A consumer receives a message, then crashes before deleting it. The visibility timeout is 8 seconds. What happens?", options: ["The message is gone for good", "After 8 seconds it becomes visible again and is delivered a second time (ApproximateReceiveCount = 2)", "SQS sends it to the consumer again immediately", "It moves to the dead-letter queue"], answer: 1, explain: "Receiving does not delete. The message is only hidden for the visibility timeout, and if it is not deleted by then, SQS makes it available again. That is at-least-once delivery." },
    { id: 'p2', prompt: "You call receive-message with --wait-time-seconds 10 on an empty queue. What happens?", options: ["It returns immediately with no messages", "It waits up to 10 seconds and returns as soon as a message arrives (long polling)", "It fails: the maximum is 5", "It blocks until a message arrives, however long that takes"], answer: 1, explain: "Long polling waits up to 20 seconds, returns early when a message appears, and avoids paying for hundreds of empty short-poll responses." },
    { id: 'p3', prompt: "A queue has DelaySeconds = 5. You send a message and receive immediately. What do you get?", options: ["The message", "Nothing: new messages stay invisible for 5 seconds before the first receive", "An error", "The message, but flagged as delayed"], answer: 1, explain: "A delay queue postpones delivery of every new message. Unlike the visibility timeout, the delay applies before the first receive." },
  ],
  concept: [
    "SQS **does not push** messages and it **does not delete** them when you receive them. `receive-message` returns a message and starts its **visibility timeout** (30 seconds by default, up to 12 hours). While the clock runs the message is hidden from every other consumer. If your code finishes it calls `delete-message` with the **receipt handle** from that receive, and the message is gone. If your code crashes or is too slow, the clock expires and the message **reappears**, counted again in `ApproximateReceiveCount`. This is **at-least-once delivery**: a standard queue can deliver a message more than once, so consumers must be idempotent.",
    "Choosing the timeout is a real design decision. Too short and slow-but-healthy workers get their work handed to someone else (duplicates). Too long and a crashed worker holds up the message for minutes. A worker that knows it needs more time calls `change-message-visibility` to extend the clock for that message (a **heartbeat**), up to 12 hours in total. The handle is only good for the receive that produced it, so always delete with the **latest** handle.",
    "Two settings control how you wait. **Short polling** (the default when `WaitTimeSeconds` is 0) samples a subset of servers and can return empty even when messages exist, and each empty answer is a billed request. **Long polling** (`--wait-time-seconds` 1 to 20, or the queue attribute `ReceiveMessageWaitTimeSeconds`) queries all servers, waits for a message and returns early, which cuts empty receives and cost. It is the right default for almost every consumer.",
    "A **delay queue** (`DelaySeconds` 0 to 900) keeps each new message invisible for that long, for example to give a database commit time to become visible before the worker reads it. A per-message delay (`--delay-seconds` on send) exists for standard queues but not for FIFO. In this module you will watch a message vanish, return with a receive count of 2, hold one hidden with a longer timeout, and long-poll a delayed message.",
  ],
  goal: "You saw a message come back with ApproximateReceiveCount 2, deleted it with the fresh handle, extended another message's visibility, and long-polled a message out of a delay queue.",
  steps: [
    { id: 'first', title: 'Receive the job', body: "The fixture created queue `jobs` with `VisibilityTimeout` 8 seconds and one message `job1`. Receive it and ask for the receive count. Note `ReceiptHandle` and that the count is 1. The 8-second clock has started.", commands: [`aws sqs receive-message --queue-url ${Q} --attribute-names ApproximateReceiveCount --max-number-of-messages 1`] },
    { id: 'hidden', title: 'Receive again right away: nothing', body: "The message is in flight, invisible to everyone, including you. Use a one-second long poll so you do not have to guess.", commands: [`aws sqs receive-message --queue-url ${Q} --wait-time-seconds 1`] },
    { id: 'again', title: "Break it: wait, and don't delete", body: "Wait about 10 seconds, then receive again. The *same* message is back, and `ApproximateReceiveCount` is now **2**. A consumer that does not delete is a consumer that produces duplicates.", commands: [`aws sqs receive-message --queue-url ${Q} --attribute-names ApproximateReceiveCount --max-number-of-messages 1 --wait-time-seconds 3`], breakIt: true },
    { id: 'delete', title: 'Delete it with the newest receipt handle', body: "Copy the `ReceiptHandle` from the **latest** receive into `<RECEIPT_HANDLE>`. Deleting with an older handle can fail or be ignored on real AWS, and FIFO queues reject it. After this `job1` is gone for good.", commands: [`aws sqs delete-message --queue-url ${Q} --receipt-handle '<RECEIPT_HANDLE>'`] },
    { id: 'extend', title: 'Extend the timeout for a slow job', body: "Send `job2`, receive it, then raise its visibility timeout to 60 seconds with the new receipt handle. After 10 seconds a long poll still finds nothing: it stays hidden well past the queue's 8 seconds.", commands: [
      `aws sqs send-message --queue-url ${Q} --message-body job2`,
      `aws sqs receive-message --queue-url ${Q} --max-number-of-messages 1`,
      `aws sqs change-message-visibility --queue-url ${Q} --receipt-handle '<RECEIPT_HANDLE>' --visibility-timeout 60`,
      `aws sqs receive-message --queue-url ${Q} --wait-time-seconds 10`] },
    { id: 'delayq', title: 'Create a delay queue', body: "Every message sent to `later` is hidden for 5 seconds first.", commands: [`aws sqs create-queue --queue-name later --attributes DelaySeconds=5`, `aws sqs send-message --queue-url ${L} --message-body hello-later`, `aws sqs receive-message --queue-url ${L}`] },
    { id: 'long', title: 'Long poll for the delayed message', body: "The plain receive returned nothing (short polling, still delayed). Now ask again and let the call wait up to 10 seconds: it returns the message as soon as the delay ends, in about 5 seconds, with no polling loop.", commands: [`aws sqs receive-message --queue-url ${L} --wait-time-seconds 10 --query 'Messages[].Body' --output text`] },
  ],
  breakIt: {
    title: 'Receive a message and never delete it',
    command: `aws sqs receive-message --queue-url ${Q} --attribute-names ApproximateReceiveCount --max-number-of-messages 1 --wait-time-seconds 3`,
    explain: [
      "No error: SQS did exactly what it promises. The message was returned a second time with `ApproximateReceiveCount` 2 because the first consumer never deleted it. In a real system the first consumer would have done the work and then crashed, so the work is done twice: charge the card twice, send the email twice.",
      "The defences are in the consumer: make processing idempotent (a deduplication key, a conditional write as in module 3.4), delete only after the work succeeds, and size the visibility timeout above your worst-case processing time. Next module: what happens when a message keeps failing.",
    ],
  },
  realAws: {
    cost: [
      "Standard queues cost about $0.40 per million requests after the first million free per month; FIFO about $0.50 per million (us-east-1 list prices from the SQS pricing page, check it: they change). Every `ReceiveMessage` is a request, including empty ones, and payloads are billed in 64 KB chunks.",
      "Long polling is the cost lever: one 20-second long poll replaces dozens of empty short polls. A worker fleet that short-polls an idle queue pays for nothing.",
    ],
    differences: [
      "Standard queues deliver at least once and best-effort ordering, so duplicates and out-of-order messages happen on AWS far more than in a one-consumer emulator.",
      "The maximum visibility timeout is 12 hours in total for one message including extensions, and the default is 30 seconds. The emulator keeps these rules but timing under load is not representative.",
      "Delete with a stale receipt handle works unreliably on real AWS for standard queues and fails for FIFO queues. Always use the handle from the most recent receive.",
    ],
    asOf: '2026-11-13',
    sources: [{ label: 'SQS visibility timeout', url: 'https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html' }, { label: 'SQS short and long polling', url: 'https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-short-and-long-polling.html' }, { label: 'SQS pricing', url: 'https://aws.amazon.com/sqs/pricing/' }],
  },
  fidelity: [{ service: 'SQS', pass: 299, total: 335 }],
  files: [],
  checks: [
    { id: 'dup', label: 'You saw the same message again with ApproximateReceiveCount 2', hint: 'Receive (step 1), wait about 10 seconds without deleting, receive again (step 3) with --attribute-names ApproximateReceiveCount.' },
    { id: 'deleted', label: 'You deleted a message with delete-message', hint: 'Run step 4 with the newest receipt handle.' },
    { id: 'extended', label: 'A message is hidden by an extended visibility timeout (30 s or more)', hint: 'Run step 5: send job2, receive it and change-message-visibility to 60.' },
    { id: 'delayq', label: 'Queue `later` exists with a delay of at least 1 second', hint: 'Create it with --attributes DelaySeconds=5.' },
    { id: 'longpoll', label: 'You long-polled the delay queue and got the message', hint: 'Run step 7 with --wait-time-seconds 10.' },
  ],
}
