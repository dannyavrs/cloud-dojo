import type { LessonContent } from '../types'

export const SLOW_HANDLER = `export const handler = async () => {
  await new Promise((r) => setTimeout(r, 4000)); // pretend to do 4 seconds of work
  return { done: true };
};`

const INV = (extra = '') => `aws lambda invoke --function-name slow --cli-binary-format raw-in-base64-out --payload '{}' ${extra}out.json`

export const lambdaConcurrency: LessonContent = {
  id: 'lambda-concurrency',
  n: '4.5',
  trackId: 'lambda',
  level: 'advanced',
  prereqs: ['lambda-config-errors'],
  estMinutes: 35,
  honesty: 'live',
  honestyNote: 'Reserved concurrency and the TooManyRequestsException throttle are enforced for real. Provisioned concurrency is COSMETIC here: the configuration is accepted and stays IN_PROGRESS, but nothing is pre-warmed and there is no performance effect. Cold starts cannot be shown at all (every invoke gets a fresh sandbox).',
  examTags: ['SAA:Resilient', 'SAA:Performant', 'DVA:Troubleshoot'],
  breakItCheck: 'breakit',
  title: 'Concurrency: reserved, provisioned and throttling',
  tagline: 'Cap a function so it cannot starve its neighbours, then see what a throttle looks like to the caller.',
  predict: [
    { id: 'p1', prompt: 'A function has reserved concurrency of 0. What happens when you invoke it?', options: ['It runs, but slowly', 'Every invoke is throttled (TooManyRequestsException, HTTP 429)', 'It runs once and is then disabled', 'It is deleted'], answer: 1, explain: 'Setting reserved concurrency to 0 is the standard emergency stop: no execution environments may run, so every synchronous invoke fails with TooManyRequestsException (429). Asynchronous invokes are retried for up to 6 hours and then dropped.' },
    { id: 'p2', prompt: 'The account concurrency limit is 1,000 and you reserve 400 for function A. How much is left for all functions without a reservation?', options: ['1,000', '600, minus a mandatory unreserved floor of 100 on real AWS', '400', '600, and A can still borrow from it'], answer: 1, explain: 'Reserved concurrency is carved out of the account pool and is both a guarantee and a cap for that function. Lambda always keeps at least 100 unreserved concurrency for the other functions, so you can reserve at most limit - 100 in total.' },
    { id: 'p3', prompt: 'You configure provisioned concurrency on an alias. What does it buy you?', options: ['A higher account limit', 'Pre-initialised execution environments, so invokes avoid cold starts (and you pay for the idle capacity)', 'A longer timeout', 'Free invocations'], answer: 1, explain: 'Provisioned concurrency keeps environments initialised and is billed whether or not they are used. It applies to a version or alias, never to $LATEST. It does not raise any limit. (In this emulator it is accepted but has no effect.)' },
  ],
  concept: [
    "**Concurrency** is the number of execution environments running your function at the same instant, not requests per second: roughly `concurrency = invocations per second x average duration in seconds`. A function that handles 100 requests per second at 200 ms needs about 20. Every region in an account has a pool, **1,000 concurrent executions by default** (a soft limit you can raise), shared by all functions, and each function scales out by up to **1,000 new environments every 10 seconds** (a burst-scaling model that replaced the old fixed 500 to 3,000 burst quotas). When demand exceeds what is available the sync caller gets **`TooManyRequestsException` (429)**, asynchronous events are retried and queued for up to six hours, and an SQS event source mapping backs off and returns messages to the queue.",
    "There are two different knobs and the exam mixes them up on purpose. **Reserved concurrency** is a guarantee and a ceiling: the function owns that slice of the pool (so a noisy neighbour cannot starve it) and can never exceed it (so it cannot starve the others, or hammer a database with limited connections). It costs nothing. At **0** it is a kill switch. Lambda keeps at least 100 unreserved, so you can reserve at most the account limit minus 100. **Provisioned concurrency** is about latency, not capacity: it pre-initialises environments for a version or alias so those invokes skip the cold start, and you pay for it continuously. Provisioned counts against the reserved or account limit (reserved concurrency cannot be set lower than the provisioned amount), it cannot target `$LATEST`, and it can be scaled with Application Auto Scaling (scheduled or target-tracking). Reserved does not warm anything; provisioned does not raise any limit.",
    "Diagnosing throttles: the CloudWatch metrics are `Throttles`, `ConcurrentExecutions`, `UnreservedConcurrentExecutions` and, for provisioned, `ProvisionedConcurrencyUtilization` and `ProvisionedConcurrencySpilloverInvocations` (invokes that overflowed the provisioned pool and paid a cold start). Downstream protection patterns: put a queue in front and cap the **event source mapping's** `MaximumConcurrency` (min 2) instead of reserving, since a throttled SQS poll counts as a receive and can push good messages to a DLQ; use reserved concurrency to protect an RDS database; use RDS Proxy for connection pooling. Cold-start mitigation options in exam order: provisioned concurrency, **SnapStart** (Java, Python, .NET: restore from a snapshot taken after init), smaller packages, fewer VPC-heavy dependencies, and ARM64 for price-performance.",
    "Two honesty notes before the lab. First, the throttle is real here (reserved concurrency is enforced), but a terminal runs one command at a time, so the **Check** button makes the parallel call for you: it invokes the 4-second function twice at once while the reservation is 1 and expects one success and one throttle. Second, the provisioned concurrency step is **cosmetic**: the emulator accepts the config and reports `IN_PROGRESS` forever, with nothing allocated and no latency difference. Learn the API shape and the exam semantics; do not expect a speed-up.",
  ],
  goal: 'Reserve one execution environment for `slow`, prove a parallel call is throttled, configure (cosmetic) provisioned concurrency on an alias, throttle everything with reserved 0, then restore reserved 1.',
  steps: [
    { id: 'look', title: 'Check the account limits', body: "The fixture created the role and a function `slow` that takes 4 seconds. `get-account-settings` shows the pool: `ConcurrentExecutions` 1000 and `UnreservedConcurrentExecutions` 1000 until you reserve something.", commands: ['aws lambda get-account-settings --query AccountLimit'] },
    { id: 'reserve', title: 'Reserve exactly one environment', body: "From now on `slow` can run one copy at a time, and no other function can take that slot. Read `UnreservedConcurrentExecutions` again: it dropped by one.", commands: ['aws lambda put-function-concurrency --function-name slow --reserved-concurrent-executions 1', 'aws lambda get-account-settings --query AccountLimit.UnreservedConcurrentExecutions'] },
    { id: 'parallel', title: 'Prove it throttles: press Check', body: "You cannot start two commands at once in this terminal, so press **Check**. The checker invokes `slow` twice in parallel while the reservation is 1: one call runs for 4 seconds, the other must come back as `TooManyRequestsException`. (The Check takes about five seconds.) Meanwhile one normal invoke still works:", commands: [INV()] },
    { id: 'break', title: 'Break it: reserved concurrency 0', body: "Now throttle everything. The CLI retries a throttled call twice before it gives up, so expect a short pause and then `TooManyRequestsException`: Rate Exceeded.", commands: ['aws lambda put-function-concurrency --function-name slow --reserved-concurrent-executions 0', INV()], breakIt: true },
    { id: 'restore', title: 'Restore reserved concurrency 1', body: "Back to the guarded state. (`delete-function-concurrency` would remove the reservation entirely and put the function back into the shared pool.)", commands: ['aws lambda put-function-concurrency --function-name slow --reserved-concurrent-executions 1', 'aws lambda get-function-concurrency --function-name slow'] },
    { id: 'provisioned', title: 'Provisioned concurrency (cosmetic here)', body: "Provisioned concurrency needs a version or alias. Publish a version, alias it, then ask for one provisioned environment. Read the status: on real AWS it turns `READY` within a minute and you are billed for it; the emulator keeps it `IN_PROGRESS` with `AllocatedProvisionedConcurrentExecutions: 0` forever. Nothing is warmed.",  commands: ['aws lambda publish-version --function-name slow', 'aws lambda create-alias --function-name slow --name prod --function-version 1', 'aws lambda put-provisioned-concurrency-config --function-name slow --qualifier prod --provisioned-concurrent-executions 1', 'aws lambda get-provisioned-concurrency-config --function-name slow --qualifier prod'] },
    { id: 'rule', title: 'A rule the API enforces: reserved cannot drop below provisioned', body: "Provisioned environments are carved out of the reservation, so lowering reserved concurrency below the provisioned amount is refused (the emulator mirrors the AWS rule). Remove the provisioned config first if you really want to stop the function.", commands: ['aws lambda put-function-concurrency --function-name slow --reserved-concurrent-executions 0'] },
  ],
  breakIt: {
    title: 'Reserved concurrency 0 throttles every invoke',
    command: INV(),
    explain: [
      "`TooManyRequestsException ... Rate Exceeded` (HTTP 429) for every synchronous call, with no code running at all. This is the supported way to stop a runaway function without deleting anything: set reserved concurrency to 0, fix the problem, set it back. Because it is an API error and not a FunctionError, your own error handling inside the handler never sees it.",
      "The same exception appears when a real reservation is simply too low for the traffic. Then the right response depends on the invoker: a synchronous caller (API Gateway) should retry with backoff or you raise the limit; an async caller is retried by Lambda for up to 6 hours; an SQS trigger returns the messages to the queue and counts a receive each time, which is why the source queue's `maxReceiveCount` should be 5 or more.",
    ],
  },
  realAws: {
    cost: [
      "Reserved concurrency is free. Provisioned concurrency is billed per GB-second for the whole time it is configured, even with zero traffic, at a lower per-invoke duration price. Check the Lambda pricing page before enabling it on a large number of environments.",
    ],
    differences: [
      "Provisioned concurrency here is cosmetic: the status stays IN_PROGRESS and nothing is pre-initialised. On AWS it reaches READY, removes cold starts for the covered invocations and shows ProvisionedConcurrencySpilloverInvocations when exceeded.",
      "Real AWS scales each function by up to 1,000 environments every 10 seconds, enforces the 100-unreserved floor and the account limit (1,000 by default, raisable through Service Quotas); the emulator reports the limits but does not model burst scaling.",
      "Cold start duration and warm reuse cannot be observed in the emulator, so you cannot measure what provisioned concurrency saves.",
    ],
    asOf: '2026-11-13',
    sources: [
      { label: 'Understanding Lambda function scaling', url: 'https://docs.aws.amazon.com/lambda/latest/dg/lambda-concurrency.html' },
      { label: 'Configuring reserved concurrency', url: 'https://docs.aws.amazon.com/lambda/latest/dg/configuration-concurrency.html' },
      { label: 'Configuring provisioned concurrency', url: 'https://docs.aws.amazon.com/lambda/latest/dg/provisioned-concurrency.html' },
    ],
  },
  fidelity: [{ service: 'Lambda', pass: 395, total: 788 }, { service: 'IAM', pass: 502, total: 692 }],
  files: ['slow.mjs', 'slow.zip'],
  probeNote: 'The parallel-throttle check invokes `slow` twice at the same time when you press Check (it takes about five seconds).',
  checks: [
    { id: 'reserved', label: 'You set reserved concurrency of 1 on `slow`', hint: 'Run put-function-concurrency with --reserved-concurrent-executions 1.' },
    { id: 'parallel', label: 'Two parallel invokes: one ran, one got TooManyRequestsException', hint: 'Keep reserved concurrency at 1 and press Check.' },
    { id: 'provisioned', label: 'Provisioned concurrency is configured on alias `prod` (cosmetic on the emulator)', hint: 'Publish a version, create the alias, run put-provisioned-concurrency-config.' },
    { id: 'breakit', label: 'You saw TooManyRequestsException with reserved concurrency 0', hint: 'Set reserved concurrency to 0 and invoke.' },
    { id: 'restored', label: 'Reserved concurrency is back to 1', hint: 'Run the restore step.' },
  ],
}
