import type { LessonContent } from '../types'

const T = 'arn:aws:sns:us-east-1:000000000000:orders'
const qa = (n: string) => `arn:aws:sqs:us-east-1:000000000000:${n}`
const qu = (n: string) => `https://sqs.us-east-1.amazonaws.com/000000000000/${n}`
const RECV = (n: string) => `aws sqs receive-message --queue-url ${qu(n)} --max-number-of-messages 10 --wait-time-seconds 2 --query 'Messages[].Body' --output text`

export const snsFilterFanout: LessonContent = {
  id: 'sns-filter-fanout',
  n: '5.5',
  trackId: 'messaging',
  level: 'advanced',
  prereqs: ['sns-sqs'],
  estMinutes: 35,
  honesty: 'live',
  examTags: ['SAA:Resilient', 'DVA:Dev'],
  breakItCheck: 'breakit',
  editable: ['filter-billing.json', 'filter-shipping.json', 'filter-body.json'],
  title: 'SNS filter policies and selective fan-out',
  tagline: 'One topic, many consumers, and each one receives only the messages it asked for.',
  predict: [
    { id: 'p1', prompt: "A subscription has the filter policy {\"type\": [\"paid\"]}. A message is published with no message attributes at all. Does the subscriber get it?", options: ["Yes, no attributes means no filtering", "No: with an attribute-scope policy, a message missing the attribute does not match", "Only if RawMessageDelivery is on", "Only the first one"], answer: 1, explain: "Filter policies match message attributes by default. A message that lacks the attribute named in the policy does not match and is not delivered to that subscription." },
    { id: 'p2', prompt: "A subscription with no filter policy at all receives...", options: ["Nothing", "Every message published to the topic", "Only messages with attributes", "Only the first message per minute"], answer: 1, explain: "No filter policy means no filtering. That is how an audit queue sees the whole firehose while others see slices." },
    { id: 'p3', prompt: "You want to filter on a field inside the JSON message body, not on message attributes. What do you set?", options: ["Nothing, it is not possible", "FilterPolicyScope=MessageBody on the subscription", "A Lambda subscriber", "RawMessageDelivery=false"], answer: 1, explain: "FilterPolicyScope defaults to MessageAttributes. Setting it to MessageBody lets the policy match JSON fields in the message body." },
  ],
  concept: [
    "In lesson 5.1 every subscriber received every message. Real systems rarely want that: billing cares about paid orders, shipping about big shipped ones, a fraud check about refunds. Without filtering you would publish to many topics or write `if` statements in every consumer, and pay to deliver and discard. A **subscription filter policy** moves that decision into SNS: the policy is a JSON document on the *subscription*, and a message is delivered to that subscriber only if it matches. Non-matching messages are never delivered and cost the subscriber nothing.",
    "By default a policy matches **message attributes**, the typed key/value pairs sent alongside the body (`DataType` `String`, `Number` or `String.Array`). The policy is keyed by attribute name, and the values are match rules: exact strings (`\"type\": [\"paid\"]`), several alternatives (an OR), numeric comparisons (`\"total\": [{\"numeric\": [\">\", 100]}]`), `prefix`, `anything-but` and `exists`. Different keys are **ANDed** and values inside one key's list are **ORed**. Attribute matching only works if the publisher sends the attribute with the right `DataType`: a number sent as a string will not satisfy a numeric rule on real AWS.",
    "Set `FilterPolicyScope` to **`MessageBody`** and the same policy language matches fields inside a JSON message body instead (`{\"status\": [\"ok\"]}` against `{\"status\":\"ok\",\"id\":1}`). That removes the need for the publisher to duplicate fields into attributes, at the cost of SNS parsing every body.",
    "The failure mode from 5.1 still exists and is easy to hit while experimenting. If the subscribed queue's **access policy** does not allow SNS, the filter can match perfectly and the message is still withheld, silently. In this module the fixture gives you the topic and the queue policies (module independence), you write the subscriptions and filter policies from files, test routing and finish by reproducing the withheld delivery on a queue with no policy.",
  ],
  goal: "`billing` receives only paid orders, `shipping` only paid or shipped orders over 100, `audit` everything, and `bodyq` filters on the JSON body. The Check button proves the routing with live probe messages.",
  steps: [
    { id: 'look', title: 'See what the fixture built', body: "Topic `orders`, and five queues: `billing`, `shipping`, `audit` and `bodyq` already allow SNS to send (their queue policies are applied), and `quarantine` does not. Open the three `filter-*.json` files. `filter-billing.json` is correct. `filter-shipping.json` is missing a rule." },
    { id: 'subscribe', title: 'Subscribe billing, shipping and audit', body: "`RawMessageDelivery=true` puts the message body in the queue without the SNS envelope. None of them has a filter yet, so every subscription would get every message.", commands: [
      `aws sns subscribe --topic-arn ${T} --protocol sqs --notification-endpoint ${qa('billing')} --attributes RawMessageDelivery=true`,
      `aws sns subscribe --topic-arn ${T} --protocol sqs --notification-endpoint ${qa('shipping')} --attributes RawMessageDelivery=true`,
      `aws sns subscribe --topic-arn ${T} --protocol sqs --notification-endpoint ${qa('audit')} --attributes RawMessageDelivery=true`] },
    { id: 'arns', title: 'Look up the subscription ARNs', body: "You need them to attach policies. Each line is a queue and its subscription ARN.", commands: [`aws sns list-subscriptions-by-topic --topic-arn ${T} --query 'Subscriptions[].[Endpoint,SubscriptionArn]' --output text`] },
    { id: 'fix', title: 'Complete the shipping filter in the editor', body: "Shipping wants paid or shipped orders **over 100** only. Open `filter-shipping.json` and add a numeric rule so the file looks like the snippet, then Save.", code: { file: 'filter-shipping.json', text: `{\n  "type": ["paid", "shipped"],\n  "total": [{"numeric": [">", 100]}]\n}` } },
    { id: 'attach', title: 'Attach the filter policies', body: "`--attribute-value file://…` reads the policy from your file. Replace the placeholders with the matching subscription ARNs. `audit` stays unfiltered on purpose.", commands: [
      `aws sns set-subscription-attributes --subscription-arn <BILLING_SUB_ARN> --attribute-name FilterPolicy --attribute-value file://filter-billing.json`,
      `aws sns set-subscription-attributes --subscription-arn <SHIPPING_SUB_ARN> --attribute-name FilterPolicy --attribute-value file://filter-shipping.json`] },
    { id: 'publish', title: 'Publish three orders', body: "The attributes carry the routing data. `total` is a **Number**. Expected: billing gets only the paid one, shipping only the shipped 500, audit all three.", commands: [
      `aws sns publish --topic-arn ${T} --message 'order 1 paid small' --message-attributes '{"type":{"DataType":"String","StringValue":"paid"},"total":{"DataType":"Number","StringValue":"50"}}'`,
      `aws sns publish --topic-arn ${T} --message 'order 2 shipped big' --message-attributes '{"type":{"DataType":"String","StringValue":"shipped"},"total":{"DataType":"Number","StringValue":"500"}}'`,
      `aws sns publish --topic-arn ${T} --message 'order 3 refund tiny' --message-attributes '{"type":{"DataType":"String","StringValue":"refund"},"total":{"DataType":"Number","StringValue":"5"}}'`] },
    { id: 'read', title: 'Read each queue', body: "Compare with what you predicted. If shipping also shows order 1, your edit did not save or was not attached.", commands: [RECV('billing'), RECV('shipping'), RECV('audit')] },
    { id: 'body', title: 'Filter on the message body', body: "Subscribe `bodyq`, switch its policy scope to the body, attach `filter-body.json`, then publish two JSON bodies. Only the one with `\"status\":\"ok\"` arrives. Use the subscription ARN from step 3 (list again to find the new one).", commands: [
      `aws sns subscribe --topic-arn ${T} --protocol sqs --notification-endpoint ${qa('bodyq')} --attributes RawMessageDelivery=true`,
      `aws sns set-subscription-attributes --subscription-arn <BODYQ_SUB_ARN> --attribute-name FilterPolicyScope --attribute-value MessageBody`,
      `aws sns set-subscription-attributes --subscription-arn <BODYQ_SUB_ARN> --attribute-name FilterPolicy --attribute-value file://filter-body.json`,
      `aws sns publish --topic-arn ${T} --message '{"status":"ok","id":1}'`,
      `aws sns publish --topic-arn ${T} --message '{"status":"bad","id":2}'`,
      RECV('bodyq')] },
    { id: 'break', title: 'Break it: a subscription whose queue does not allow SNS', body: "`quarantine` has no access policy. Subscribe it, publish, and read it: a perfect subscription and a perfectly empty queue.", commands: [
      `aws sns subscribe --topic-arn ${T} --protocol sqs --notification-endpoint ${qa('quarantine')} --attributes RawMessageDelivery=true`,
      `aws sns publish --topic-arn ${T} --message 'order 4 paid again' --message-attributes '{"type":{"DataType":"String","StringValue":"paid"},"total":{"DataType":"Number","StringValue":"900"}}'`,
      RECV('quarantine')], breakIt: true },
  ],
  breakIt: {
    title: 'Subscribe a queue that does not allow SNS to send',
    command: `aws sns subscribe --topic-arn ${T} --protocol sqs --notification-endpoint ${qa('quarantine')} --attributes RawMessageDelivery=true`,
    explain: [
      "`publish` returns a MessageId, the subscription is Confirmed, and `quarantine` stays empty. The queue's access policy never allowed `sns.amazonaws.com` to `sqs:SendMessage`, so SNS's delivery attempt was refused and nothing told the publisher. The usual symptom in production is \"my filter must be wrong\" when the filter is fine.",
      "Debug in this order: queue policy (does it allow SNS, ideally with `aws:SourceArn` = the topic), then subscription confirmation, then filter policy, then raw-delivery format. Enable delivery status logging on the topic on real AWS to see the failure instead of guessing.",
    ],
  },
  realAws: {
    cost: [
      "SNS publishes cost about $0.50 per million requests, and delivery to SQS in the same Region has no per-delivery charge (us-east-1, from the SNS pricing page: check for current numbers). Filtering is included, and messages dropped by a filter policy are not delivered or charged to the subscriber.",
      "That is the economic argument for filter policies: the alternative of delivering everything and discarding in consumers pays queue requests and compute for messages nobody wants.",
    ],
    differences: [
      "Real SNS limits a filter policy to 150 combinations (the product of the number of values in each key) and 5 attribute names per policy, and requires a `Number` attribute for numeric rules. Check the limits page before relying on a complex policy.",
      "Delivery is asynchronous on AWS and normally takes tens of milliseconds, more under load. Retry policies apply to HTTP endpoints; for SQS delivery failures go to the optional subscription dead-letter queue (`RedrivePolicy` on the subscription).",
      "Message-body filtering, `anything-but`, `prefix` and `exists` operators are implemented here for the cases in this module.",
    ],
    asOf: '2026-11-13',
    sources: [{ label: 'Amazon SNS message filtering', url: 'https://docs.aws.amazon.com/sns/latest/dg/sns-message-filtering.html' }, { label: 'SNS subscription filter policy constraints', url: 'https://docs.aws.amazon.com/sns/latest/dg/subscription-filter-policy-constraints.html' }, { label: 'SNS pricing', url: 'https://aws.amazon.com/sns/pricing/' }],
  },
  fidelity: [{ service: 'SNS', pass: 239, total: 284 }, { service: 'SQS', pass: 299, total: 335 }],
  files: ['filter-billing.json', 'filter-shipping.json', 'filter-body.json'],
  probeNote: 'The routing check publishes three probe orders (paid 50, shipped 500, refund 5) and verifies exactly which queue receives which, when you press Run checks.',
  checks: [
    { id: 'subs', label: 'Topic `orders` has SQS subscriptions for billing, shipping and audit', hint: 'Run the three subscribe commands (step 2).' },
    { id: 'filters', label: 'Billing filters on type = paid and shipping has a numeric total rule', hint: 'Fix filter-shipping.json, then attach both policies (steps 4 and 5).' },
    { id: 'routing', label: 'Probe orders are routed correctly: billing paid only, shipping shipped over 100 only, audit all', hint: 'Press Run checks once the filters are attached.' },
    { id: 'body', label: '`bodyq` filters on the message body (FilterPolicyScope = MessageBody)', hint: 'Do step 8: subscribe, set the scope, attach filter-body.json.' },
    { id: 'breakit', label: 'You saw a subscribed queue stay empty because its policy blocks SNS', hint: 'Do step 9 and read `quarantine`.' },
  ],
}
