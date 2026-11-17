import type { LessonContent } from '../types'

const F = 'https://sqs.us-east-1.amazonaws.com/000000000000/orders.fifo'
const G = 'https://sqs.us-east-1.amazonaws.com/000000000000/groups.fifo'

export const sqsFifo: LessonContent = {
  id: 'sqs-fifo',
  n: '5.4',
  trackId: 'messaging',
  level: 'intermediate',
  prereqs: ['sqs-visibility'],
  estMinutes: 25,
  honesty: 'live',
  examTags: ['SAA:Resilient', 'DVA:Dev'],
  breakItCheck: 'breakit',
  title: 'FIFO queues: ordering, groups and deduplication',
  tagline: 'Exactly-once-ish processing, in order, and the single-lane rule that limits it.',
  predict: [
    { id: 'p1', prompt: "You send a message to a FIFO queue with MessageDeduplicationId d1, then send the same message again with d1 two minutes later. What happens?", options: ["Two copies are delivered", "The second send succeeds but SQS drops it: only one copy is delivered", "The second send fails with an error", "The second replaces the first"], answer: 1, explain: "Within the 5-minute deduplication interval SQS accepts the duplicate send (so retries are safe) and silently discards it." },
    { id: 'p2', prompt: "Group A has a message in flight. Which messages can another consumer receive?", options: ["None until the queue is empty", "Only messages from other groups (group B), but nothing from group A", "Messages from group A that are newer", "Any message"], answer: 1, explain: "SQS preserves order within a message group by handing out the next message of a group only after the earlier one is deleted or becomes visible again. Other groups are unaffected." },
    { id: 'p3', prompt: "Where does a FIFO queue guarantee ordering?", options: ["Across the whole queue", "Within a message group id", "Per producer", "Per message size"], answer: 1, explain: "Ordering is per MessageGroupId. Many group ids give you parallelism; a single group id serializes everything." },
  ],
  concept: [
    "A standard queue is built for scale: nearly unlimited throughput, **at-least-once** delivery and **best-effort ordering**. A **FIFO queue** (name must end in `.fifo`) makes two stronger promises: **ordering** within a message group and **exactly-once processing** within a deduplication window. In return it has lower throughput (300 messages per second per API action, 3,000 with batching; high-throughput mode raises that considerably) and some extra rules.",
    "Every FIFO message needs a **`MessageGroupId`**. All messages with the same group id are delivered strictly in the order sent, and **one at a time**: while a message of group A is in flight (received, not deleted) no further A message is handed out. Messages of other groups keep flowing, so the group id is your **parallelism knob**. One id for everything is simple but processes one message at a time. One id per customer (or per order) gives order where it matters and concurrency across customers. A classic exam trap is a single group id on a queue that must scale.",
    "**Deduplication** stops a retried send from creating a duplicate. Supply a `MessageDeduplicationId` per logical message, or turn on `ContentBasedDeduplication` so SQS hashes the body for you (then two *different* messages with identical bodies are treated as duplicates, which can drop legitimate messages). Within the **5-minute** deduplication interval a second send with the same id is accepted and discarded. After 5 minutes it is a new message. Deduplication protects the producer side; the consumer still has to delete messages promptly to avoid redelivery.",
    "Practical limits to remember: per-message delay is not supported on FIFO (only queue-level), a FIFO queue can only trigger a FIFO-compatible redrive target, and Lambda triggers on FIFO queues process one group at a time. You will create a FIFO queue, send ordered messages with a duplicate, verify the order, and then watch group B overtake a blocked group A.",
  ],
  goal: "`orders.fifo` returned o1, o2, o3 once each and in order, `groups.fifo` let group B through while group A was blocked, and a send without a group id was refused.",
  steps: [
    { id: 'create', title: 'Create a FIFO queue', body: "The `.fifo` suffix is mandatory and `FifoQueue=true` must be set. Content-based deduplication is off, so you provide the dedup ids yourself.", commands: [`aws sqs create-queue --queue-name orders.fifo --attributes FifoQueue=true,ContentBasedDeduplication=false`] },
    { id: 'send', title: 'Send three ordered messages and one duplicate', body: "One group, `cust-1`, three messages with distinct dedup ids. Then re-send `o1` with the same dedup id: the call succeeds but SQS drops it.", commands: [
      `aws sqs send-message --queue-url ${F} --message-body o1 --message-group-id cust-1 --message-deduplication-id d1`,
      `aws sqs send-message --queue-url ${F} --message-body o2 --message-group-id cust-1 --message-deduplication-id d2`,
      `aws sqs send-message --queue-url ${F} --message-body o3 --message-group-id cust-1 --message-deduplication-id d3`,
      `aws sqs send-message --queue-url ${F} --message-body o1 --message-group-id cust-1 --message-deduplication-id d1`] },
    { id: 'receive', title: 'Receive in order, once each', body: "`o1 o2 o3` in order, and no second `o1`. The duplicate never made it into the queue.", commands: [`aws sqs receive-message --queue-url ${F} --max-number-of-messages 10 --query 'Messages[].Body' --output text`] },
    { id: 'groups', title: 'Two groups: A is blocked, B flows', body: "A second queue with content-based dedup, so no dedup ids are needed. Send `a1`, `a2` to group A and `b1` to group B.", commands: [
      `aws sqs create-queue --queue-name groups.fifo --attributes FifoQueue=true,ContentBasedDeduplication=true`,
      `aws sqs send-message --queue-url ${G} --message-body a1 --message-group-id A`,
      `aws sqs send-message --queue-url ${G} --message-body a2 --message-group-id A`,
      `aws sqs send-message --queue-url ${G} --message-body b1 --message-group-id B`] },
    { id: 'lane', title: 'Receive a1, then ask for everything else', body: "First take one message: it is `a1`, which puts group A in flight. Then ask for up to 10 more: you get only `b1`. `a2` is stuck behind `a1`, because order within group A must be kept.", commands: [`aws sqs receive-message --queue-url ${G} --max-number-of-messages 1 --query 'Messages[].Body' --output text`, `aws sqs receive-message --queue-url ${G} --max-number-of-messages 10 --query 'Messages[].Body' --output text`] },
    { id: 'break', title: 'Break it: send without a group id', body: "Every FIFO message needs a group. The service refuses the request.", commands: [`aws sqs send-message --queue-url ${F} --message-body no-group --message-deduplication-id d0`], breakIt: true },
  ],
  breakIt: {
    title: 'A FIFO send without MessageGroupId',
    command: `aws sqs send-message --queue-url ${F} --message-body no-group --message-deduplication-id d0`,
    explain: [
      "`MissingParameter: The request must contain the parameter MessageGroupId`. Ordering is defined per group, so a FIFO message without one has no place in any order and is rejected outright. The same applies to a missing deduplication id when content-based deduplication is off.",
      "That is a good moment to decide your group strategy: per customer, per order, per device. The group id is both your ordering boundary and your concurrency limit, and changing it later means redesigning your consumers.",
    ],
  },
  realAws: {
    cost: [
      "FIFO requests cost slightly more than standard: about $0.50 per million versus $0.40 after the free tier (us-east-1, SQS pricing page, check it for current numbers). Batching up to 10 messages per call cuts the request count.",
      "Throughput: 300 transactions per second per API action without batching, 3,000 messages per second with batching, and far higher in high-throughput mode, with a per-message-group limit. Standard queues have no practical limit.",
    ],
    differences: [
      "On real AWS the deduplication interval is a fixed 5 minutes and there are two ordering scopes in high-throughput mode (queue or message group). The emulator implements the basic mode used here.",
      "FIFO queues do not support per-message delay or message timers, and an SNS FIFO topic can only deliver to FIFO queues.",
      "Consumers scale by group: ten groups can be processed by ten workers in parallel on AWS, but a single group is always one at a time.",
    ],
    asOf: '2026-11-13',
    sources: [{ label: 'Amazon SQS FIFO queues', url: 'https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues.html' }, { label: 'FIFO delivery logic', url: 'https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-understanding-logic.html' }],
  },
  fidelity: [{ service: 'SQS', pass: 299, total: 335 }],
  files: [],
  checks: [
    { id: 'queue', label: 'Queue `orders.fifo` exists as a FIFO queue', hint: 'Create it with --attributes FifoQueue=true (step 1).' },
    { id: 'order', label: 'You received o1, o2, o3 in order with no duplicate', hint: 'Send the four messages (step 2), then run the receive in step 3.' },
    { id: 'groups', label: 'You saw group B get through while group A was blocked', hint: 'Do step 4 and run both receives in step 5.' },
    { id: 'breakit', label: 'You saw MissingParameter for a send without a group id', hint: 'Run the break-it command.' },
  ],
}
