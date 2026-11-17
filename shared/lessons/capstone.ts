import type { LessonContent } from '../types'

export const capstone: LessonContent = {
  id: 'capstone',
  n: '★',
  trackId: 'capstone',
  level: 'advanced',
  prereqs: [],
  estMinutes: 60,
  honesty: 'live',
  examTags: ["SAA:Secure", "SAA:Resilient", "SAA:Performant", "SAA:Cost", "DVA:Dev", "DVA:Sec"],
  predict: [],

  title: 'Capstone: Snap Notes, production-shaped',
  tagline: 'Build a small serverless app from a spec card, then see it scored as a mini Well-Architected review.',
  concept: [
    '**Snap Notes** saves text notes. A signed-in user (`ana`, from a Cognito user pool) calls `POST /notes` on an HTTP API; a Lambda stores the note in DynamoDB. Edits are asynchronous: they go onto a FIFO queue and a worker applies them. New notes can be moderated by a Step Functions workflow with retries. An alarm watches the API function, and a KMS-encrypted photo bucket completes the picture.',
    'Build it from the spec card with the commands you learned (starter files are in the Files viewer: handler sources, zips, policies, a starter state machine). Or press **Show me** to have the server build it one step at a time with the SDK, and read what each step did. The checker works either way.',
    'The checker is not a list of resources, it is a **review**: one row per Well-Architected pillar. Each row expands into sub-checks, and a row passes only when all of its sub-checks pass. Some sub-checks send real test traffic (a 401 probe, a signed-in request, an edit through the queue, three workflow runs, an alarm notification), so they wait for **Run checks**.',
    'Names are part of the spec. Identity is already provided: user pool `snap-users`, app client `snap-web`, user `ana` with password `Snap#Notes2026`.',
  ],
  goal: 'All six pillar rows green: every sub-check of Operational Excellence, Security, Reliability, Performance Efficiency, Cost Optimization and Sustainability passes.',
  steps: [
    {
      id: 'spec1', title: 'Spec 1: authenticated POST /notes',
      body: 'Table `Notes` (key `id`, string, on-demand billing). Function `snap-api` (`api.zip`, handler `api.handler`) as role `snap-api-role`. HTTP API `snap-notes` with a Lambda proxy integration (payload 2.0), route `POST /notes`, a `$default` stage with auto-deploy, and a **JWT authorizer**: issuer = the `iss` claim of an IdToken (it ends with the pool id; the emulator uses its own host here, AWS uses `cognito-idp.<region>.amazonaws.com/<pool id>`), audience = the `snap-web` client id. Without a token the API must answer 401; with `ana`\'s IdToken it must answer 201 and store the item.',
      commands: [
        'aws cognito-idp list-user-pools --max-results 10',
        'aws cognito-idp list-user-pool-clients --user-pool-id <pool-id>',
        "aws cognito-idp initiate-auth --client-id <client-id> --auth-flow USER_PASSWORD_AUTH --auth-parameters 'USERNAME=ana,PASSWORD=Snap#Notes2026' --query AuthenticationResult.IdToken --output text",
        "aws cognito-idp initiate-auth --client-id <client-id> --auth-flow USER_PASSWORD_AUTH --auth-parameters 'USERNAME=ana,PASSWORD=Snap#Notes2026' --query AuthenticationResult.IdToken --output text | cut -d. -f2 | base64 -d 2>/dev/null",
        "aws apigatewayv2 create-authorizer --api-id <api-id> --name cognito --authorizer-type JWT --identity-source '$request.header.Authorization' --jwt-configuration Audience=<client-id>,Issuer=<iss claim of the token>",
      ],
    },
    {
      id: 'spec2', title: 'Spec 2: FIFO edits with a dead-letter queue',
      body: 'FIFO queue `note-edits.fifo` with content-based deduplication, long polling (20 s) and a redrive policy to FIFO queue `note-edits-dlq.fifo` (max receives 3). Function `snap-worker` (`worker.zip`, handler `worker.handler`) as `snap-worker-role`, consuming the queue through an event source mapping. An edit is `{"id": "<note id>", "text": "..."}` and the worker updates that item.',
      commands: [],
    },
    {
      id: 'spec3', title: 'Spec 3: moderation workflow',
      body: 'Standard state machine `note-moderation` (starter: `moderation.asl.json`) invoking `snap-moderator` (`moderator.zip`, handler `moderator.handler`, role `snap-moderator-role`). Role `snap-sfn-role` is trusted by `states.amazonaws.com` and may invoke that one function. Task `Moderate` retries the `Transient` error with exponential backoff (`BackoffRate` above 1) and catches everything else into a state named `FlagNote`; a clean note goes on to a Succeed state. The checker starts three executions: clean, poison and transient.',
      commands: [
        'aws stepfunctions create-state-machine --name note-moderation --type STANDARD --definition file://moderation.asl.json --role-arn arn:aws:iam::000000000000:role/snap-sfn-role',
      ],
    },
    {
      id: 'spec4', title: 'Spec 4: observability',
      body: 'Topic `snap-alerts`; an inbox SQS queue (any name) whose policy lets SNS send from that topic, subscribed to it; and a CloudWatch alarm on namespace `AWS/Lambda`, metric `Errors`, dimension `FunctionName=snap-api`, with the topic as its alarm action. The checker moves the alarm to ALARM and waits for the notification to reach your inbox.',
      commands: [],
    },
    {
      id: 'spec5', title: 'Spec 5: data protection and tidiness',
      body: 'Bucket `snap-photos` with default encryption SSE-KMS using your own key (give it an alias), all four Block Public Access settings on, and a lifecycle rule that expires objects under `tmp/` (`lifecycle.json` has the rule).',
      commands: [],
    },
    {
      id: 'spec6', title: 'Spec 6: least privilege',
      body: 'One role per function: `snap-api-role` (`PutItem` on `Notes`), `snap-worker-role` (`UpdateItem` on `Notes`; receive, delete and get-attributes on the edits queue), `snap-moderator-role` (only its own log group). No `*` actions. The checker asks the policy simulator: needed actions allowed, `dynamodb:DeleteTable`, `iam:CreateUser`, `s3:DeleteBucket` and `kms:ScheduleKeyDeletion` not. Create the roles first: the functions need them.',
      commands: [],
    },
    { id: 'hint', title: 'Stuck?', body: 'Each failing sub-check carries a hint, and the tutor panel can explain it. Or press **Show me** for the next step. Reuse the API Gateway, SQS, Step Functions, CloudWatch, KMS and IAM modules for the exact command shapes.', commands: [] },
  ],
  breakIt: {
    title: 'Remove a permission and re-run the review',
    command: 'aws iam delete-role-policy --role-name snap-worker-role --policy-name worker',
    explain: [
      'After building everything, delete the worker role\'s inline policy and press Run checks again: Security fails (the role is no longer least-privilege because it allows nothing) and Performance fails (the edit is never applied). The queue still accepts messages; the function just cannot read them or write the item. Debugging distributed systems is mostly this: find which hop lost permission.',
    ],
  },
  realAws: {
    cost: [
      'At 10,000 notes a month this app sits inside the free tiers of Lambda, SQS and DynamoDB. The costs that do not round to zero are small and steady: a KMS customer-managed key (about $1 a month), CloudWatch alarms (about $0.10 each), and Step Functions Standard transitions (a few cents per 100,000 notes at roughly 3 transitions each). API Gateway HTTP APIs are about $1 per million requests. Estimates only: verify with the AWS Pricing Calculator.',
    ],
    differences: [
      'The emulator publishes `AWS/Lambda` metrics (`Invocations`, `Duration`, `Errors`) and evaluates alarms on them by itself; we saw an alarm on `snap-moderator` `Errors` go to ALARM after the poison and transient probes. The checker still proves the **wiring** deterministically: it forces your alarm into ALARM and waits for the notification to reach your inbox, instead of breaking `snap-api` on purpose. Metric periods and evaluation timing are the emulator\'s, not CloudWatch\'s.',
      'The JWT authorizer issuer is whatever the token\'s `iss` claim says. On AWS that is `https://cognito-idp.<region>.amazonaws.com/<pool id>`; the emulator signs tokens with its own address, so you read `iss` from a token instead of building the URL.',
      'The Well-Architected Framework is a set of questions and trade-offs reviewed by people. This checker automates the sub-checks that can be verified on an emulator and drops the ones that cannot, so a green board is a good sign and not a certification.',
      'Lifecycle rules are accepted and read back, but the emulator never expires objects. The disabled-key behaviour of SSE-KMS and the DynamoDB resource policies are not enforced either. The emulator\'s IAM answers are from the policy simulator, not an audit.',
      'On AWS the API function would also enqueue the edit and start the moderation workflow itself; here the checker plays those callers so each hop can be proven separately. The photo upload to queue to worker flow of the first capstone is out of scope for this version.',
      'To deploy this for real you would describe it as code (CloudFormation, CDK, SAM or Terraform). IaC fidelity in the emulator is low, so it is out of scope here.',
    ],
    asOf: '2026-11-15',
    sources: [
      { label: 'AWS Well-Architected Framework', url: 'https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html' },
      { label: 'Step Functions error handling', url: 'https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html' },
      { label: 'API Gateway JWT authorizers', url: 'https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html' },
    ],
  },
  fidelity: [{ service: 'Lambda', pass: 395, total: 788 }, { service: 'DynamoDB', pass: 1057, total: 1481 }, { service: 'SQS', pass: 299, total: 335 }, { service: 'SNS', pass: 239, total: 284 }, { service: 'API Gateway v2', pass: 156, total: 277 }],
  files: ['api.mjs', 'api.zip', 'worker.mjs', 'worker.zip', 'moderator.mjs', 'moderator.zip', 'moderation.asl.json', 'lambda-trust.json', 'sfn-trust.json', 'api-policy.json', 'worker-policy.json', 'moderator-policy.json', 'sfn-policy.json', 'lifecycle.json'],
  httpProbe: true,
  probeNote: 'Run checks sends test traffic: an unauthenticated and a signed-in POST, an edit through the queue, three workflow executions and an alarm notification. It takes up to about 15 seconds.',
  checks: [
    { id: 'opsex', label: 'Operational Excellence', hint: 'Alarm, topic, subscriber and live metrics.' },
    { id: 'security', label: 'Security', hint: 'JWT on the route, encrypted private bucket, one least-privilege role per function.' },
    { id: 'reliability', label: 'Reliability', hint: 'FIFO with dedup and a DLQ, workflow with Retry and Catch.' },
    { id: 'performance', label: 'Performance Efficiency', hint: 'HTTP API and asynchronous edits through an event source mapping.' },
    { id: 'cost', label: 'Cost Optimization', hint: 'On-demand table, long polling, no provisioned concurrency.' },
    { id: 'sustainability', label: 'Sustainability', hint: 'Right-sized functions and expiring scratch data.' },
  ],
}
