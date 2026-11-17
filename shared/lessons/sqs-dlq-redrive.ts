import type { LessonContent } from '../types'

const O = 'https://sqs.us-east-1.amazonaws.com/000000000000/orders'
const D = 'https://sqs.us-east-1.amazonaws.com/000000000000/orders-dlq'
const OA = 'arn:aws:sqs:us-east-1:000000000000:orders'
const DA = 'arn:aws:sqs:us-east-1:000000000000:orders-dlq'

export const sqsDlqRedrive: LessonContent = {
  id: 'sqs-dlq-redrive',
  n: '5.3',
  trackId: 'messaging',
  level: 'intermediate',
  prereqs: ['sqs-visibility'],
  estMinutes: 25,
  honesty: 'live',
  examTags: ['SAA:Resilient', 'DVA:Dev', 'DVA:Troubleshoot'],
  breakItCheck: 'breakit',
  editable: ['redrive.json'],
  title: 'Dead-letter queues and redrive',
  tagline: 'Quarantine the poison message, then replay it when the bug is fixed.',
  predict: [
    { id: 'p1', prompt: "The source queue's redrive policy has maxReceiveCount = 2. A message is received twice and never deleted. What happens on the third receive attempt?", options: ["It is delivered a third time", "SQS moves it to the dead-letter queue instead of delivering it", "It is deleted", "The consumer gets an error"], answer: 1, explain: "Once a message has been received maxReceiveCount times without being deleted, the next receive moves it to the DLQ rather than returning it." },
    { id: 'p2', prompt: "The source queue keeps messages 4 days. The DLQ also keeps 4 days. A message fails and is moved to the DLQ on day 3. How long do you have to look at it?", options: ["4 more days", "About 1 day: the original enqueue timestamp is kept, so the clock keeps running", "Forever", "3 days"], answer: 1, explain: "A moved message keeps its original enqueue time, so the DLQ retention counts from when the message first entered the source queue. Set the DLQ retention longer than the source, up to 14 days." },
    { id: 'p3', prompt: "Which dead-letter queue can a FIFO source queue use?", options: ["Any queue", "Only a FIFO queue", "Only a standard queue", "DLQs are not supported for FIFO"], answer: 1, explain: "The DLQ must be the same type as the source: FIFO with FIFO, standard with standard." },
  ],
  concept: [
    "A **poison message** is one your consumer can never process: malformed JSON, a reference to something that was deleted, a bug in the handler. Without protection it is received, fails, becomes visible again, is received again, and loops forever, burning compute and hiding behind healthy traffic. A **dead-letter queue (DLQ)** is the pressure valve: you attach a **redrive policy** to the source queue naming the DLQ and a `maxReceiveCount`. When a message has been received that many times without being deleted, SQS moves it to the DLQ and the main queue moves on.",
    "The redrive policy is a queue attribute, and its value is **a JSON string inside JSON**: `{\"RedrivePolicy\": \"{\\\"deadLetterTargetArn\\\": ..., \\\"maxReceiveCount\\\": \\\"2\\\"}\"}`. That double-encoding trips everyone, which is why this module keeps it in a file you edit. Choose `maxReceiveCount` thoughtfully: too low and transient failures (a downstream outage) send good messages to the DLQ, too high and a poison message wastes many cycles. Values from 3 to 5 are typical for web workloads, and 5 or more is advised for Lambda triggers because throttling counts as a receive.",
    "A DLQ is **only useful if someone looks at it**. Alarm on `ApproximateNumberOfMessagesVisible` of the DLQ so a growing queue pages a human. Keep its retention longer than the source (the message's original enqueue time is preserved, so a 4-day retention on both gives you less than a day to react to a day-3 failure). The DLQ must be the same type as the source: standard with standard, FIFO with FIFO.",
    "Once the bug is fixed you do not copy messages by hand: **DLQ redrive** (`start-message-move-task`) moves them from the DLQ back to the source queue (or another queue) at a rate you control, and `list-message-move-tasks` shows progress. In this module you will edit the redrive policy, make a message fail three times, find it in the DLQ and replay it.",
  ],
  goal: "A redrive policy with maxReceiveCount 3 or lower is on `orders`, the poison message reached `orders-dlq`, and a move task returned it to `orders`.",
  steps: [
    { id: 'look', title: 'Read the redrive policy file', body: "The fixture created `orders` (visibility timeout 1 second, so retries are quick) and `orders-dlq`. Open `redrive.json` in Files. The policy points at the DLQ but `maxReceiveCount` is 5. Notice the escaped quotes: the value of `RedrivePolicy` is a JSON string." },
    { id: 'edit', title: 'Change maxReceiveCount to 2 and apply it', body: "In the editor change `\\\"5\\\"` to `\\\"2\\\"` (keep the backslashes) and Save. Apply it to the source queue.", commands: [`aws sqs set-queue-attributes --queue-url ${O} --attributes file://redrive.json`, `aws sqs get-queue-attributes --queue-url ${O} --attribute-names RedrivePolicy`] },
    { id: 'send', title: 'Send a poison message', body: "Pretend this body can never be parsed by your consumer.", commands: [`aws sqs send-message --queue-url ${O} --message-body poison`] },
    { id: 'fail', title: 'Break it: receive three times and never delete', body: "Run this command three times. Each long poll waits for the message to become visible again. The first two attempts return it (`ApproximateReceiveCount` 1 and 2). On the third, SQS sees maxReceiveCount exceeded and moves it to the DLQ: you get nothing back.", commands: [`aws sqs receive-message --queue-url ${O} --attribute-names ApproximateReceiveCount --wait-time-seconds 3`], breakIt: true },
    { id: 'peek', title: 'Find it in the dead-letter queue', body: "`--visibility-timeout 0` peeks without hiding the message (an in-flight message cannot be redriven). You should see `poison` and a receive count of its own. Also look it up from the other direction.", commands: [`aws sqs receive-message --queue-url ${D} --visibility-timeout 0 --wait-time-seconds 3`, `aws sqs list-dead-letter-source-queues --queue-url ${D}`] },
    { id: 'redrive', title: 'Replay it after the fix', body: "Pretend you shipped the bug fix. A message move task copies everything from the DLQ back to the source and then deletes it from the DLQ. By default the destination is the queue each message originally came from.", commands: [`aws sqs start-message-move-task --source-arn ${DA} --destination-arn ${OA}`, `aws sqs list-message-move-tasks --source-arn ${DA}`] },
    { id: 'verify', title: 'Confirm it is back', body: "The message is in `orders` again with a fresh receive count, ready for the fixed consumer.", commands: [`aws sqs get-queue-attributes --queue-url ${O} --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible`] },
  ],
  breakIt: {
    title: 'A message that is received but never deleted',
    command: `aws sqs receive-message --queue-url ${O} --attribute-names ApproximateReceiveCount --wait-time-seconds 3`,
    explain: [
      "The first two receives return `poison`; the third returns nothing. Quietly, SQS has moved it to `orders-dlq`. The consumer never sees an error: from its side the queue is simply empty. The proof is in the DLQ, which is why monitoring the DLQ depth is part of the pattern.",
      "On real AWS the same thing happens, except a real fleet is doing the receiving and the retries are driven by crashes or by throttling. If maxReceiveCount is 1, one transient failure is enough to dead-letter good messages, which is the usual cause of \"messages vanish\" tickets.",
    ],
  },
  realAws: {
    cost: [
      "A DLQ is just another queue, billed like one (about $0.40 per million requests for standard queues after the free tier, us-east-1, check the pricing page). A redrive move task is made of ordinary receive, send and delete calls.",
      "Messages sitting in a DLQ cost almost nothing, but unattended ones are expensive in the other sense: they are lost work. Always alarm on the DLQ depth.",
    ],
    differences: [
      "Real AWS rate-limits a move task (a maximum per-second rate you can set) and the DLQ must be in the same account and Region as the source. Both hold in the emulator.",
      "Message move tasks work for standard and FIFO DLQs. For a FIFO DLQ, order within a message group is preserved.",
      "The emulator moves a message at the same moment it would on AWS in this tiny scenario, but AWS evaluates the receive count lazily, at the next receive, as you saw here.",
    ],
    asOf: '2026-11-13',
    sources: [{ label: 'Amazon SQS dead-letter queues', url: 'https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html' }, { label: 'Configuring dead-letter queue redrive', url: 'https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-configure-dead-letter-queue-redrive.html' }],
  },
  fidelity: [{ service: 'SQS', pass: 299, total: 335 }],
  files: ['redrive.json'],
  checks: [
    { id: 'policy', label: 'Queue `orders` redrives to `orders-dlq` after 3 receives or fewer', hint: 'Set maxReceiveCount to 2 in redrive.json, Save, then run set-queue-attributes.' },
    { id: 'breakit', label: 'You received the poison message three times without deleting it', hint: 'Send `poison`, then run the receive command three times.' },
    { id: 'dlq', label: 'The poison message reached `orders-dlq`', hint: 'After the third receive it moves. Peek at the DLQ with --visibility-timeout 0.' },
    { id: 'moved', label: 'A message move task completed and the message is back in `orders`', hint: 'Run start-message-move-task from the DLQ to orders, then check again.' },
  ],
}
