import type { LessonContent } from '../types'

export const snsSqs: LessonContent = {
  id: 'sns-sqs',
  n: '5.1',
  trackId: 'messaging',
  level: 'core',
  prereqs: [],
  estMinutes: 20,
  honesty: 'live',
  examTags: ["SAA:Resilient", "DVA:Dev"],
  predict: [{"id": "p1", "prompt": "A topic has an SQS subscription, but the queue policy does not allow SNS. What does `sns publish` return?", "options": ["An AccessDenied error", "A MessageId, and the message silently never reaches the queue", "A MessageId and the message arrives anyway", "A 404 for the subscription"], "answer": 1, "explain": "Publish only confirms SNS accepted the message. Delivery to each subscriber is separate, and a refusal by the queue is not reported to the publisher."}],

  title: 'SQS + SNS: fan-out and the queue policy',
  tagline: 'One event, two queues, and the silent failure that bites everyone once.',
  concept: [
    'An **SQS queue** holds messages until a consumer picks them up, so producers and consumers do not have to be online together. An **SNS topic** is the opposite shape: you publish once and SNS **fans out** to every subscriber. Topic to several queues is the classic way to let independent workers react to the same event.',
    'For SNS to put a message in a queue, the queue\'s **access policy** must allow `sns.amazonaws.com` to `sqs:SendMessage`, ideally limited to your topic with `aws:SourceArn`. Subscribing is not enough.',
    'The failure is **silent**: `publish` succeeds and returns a MessageId; the message just never arrives. You will do it wrong first, on purpose.',
  ],
  goal: 'Topic `order-events` delivering to both `orders-a` and `orders-b`.',
  steps: [
    { id: 'queues', title: 'Create two queues', body: 'Both start with the default (empty) access policy.', commands: ['aws sqs create-queue --queue-name orders-a', 'aws sqs create-queue --queue-name orders-b'] },
    { id: 'topic', title: 'Create the topic', body: 'Standard topic.', commands: ['aws sns create-topic --name order-events'] },
    { id: 'subscribe', title: 'Subscribe both queues', body: '`RawMessageDelivery` puts your message body in the queue without the SNS envelope.', commands: [
      'aws sns subscribe --topic-arn arn:aws:sns:us-east-1:000000000000:order-events --protocol sqs --notification-endpoint arn:aws:sqs:us-east-1:000000000000:orders-a --attributes RawMessageDelivery=true',
      'aws sns subscribe --topic-arn arn:aws:sns:us-east-1:000000000000:order-events --protocol sqs --notification-endpoint arn:aws:sqs:us-east-1:000000000000:orders-b --attributes RawMessageDelivery=true'] },
    { id: 'break', title: 'Break it: publish and look for the message', body: 'Publish returns a MessageId. Then receive from `orders-a`: nothing. Your subscription exists, but the queue has not allowed SNS in.', commands: [
      `aws sns publish --topic-arn arn:aws:sns:us-east-1:000000000000:order-events --message '{"order":1}'`,
      'aws sqs receive-message --queue-url https://sqs.us-east-1.amazonaws.com/000000000000/orders-a --wait-time-seconds 2'], breakIt: true },
    { id: 'policy', title: 'Allow the topic to send', body: '`attrs-a.json` and `attrs-b.json` in your folder wrap a policy that allows `sns.amazonaws.com` only when the source is this topic. Open one in Files.', commands: [
      'aws sqs set-queue-attributes --queue-url https://sqs.us-east-1.amazonaws.com/000000000000/orders-a --attributes file://attrs-a.json',
      'aws sqs set-queue-attributes --queue-url https://sqs.us-east-1.amazonaws.com/000000000000/orders-b --attributes file://attrs-b.json'] },
    { id: 'again', title: 'Publish again and receive from both', body: 'Now each queue has the message.', commands: [
      `aws sns publish --topic-arn arn:aws:sns:us-east-1:000000000000:order-events --message '{"order":2}'`,
      "aws sqs receive-message --queue-url https://sqs.us-east-1.amazonaws.com/000000000000/orders-a --wait-time-seconds 2 --query 'Messages[].Body' --output text",
      "aws sqs receive-message --queue-url https://sqs.us-east-1.amazonaws.com/000000000000/orders-b --wait-time-seconds 2 --query 'Messages[].Body' --output text"] },
  ],
  breakIt: {
    title: 'Publish before the queue policy exists',
    command: `aws sns publish --topic-arn arn:aws:sns:us-east-1:000000000000:order-events --message '{"order":1}'`,
    explain: [
      'No error. SNS accepted the publish; delivery to each subscriber is a separate step that can fail without telling the publisher. The queue refused SNS because nothing allowed it, so `receive-message` is empty.',
      'Real AWS behaves the same way. The tell is in the topic\'s delivery-failure metrics/logs, not in the publish response. The emulator logs a warning on its side that says the same thing.',
    ],
  },
  realAws: {
    cost: [
      'SQS and SNS both have a free allowance of roughly one million requests a month, then cost on the order of cents per million requests (approximate: the pricing tables did not render for automated lookup, check the pages).',
      'SNS-to-SQS delivery in the same Region has no per-message delivery charge on the SNS page; data transfer rules apply.',
    ],
    differences: [
      'Real AWS also offers FIFO queues/topics, dead-letter queues and message filtering on subscriptions. Only standard queues and topics are used here.',
      'Visibility timeout: a received message is hidden, not deleted, until you call `delete-message`. Same on real AWS.',
    ],
    asOf: '2026-11-13',
    sources: [{ label: 'SQS pricing', url: 'https://aws.amazon.com/sqs/pricing/' }, { label: 'SNS pricing', url: 'https://aws.amazon.com/sns/pricing/' }],
  },
  fidelity: [{ service: 'SQS', pass: 299, total: 335 }, { service: 'SNS', pass: 239, total: 284 }],
  files: ['attrs-a.json', 'attrs-b.json'],
  probeNote: 'The delivery check publishes a probe message to the topic and looks for it in both queues when you press Check.',
  checks: [
    { id: 'queues', label: 'Queues `orders-a` and `orders-b` exist', hint: 'Step 1.' },
    { id: 'subs', label: 'Topic `order-events` has 2 SQS subscriptions', hint: 'Steps 2 and 3.' },
    { id: 'policies', label: 'Both queue policies allow SNS from this topic', hint: 'Apply attrs-a.json and attrs-b.json.' },
    { id: 'delivery', label: 'A probe message reaches both queues', hint: 'Press Check after applying the policies.' },
  ],
}
