import type { LessonContent } from '../types'

export const ebScheduler: LessonContent = {
  id: 'eb-scheduler',
  n: '9.4',
  trackId: 'eventbridge',
  level: 'intermediate',
  prereqs: ['eb-patterns'],
  estMinutes: 25,
  honesty: 'live',
  honestyNote: 'One-off `at()` and recurring `rate()` schedules really fire on the emulator, the scheduler role trust is validated at create time, and the role permissions are enforced when the schedule fires. Verified on the emulator while building this module.',
  examTags: ['SAA:Resilient', 'DVA:Dev'],
  breakItCheck: 'breakit',
  editable: ['schedule.json'],
  title: 'EventBridge Scheduler: one-off and recurring jobs',
  tagline: 'Drop a message in a queue at a chosen time, without a server or a cron box.',
  predict: [
    { id: 'p1', prompt: 'You create a schedule with an execution role that is trusted by `events.amazonaws.com` (not `scheduler.amazonaws.com`). When do you find out?', options: ['At create time: Scheduler checks that it can assume the role and returns a ValidationException', 'When the schedule first fires, as a failed invocation', 'Never, EventBridge and Scheduler share the same service principal', 'Only in CloudTrail the next day'], answer: 0, explain: 'Scheduler validates that its own principal (`scheduler.amazonaws.com`) can assume the role when you create or update the schedule. That is different from EventBridge rules, which accept a bad role and fail later. Scheduler and EventBridge rules are different services with different trust principals.' },
    { id: 'p2', prompt: 'A one-off schedule `at(2026-11-15T12:00:00)` is created without any time zone setting. In which time zone is the time read?', options: ['The caller\'s local time zone', 'The Region\'s time zone', 'UTC', 'The target\'s time zone'], answer: 2, explain: 'Without a time zone, Scheduler uses UTC. Set `ScheduleExpressionTimezone` (for example `America/New_York`) to have cron and at expressions follow local time, including daylight saving changes.' },
    { id: 'p3', prompt: 'You need a job every 5 minutes, but it should start at a random moment inside each period so a thousand schedules do not hit the target at once. Which Scheduler setting spreads the load?', options: ['A longer rate expression', 'A flexible time window of 5 minutes', 'A dead-letter queue', 'A retry policy'], answer: 1, explain: 'A flexible time window lets Scheduler invoke the target at a random moment inside the window instead of exactly on the boundary. `Mode=OFF` means invoke exactly at the time.' },
  ],
  concept: [
    '**EventBridge Scheduler** is a separate, newer service from EventBridge rules. A schedule says "at this time or on this recurrence, call this target": it is the managed replacement for cron servers and for rules with a `schedule-expression`. Three expression types exist: **`at(yyyy-mm-ddThh:mm:ss)`** for a one-off, **`rate(5 minutes)`** and **`cron(...)`** for recurring work. Times are UTC unless you set `ScheduleExpressionTimezone`, and a one-off can delete itself afterwards with `ActionAfterCompletion=DELETE`.',
    'A schedule has a **target** (here an SQS queue; Scheduler offers templated targets such as Lambda, SQS, SNS, Step Functions and ECS, plus "universal targets" that call most AWS APIs) and an **execution role** that Scheduler assumes when it fires. That role needs a trust policy for **`scheduler.amazonaws.com`** and a permission policy for the call, here `sqs:SendMessage` on the queue. Scheduler checks the trust at create time. The permissions are only exercised when the schedule fires, so a missing `sqs:SendMessage` produces no message and no error at creation.',
    'Know the differences from rules for the exam. Rules with `schedule-expression` run on the default bus only, have minute granularity and give no one-off scheduling. Scheduler offers one-off schedules, **time zones**, **flexible time windows** (invoke at a random point inside the window to avoid thundering herds), a **retry policy** (maximum event age and retry attempts) and a **dead-letter queue** for failed invocations, and it scales to millions of schedules. Schedules live in a **schedule group** (`default` unless you create others) that you can tag and manage together.',
    'In this module the fixture creates the queue `jobs` and two roles: `sched-exec` (trusted by `scheduler.amazonaws.com`, allowed to send to `jobs`) and `events-exec` (trusted by `events.amazonaws.com`). First you try the wrong role and see the validation error. Then you create a one-off schedule that sends the text `scheduled-hello` shortly after, and read it from the queue. Finally you create a recurring `rate(1 minute)` schedule, inspect it, and delete it so it does not keep firing.',
  ],
  goal: 'A one-off schedule delivers `scheduled-hello` to the queue `jobs` at the time you chose, using a role Scheduler can assume, and you have seen Scheduler refuse a role it cannot assume.',
  steps: [
    { id: 'look', title: 'Inspect the roles and the queue', body: 'Both roles exist already. Read who can assume `sched-exec`, and confirm the queue is empty.', commands: ['aws iam get-role --role-name sched-exec --query Role.AssumeRolePolicyDocument.Statement[0].Principal.Service', 'aws sqs get-queue-attributes --queue-url https://sqs.us-east-1.amazonaws.com/000000000000/jobs --attribute-names ApproximateNumberOfMessages'] },
    { id: 'break', title: 'Break it: a role Scheduler cannot assume', body: '`schedule-wrong.json` points at `events-exec`, which trusts `events.amazonaws.com`. Unlike an EventBridge rule target, Scheduler checks this immediately and refuses to create the schedule.', commands: ['aws scheduler create-schedule --cli-input-json file://schedule-wrong.json'], breakIt: true },
    { id: 'time', title: 'Check the time in schedule.json', body: '`schedule.json` was written when you opened this module, with `at(...)` set 90 seconds later (UTC). If that moment has already passed, open the file in the editor and set it to about 20 seconds from now in UTC: the format is `yyyy-mm-ddThh:mm:ss` with no time zone suffix. **A time in the past is accepted and never fires** on the emulator, which is easy to miss.' },
    { id: 'create', title: 'Create the one-off schedule', body: 'The target is the queue, the role is `sched-exec`, the input is the message body `scheduled-hello`. `FlexibleTimeWindow` is off, so it fires exactly at the time.', commands: ['aws scheduler create-schedule --cli-input-json file://schedule.json'] },
    { id: 'get', title: 'Read the schedule back', body: 'The state is `ENABLED`. Note the expression, the target and the role.', commands: ['aws scheduler get-schedule --name hello-once'] },
    { id: 'receive', title: 'Receive the message', body: 'Wait until the time has passed, then read the queue. You should get `scheduled-hello`. With the default time that can take up to a couple of minutes.', commands: ["aws sqs receive-message --queue-url https://sqs.us-east-1.amazonaws.com/000000000000/jobs --max-number-of-messages 10 --wait-time-seconds 5 --query 'Messages[].Body'"] },
    { id: 'rate', title: 'Create a recurring schedule, then delete it', body: '`rate(1 minute)` fires repeatedly. You do not need to wait for a tick: see it listed, then delete it so it stops. In real life you would also set a `RetryPolicy` and a dead-letter queue on the target.', commands: ['aws scheduler create-schedule --cli-input-json file://schedule-rate.json', 'aws scheduler list-schedules --query Schedules[].[Name,State] --output text', 'aws scheduler delete-schedule --name hello-every-minute'] },
  ],
  breakIt: {
    title: 'A role Scheduler cannot assume',
    command: 'aws scheduler create-schedule --cli-input-json file://schedule-wrong.json',
    explain: [
      '`ValidationException: The execution role you provide must allow AWS EventBridge Scheduler to assume the role.` The role exists and even has the right permissions, but its trust policy names `events.amazonaws.com`. Scheduler is its own service, so its role must trust `scheduler.amazonaws.com`.',
      'Two lessons. The fix is a trust policy change, not a permissions change. And Scheduler\'s early validation is friendlier than EventBridge rule targets (module 9.3), where a role EventBridge cannot assume is accepted and fails silently when the event arrives.',
    ],
  },
  realAws: {
    cost: [
      'Scheduler is billed per invocation: about $1.00 per million, with the first 14 million invocations per month free (approximate; check the pricing page). Target costs, here SQS requests, come on top. As of 2026-11-15.',
      'A `rate(1 minute)` schedule is about 43,200 invocations a month, well inside the free tier, but a thousand of them are not.',
    ],
    differences: [
      'On real AWS you would also configure a `RetryPolicy` (maximum event age and retry attempts) and a `DeadLetterConfig` on the target. The emulator was not tested for retries or dead-lettering.',
      'The emulator accepts an `at()` time in the past and silently never fires. Real Scheduler may behave differently (check the API reference); either way, pick a future time.',
      'Delivery on the emulator can lag the scheduled second by a few seconds.',
      'Real AWS also supports schedule groups with tags, flexible windows of up to 24 hours and universal targets that call almost any AWS API (for example `ec2:StopInstances`).',
    ],
    asOf: '2026-11-15',
    sources: [
      { label: 'What is Amazon EventBridge Scheduler?', url: 'https://docs.aws.amazon.com/scheduler/latest/UserGuide/what-is-scheduler.html' },
      { label: 'Setting up an execution role for Scheduler', url: 'https://docs.aws.amazon.com/scheduler/latest/UserGuide/setting-up.html#setting-up-execution-role' },
      { label: 'EventBridge Scheduler pricing', url: 'https://aws.amazon.com/eventbridge/pricing/' },
    ],
  },
  fidelity: [{ service: 'EventBridge Scheduler', pass: 129, total: 189 }],
  files: ['schedule.json', 'schedule-wrong.json', 'schedule-rate.json'],
  probeNote: 'These checks read the state of the schedule, the queue and your command history. Pressing Check sends nothing new.',
  checks: [
    { id: 'breakit', label: 'You saw Scheduler refuse a role it cannot assume', hint: 'Run create-schedule with schedule-wrong.json.' },
    { id: 'schedule', label: 'The schedule `hello-once` exists with an `at()` expression and the `sched-exec` role', hint: 'create-schedule with schedule.json (the time must be in the future).' },
    { id: 'delivered', label: 'The message `scheduled-hello` reached the queue', hint: 'Wait for the time in schedule.json, then receive-message on `jobs`.' },
    { id: 'rate', label: 'You created a recurring `rate()` schedule', hint: 'create-schedule with schedule-rate.json.' },
    { id: 'cleanup', label: 'The recurring schedule was deleted', hint: 'delete-schedule --name hello-every-minute.' },
  ],
}
