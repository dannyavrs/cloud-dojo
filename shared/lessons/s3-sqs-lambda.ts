import type { LessonContent } from '../types'

export const s3SqsLambda: LessonContent = {
  id: 's3-sqs-lambda',
  n: '9.1',
  trackId: 'eventbridge',
  level: 'intermediate',
  prereqs: [],
  estMinutes: 25,
  honesty: 'live',
  examTags: ["SAA:Resilient", "DVA:Dev"],
  predict: [{"id": "p1", "prompt": "You configure S3 event notifications to an SQS queue whose policy does not allow S3. When does it fail?", "options": ["Never, S3 retries later", "Immediately, when you save the notification configuration", "Only when the first object is uploaded", "Only after 24 hours"], "answer": 1, "explain": "S3 validates the destination when you save the configuration and rejects it with InvalidArgument if it cannot send to the queue."}],

  title: 'Event wiring: S3 → SQS → Lambda',
  tagline: 'Upload a photo and a worker function runs on its own.',
  concept: [
    'Event-driven AWS means nothing runs, and nothing bills, until something happens. Here an **S3 event notification** drops a message on an SQS queue whenever an object is created, and a Lambda **event source mapping** polls that queue and invokes your worker with a batch of messages. The queue in the middle absorbs bursts and retries failures.',
    'Three permission pairs make it work: the **queue policy** lets S3 send to the queue; the **function role** lets Lambda read from the queue; and the **notification** and **mapping** tell each side where to look.',
    'This lesson starts with the bucket `snap-photos`, the queue `photo-jobs`, the role `lambda-exec` and a deployed function `photo-worker` (it logs each record it gets). You wire them together.',
  ],
  goal: 'Uploading to `snap-photos` makes `photo-worker` log the new object.',
  steps: [
    { id: 'break1', title: 'Break it (1/2): notification before the queue allows S3', body: '`notification.json` points object-created events at `photo-jobs`. S3 checks that it may deliver and refuses.', commands: ['aws s3api put-bucket-notification-configuration --bucket snap-photos --notification-configuration file://notification.json'], breakIt: true },
    { id: 'policy', title: 'Let S3 send to the queue', body: '`queue-policy.json` allows `s3.amazonaws.com` to `sqs:SendMessage`, only for this bucket.', commands: ['aws sqs set-queue-attributes --queue-url https://sqs.us-east-1.amazonaws.com/000000000000/photo-jobs --attributes file://queue-policy.json'] },
    { id: 'notify', title: 'Try the notification again', body: 'This time it is accepted. S3 also sends an `s3:TestEvent` message to the queue, as real S3 does.', commands: ['aws s3api put-bucket-notification-configuration --bucket snap-photos --notification-configuration file://notification.json'] },
    { id: 'break2', title: 'Break it (2/2): map the queue before the role may read it', body: 'The function\'s role cannot call `ReceiveMessage` on the queue yet.', commands: ['aws lambda create-event-source-mapping --function-name photo-worker --event-source-arn arn:aws:sqs:us-east-1:000000000000:photo-jobs --batch-size 1'], breakIt: true },
    { id: 'role', title: 'Attach the AWS managed SQS execution policy', body: 'It grants Receive/Delete/GetQueueAttributes plus logging.', commands: ['aws iam attach-role-policy --role-name lambda-exec --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaSQSQueueExecutionRole'] },
    { id: 'map', title: 'Create the mapping', body: 'Give it a few seconds to start polling.', commands: ['aws lambda create-event-source-mapping --function-name photo-worker --event-source-arn arn:aws:sqs:us-east-1:000000000000:photo-jobs --batch-size 1'] },
    { id: 'upload', title: 'Upload a photo', body: '`photo.txt` stands in for a picture.', commands: ['aws s3 cp photo.txt s3://snap-photos/uploads/photo.txt'] },
    { id: 'logs', title: 'Watch the worker', body: 'Wait a few seconds, then read the logs. You should see `photo-worker got 1 record(s)` and the S3 event with your key.', commands: [`aws logs filter-log-events --log-group-name /aws/lambda/photo-worker --query 'events[].message' --output text`] },
  ],
  breakIt: {
    title: 'Wire the pieces in the wrong order',
    command: 'aws s3api put-bucket-notification-configuration --bucket snap-photos --notification-configuration file://notification.json',
    explain: [
      '`InvalidArgument: Unable to validate the following destination configurations`: S3 tests delivery when you save the notification, found that the queue policy does not allow S3, and refused to save. This validation is real S3 behavior and it saves you from silent failures.',
      'The second error, on `create-event-source-mapping`, is Lambda saying the execution role lacks `sqs:ReceiveMessage`. Two different services, two different permission checks: the fix is always "who is calling, and what do they need?"',
    ],
  },
  realAws: {
    cost: [
      'Nothing here bills until events arrive. When they do: S3 requests, SQS requests (Lambda polls the queue, and those polls count) and Lambda invocations all add up, each at roughly cents per million (approximate; see the linked pricing pages).',
      'Lambda pricing: $0.20 per million requests and $0.0000166667 per GB-second (x86) after the monthly free tier of 1M requests and 400,000 GB-seconds.',
    ],
    differences: [
      'Real S3 notifications can also target Lambda directly or EventBridge, with no queue. The queue adds buffering and retries.',
      'Real queues should have a dead-letter queue so a poison message does not retry forever; omitted here to stay small.',
      'Delivery latency is usually sub-second on real AWS; here polling can take a few seconds.',
    ],
    asOf: '2026-11-13',
    sources: [{ label: 'S3 event notifications', url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/NotificationHowTo.html' }, { label: 'Lambda pricing', url: 'https://aws.amazon.com/lambda/pricing/' }],
  },
  fidelity: [{ service: 'S3', pass: 1025, total: 1226 }, { service: 'SQS', pass: 299, total: 335 }, { service: 'Lambda', pass: 395, total: 788 }],
  files: ['notification.json', 'queue-policy.json', 'photo.txt'],
  probeNote: 'The end-to-end check uploads a probe object and waits up to 15 s for the worker to log it, when you press Check.',
  checks: [
    { id: 'policy', label: 'Queue `photo-jobs` allows S3 to send', hint: 'Apply queue-policy.json.' },
    { id: 'notify', label: 'The bucket notifies `photo-jobs` on object creation', hint: 'Apply notification.json after the queue policy.' },
    { id: 'esm', label: 'Event source mapping to `photo-worker` is Enabled', hint: 'Attach the SQS execution policy, then create the mapping.' },
    { id: 'e2e', label: 'A probe upload reaches the worker\'s logs', hint: 'Press Check; give the mapping a few seconds to start polling.' },
  ],
}
