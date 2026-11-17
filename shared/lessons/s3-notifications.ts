import type { LessonContent } from '../types'

const Q = 'https://sqs.us-east-1.amazonaws.com/000000000000/thumb-jobs'

export const s3Notifications: LessonContent = {
  id: 's3-notifications',
  n: '2.4',
  trackId: 's3',
  level: 'intermediate',
  prereqs: ['s3-versioning'],
  estMinutes: 25,
  honesty: 'live',
  examTags: ['SAA:Resilient', 'DVA:Dev', 'DVA:Troubleshoot'],
  breakItCheck: 'breakit',
  editable: ['queue-policy.json', 'notification.json'],
  title: 'Event notifications: permissions and prefix/suffix filters',
  tagline: 'Send only uploads/*.jpg to a queue, and learn why S3 refuses to wire it up until the queue says yes.',
  predict: [
    { id: 'p1', prompt: "You put a notification configuration on a bucket that names an SQS queue with no access policy. What happens?", options: ["The call succeeds and events are silently dropped later", "The call fails immediately with InvalidArgument: Unable to validate the destination", "S3 edits the queue policy for you", "The call succeeds and S3 retries delivery for 24 hours"], answer: 1, explain: "S3 validates the destination when you save the configuration, by sending a test event. Without a queue policy allowing s3.amazonaws.com the call fails right away, which is why the failure shows up at configuration time, not upload time." },
    { id: 'p2', prompt: "A rule filters on prefix `uploads/` and suffix `.jpg`. Which uploads fire it?", options: ["`uploads/cat.jpg` and `uploads/DOG.JPG`", "`uploads/cat.jpg` only (of those two)", "`cat.jpg` and `uploads/cat.jpg`", "`uploads/readme.txt`"], answer: 1, explain: "Filters are case-sensitive string matches on the key, prefix and suffix only, with no wildcards. `DOG.JPG` has a different suffix and `cat.jpg` has no prefix, so only `uploads/cat.jpg` matches." },
    { id: 'p3', prompt: "Which of these can S3 event notifications target directly?", options: ["SQS standard queues, SNS standard topics, Lambda functions and EventBridge", "SQS FIFO queues and SNS FIFO topics", "Kinesis Data Streams and Step Functions", "Only Lambda"], answer: 0, explain: "The destinations are SQS standard queues, SNS standard topics, Lambda and EventBridge. FIFO queues and FIFO topics are not supported as direct destinations, and anything else (Kinesis, Step Functions) needs EventBridge or a hop through one of the four." },
  ],
  concept: [
    "S3 event notifications push \"something happened to a key\" to a **destination**: an SQS standard queue, an SNS standard topic, a Lambda function, or Amazon EventBridge (FIFO queues and FIFO topics are not supported, a favourite exam distractor). Events are `s3:ObjectCreated:*` (Put, Post, Copy, CompleteMultipartUpload), `s3:ObjectRemoved:*` (Delete, DeleteMarkerCreated), restore, replication, lifecycle expiration, Intelligent-Tiering and tagging events. Delivery is **at least once** and usually takes seconds, with **no ordering guarantee** across keys. If two writes to the same key can race, compare the `sequencer` field in each record (a hex string that grows with time per key, so you compare after padding). Object keys in the event are **URL-encoded** (spaces become `+`), a classic Lambda bug.",
    "**Permission is the heart of this topic and it lives on the destination, not on S3.** The queue or topic needs a resource policy that lets the principal `s3.amazonaws.com` perform `sqs:SendMessage` (or `sns:Publish`), and a Lambda function needs `lambda add-permission` for `s3.amazonaws.com`. Scope every one with `aws:SourceArn` (the bucket) and `aws:SourceAccount`, or any bucket in any account could write to your queue (the confused deputy problem). If the queue uses SSE-KMS, the key policy must also allow S3. S3 checks all of this when you save the configuration by sending an `s3:TestEvent`, so a missing or wrong policy fails the `put-bucket-notification-configuration` call, not the later uploads. The emulator enforces this too, including a policy naming the wrong bucket, and you will see the TestEvent land in your queue.",
    "Filters are **prefix and suffix only**, case-sensitive, and both may be combined in one rule. Rules in the same bucket with overlapping prefix/suffix for the same event type are rejected, because S3 refuses ambiguous routing. `put-bucket-notification-configuration` **replaces the whole configuration**: forgetting to include the existing queue, topic and Lambda entries deletes them, a frequent real-world incident. When you need more than S3 gives you (filtering on object size or metadata, many targets for one event, archive and replay, targets such as Step Functions or Kinesis), turn on **EventBridge** for the bucket instead: it receives all events and you filter with rules. For retry and back-pressure, S3 to SQS to Lambda beats S3 straight to Lambda, since the direct path is an asynchronous invoke with only two automatic retries.",
    "In this module the fixture gives you bucket `photo-intake` and queue `thumb-jobs`. You first try to wire them with no policy (the break-it), then fix `queue-policy.json` (it names the wrong bucket) and apply it, add a prefix/suffix filter to `notification.json`, and upload four test keys. Only one of them should produce a record.",
  ],
  goal: "Queue `thumb-jobs` allows S3 from `photo-intake`, the bucket sends `uploads/*.jpg` creations to it and nothing else, and you saw that only `uploads/cat.jpg` arrived.",
  steps: [
    { id: 'break', title: 'Break it: wire it up with no policy', body: "Open `notification.json`: a queue configuration for `s3:ObjectCreated:*`, with no filter yet. Try to apply it straight away. The queue has no access policy, so S3 cannot deliver its test event and refuses the whole configuration.", commands: ['aws s3api put-bucket-notification-configuration --bucket photo-intake --notification-configuration file://notification.json'], breakIt: true },
    { id: 'policy', title: 'Fix the queue policy and apply it', body: "`queue-policy.json` already trusts `s3.amazonaws.com` to `sqs:SendMessage`, but its `aws:SourceArn` names `snap-intake`, a different bucket. Edit it so the ARN is `arn:aws:s3:::photo-intake` and Save. Then apply it and read it back.", commands: [`aws sqs set-queue-attributes --queue-url ${Q} --attributes file://queue-policy.json`, `aws sqs get-queue-attributes --queue-url ${Q} --attribute-names Policy`] },
    { id: 'filter', title: 'Add the prefix and suffix filter, then wire it', body: "In `notification.json` add a `Filter` with two rules to the queue configuration, then Save and apply. Read the stored configuration back. Applying also sends an `s3:TestEvent` to the queue.", code: { file: 'notification.json', text: '"Filter": { "Key": { "FilterRules": [\n  { "Name": "prefix", "Value": "uploads/" },\n  { "Name": "suffix", "Value": ".jpg" }\n] } }' }, commands: ['aws s3api put-bucket-notification-configuration --bucket photo-intake --notification-configuration file://notification.json', 'aws s3api get-bucket-notification-configuration --bucket photo-intake'] },
    { id: 'upload', title: 'Upload four keys', body: "One matches both parts of the filter. The others each miss one way: wrong suffix, no prefix, wrong case.", commands: ['aws s3api put-object --bucket photo-intake --key uploads/cat.jpg --body sample.txt', 'aws s3api put-object --bucket photo-intake --key uploads/readme.txt --body sample.txt', 'aws s3api put-object --bucket photo-intake --key cat.jpg --body sample.txt', 'aws s3api put-object --bucket photo-intake --key uploads/DOG.JPG --body sample.txt'] },
    { id: 'receive', title: 'Read the queue', body: "Long-poll the queue and look at the bodies. You should find the S3 test event and **one** record, for `uploads/cat.jpg`. Notice how the key appears in `s3.object.key` inside the JSON string.", commands: [`aws sqs receive-message --queue-url ${Q} --max-number-of-messages 10 --wait-time-seconds 3 --query 'Messages[].Body' --output text`] },
  ],
  breakIt: {
    title: 'Configure a notification before the queue allows S3',
    command: 'aws s3api put-bucket-notification-configuration --bucket photo-intake --notification-configuration file://notification.json',
    explain: [
      "`InvalidArgument: Unable to validate the following destination configurations`. S3 tried to send an `s3:TestEvent` to the queue as `s3.amazonaws.com`, the queue's resource policy said no, and S3 refused the configuration. Nothing was saved. Fixing it means changing the queue, not the bucket.",
      "Two follow-ups worth knowing: a policy that exists but names another bucket (the starter file here) fails the same way, and on AWS a missing `aws:SourceAccount` or `aws:SourceArn` condition does not fail but leaves the queue open to any bucket in any account, which is the more dangerous mistake.",
    ],
  },
  realAws: {
    cost: [
      "S3 event notifications themselves are free. You pay for the destination: SQS requests (about $0.40 per million after the free tier, us-east-1, check the pricing page), Lambda invocations, or SNS publishes. EventBridge delivery of S3 events is charged per custom-bus-style event, small but not zero.",
      "Because every matching upload is a message, an overbroad filter (`s3:ObjectCreated:*` on the whole bucket) can produce a large queue bill and a Lambda stampede. Filter early.",
    ],
    differences: [
      "Real S3 typically delivers within seconds but states no latency guarantee, and may occasionally deliver duplicates. The emulator delivers almost at once and once.",
      "The emulator validates the queue policy for this destination, including the source bucket, as real S3 does. It also sends the `s3:TestEvent`, which you will find in the queue.",
      "The emulator's `get-bucket-notification-configuration` echoes your filter with capitalised names (`Prefix`, `Suffix`), which real S3 does too. Matching is case-sensitive on the key, verified with `DOG.JPG`.",
    ],
    asOf: '2026-11-13',
    sources: [{ label: 'Amazon S3 Event Notifications', url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/EventNotifications.html' }, { label: 'Granting permission to publish event notification messages to a destination', url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/grant-destinations-permissions-to-s3.html' }, { label: 'Event message structure', url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-content-structure.html' }],
  },
  fidelity: [{ service: 'S3', pass: 1025, total: 1226 }, { service: 'SQS', pass: 299, total: 335 }],
  files: ['queue-policy.json', 'notification.json', 'sample.txt'],
  probeNote: 'The delivery check uploads three probe objects (a match, a wrong suffix, a missing prefix) and waits up to 10 s to see which reach the queue, when you press Check.',
  checks: [
    { id: 'breakit', label: 'You saw InvalidArgument when no queue policy allowed S3', hint: 'Run the first command before changing anything.' },
    { id: 'policy', label: 'Queue `thumb-jobs` lets s3.amazonaws.com send from `photo-intake`', hint: 'Fix the SourceArn in queue-policy.json, Save, then run set-queue-attributes.' },
    { id: 'config', label: 'The bucket sends ObjectCreated events for prefix uploads/ and suffix .jpg to the queue', hint: 'Add the Filter block to notification.json, Save, apply it.' },
    { id: 'saw', label: 'You read the queue and saw uploads/cat.jpg but none of the three non-matching keys', hint: 'Upload the four keys, then run the receive command.' },
    { id: 'delivery', label: 'A probe upload that matches arrives and the two that do not never do', hint: 'Press Check after wiring the filter.' },
  ],
}
