import type { QuizQuestion } from './types'

/** Exam-style scenario questions for the EventBridge track (6-10), graded locally. */
export const EB_EXAM: QuizQuestion[] = [
  {
    id: 'e1', tag: 'DVA:Troubleshoot',
    prompt: 'A rule on a custom bus uses the pattern below. The producer publishes events with `"amount": "1500"` (a JSON string). `put-events` returns `FailedEntryCount` 0, but the target never receives anything and there are no errors anywhere. What is the most likely cause?',
    code: '{"detail":{"amount":[{"numeric":[">",1000]}]}}',
    options: ['The rule is in the DISABLED state', 'Numeric matching only applies to JSON numbers, so the string "1500" never matches', 'The event is larger than 256 KB and was silently truncated', 'Custom buses do not support numeric operators'],
    answer: 1,
    explain: 'Pattern matching is type-strict. `{"numeric": ...}` matches numbers, and a string value never matches it. Nothing is rejected at publish time, the event just matches no rule. `test-event-pattern` with a sample event finds this in seconds.',
  },
  {
    id: 'e2', tag: 'SAA:Resilient',
    prompt: 'An order service publishes order events. Billing, shipping and analytics teams each want a different subset of orders, new consumers are added every month without redeploying the producer, and a newly added consumer must be able to process the last 7 days of orders. Which design fits?',
    options: ['One standard SQS queue that all consumers poll', 'A Kinesis data stream with one shard per consumer', 'An EventBridge custom bus: one rule per consumer with a content-based pattern, plus an archive on the bus to replay history into a new consumer', 'A Lambda function that fans out to each consumer\'s API'],
    answer: 2,
    explain: 'A bus decouples the producer from consumers, rules filter on event content per consumer, and archive plus replay reprocesses past events for a new rule. A shared queue gives each message to only one consumer and has no filtering, and a fan-out Lambda couples the producer to every consumer.',
  },
  {
    id: 'e3', tag: 'DVA:Sec',
    prompt: 'A CloudFormation template creates an EventBridge rule whose target is a Lambda function. The rule matches test events, the stack deploys without errors, but the function is never invoked. Creating the same rule in the console works. What is missing?',
    options: ['An IAM role on the target that trusts lambda.amazonaws.com', 'A dead-letter queue on the rule', 'The function must be in a VPC to be invoked by EventBridge', 'An `AWS::Lambda::Permission` that lets `events.amazonaws.com` invoke the function, with the rule ARN as the source'],
    answer: 3,
    explain: 'Lambda targets are authorised by the function\'s resource-based policy. The console adds that permission automatically, CloudFormation does not. Scoping the permission with the rule ARN as `SourceArn` prevents other rules or accounts from invoking through the same service principal.',
  },
  {
    id: 'e4', tag: 'SAA:Secure',
    prompt: 'A rule\'s target is a Step Functions state machine, with a `RoleArn` whose trust policy names `states.amazonaws.com` and whose policy allows `states:StartExecution`. `put-targets` succeeds, but no executions start. What fixes it?',
    options: ['Add `lambda:InvokeFunction` to the role', 'Make the state machine an EXPRESS workflow', 'Change the trust policy to allow `events.amazonaws.com` to assume the role', 'Attach the role to the state machine as its execution role'],
    answer: 2,
    explain: 'EventBridge assumes the target role to call `StartExecution`, so the role must trust `events.amazonaws.com`. `states.amazonaws.com` is the principal for the state machine\'s own execution role, a different role. The failure is silent: look at the rule\'s `FailedInvocations` metric.',
  },
  {
    id: 'e5', tag: 'SAA:Resilient',
    prompt: 'A reminder feature must send one notification per customer at a customer-chosen local time, including daylight-saving changes, for millions of customers, with the least operations. Which service?',
    options: ['EventBridge Scheduler with one schedule per customer and a time zone on each schedule', 'A single EventBridge rule with a cron expression', 'A cron job on an EC2 Auto Scaling group', 'An SQS queue with a visibility timeout equal to the delay'],
    answer: 0,
    explain: 'Scheduler supports one-off `at()` and recurring schedules at very large scale, with a time zone per schedule (daylight saving handled) and flexible time windows. Rule schedules run in UTC only, and the other options mean running servers or misusing queue timers (SQS delay is capped at 15 minutes).',
  },
  {
    id: 'e6', tag: 'DVA:Dev',
    prompt: '`aws scheduler create-schedule` fails with a ValidationException: "The execution role you provide must allow AWS EventBridge Scheduler to assume the role." The role already has `sqs:SendMessage` on the target queue. What do you change?',
    options: ['The role\'s permission policy: add `scheduler:*`', 'The role\'s trust policy: allow `scheduler.amazonaws.com` to assume it', 'The queue policy: allow `scheduler.amazonaws.com`', 'The schedule\'s flexible time window'],
    answer: 1,
    explain: 'This error is about trust, not permissions. Scheduler assumes the execution role, so the role\'s trust policy must name `scheduler.amazonaws.com`. A role trusted by `events.amazonaws.com` (used for rule targets) does not work for Scheduler.',
  },
  {
    id: 'e7', tag: 'SAA:Resilient',
    prompt: 'A bug in the shipping consumer dropped two hours of events last night. The fix is deployed. The bus has an archive. How do you reprocess only those events for the shipping consumer, without re-triggering billing and analytics?',
    options: ['Ask the producer team to resend the orders from their database', 'Start a replay for the window with no filter and let the other consumers ignore duplicates', 'Increase the archive retention and wait for redelivery', 'Start a replay for that two-hour window with `FilterArns` set to the shipping rule'],
    answer: 3,
    explain: 'A replay re-publishes archived events to the bus, and by default every matching rule fires again. `Destination.FilterArns` restricts the replay to named rules. An unfiltered replay would also re-trigger billing and analytics, so they would need to be idempotent.',
  },
  {
    id: 'e8', tag: 'DVA:Troubleshoot',
    prompt: '`test-event-pattern` returns true for a sample event, `put-events` returns `FailedEntryCount` 0, but the SQS queue that is the rule\'s only target stays empty. What do you check first?',
    options: ['That the queue access policy allows `events.amazonaws.com` to send, ideally scoped to the rule ARN', 'That the queue is a FIFO queue', 'That the producer uses the default bus', 'That the event contains a `replay-name`'],
    answer: 0,
    explain: 'SQS targets use the queue\'s resource policy. `put-targets` accepts the target without checking it, so a missing policy only shows up as delivery failures (the rule\'s `FailedInvocations` metric). The pattern test passing means matching is fine.',
  },
  {
    id: 'e9', tag: 'SAA:Resilient',
    prompt: 'A rule\'s Lambda target is throttled for a few hours during a traffic spike. With default settings, what does EventBridge do with the matched events?',
    options: ['Drops them immediately and reports an error to the producer', 'Stores them forever until you call replay', 'Retries with exponential backoff for up to 24 hours (up to 185 attempts), then drops them unless a dead-letter queue is configured', 'Switches the rule to the DISABLED state'],
    answer: 2,
    explain: 'The default retry policy retries failed target invocations with backoff for up to 24 hours or 185 attempts. After that the event is dropped unless the target has a dead-letter queue. The producer never sees the failure, because publishing and delivery are decoupled.',
  },
]
