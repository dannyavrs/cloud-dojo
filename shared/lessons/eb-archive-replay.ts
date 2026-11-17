import type { LessonContent } from '../types'

export const ebArchiveReplay: LessonContent = {
  id: 'eb-archive-replay',
  n: '9.5',
  trackId: 'eventbridge',
  level: 'advanced',
  prereqs: ['eb-patterns'],
  estMinutes: 30,
  honesty: 'live',
  requires: ['eventbridge-replay'],
  honestyNote: 'Archives really record events and `start-replay` really re-delivers them to the bus with a `replay-name` field, including the `FilterArns` restriction. Verified on the emulator while building this module, and re-checked by the capability probe.',
  examTags: ['SAA:Resilient', 'DVA:Dev', 'DVA:Troubleshoot'],
  breakItCheck: 'breakit',
  editable: ['replay.json'],
  title: 'Archive and replay: recover and reprocess events',
  tagline: 'Keep every order, then replay a time window into a new consumer, without touching the live one.',
  predict: [
    { id: 'p1', prompt: 'You replay an archive into the bus with no other options. Two rules match the archived orders: the live consumer rule and a new backfill rule. Who receives the replayed events?', options: ['Only the new rule: replays skip rules that already saw the event', 'Every rule whose pattern matches, including the live one, so the live consumer sees duplicates', 'Nobody until you name the rule in the replay request', 'Only rules on the default bus'], answer: 1, explain: 'A replay publishes the archived events to the bus again and normal rule matching applies. The live rule matches them too and delivers them a second time. Restrict the replay with `FilterArns` on the destination, or make the live rule\'s pattern ignore events that carry `replay-name`.' },
    { id: 'p2', prompt: 'You start a replay whose time window contains no archived events. What do you see?', options: ['A ValidationException, because the window is empty', 'The replay ends COMPLETED and nothing was replayed, with no error', 'The replay stays STARTING until an event arrives', 'The replay fails because the archive has to be empty first'], answer: 1, explain: 'An empty window is not an error. The replay completes and `EventLastReplayedTime` stays empty. COMPLETED means "finished running", not "events were delivered": check the window against the event times.' },
    { id: 'p3', prompt: 'What does an archive retention of 0 days mean?', options: ['The archive keeps nothing', 'Events are retained indefinitely', 'Events are kept for 24 hours', 'The archive is paused'], answer: 1, explain: 'A retention of 0 (or no value) keeps archived events indefinitely and you pay storage until you delete the archive. Any positive number of days is a hard expiry. Retention is the cost lever for archives.' },
  ],
  concept: [
    'An **archive** stores events that pass through one bus (all of them, or only those matching an optional pattern). A **replay** reads a time window from an archive and publishes those events to a bus again. Together they answer exam questions about **recovering from a consumer bug, populating a new consumer with history, or reproducing a production problem** without asking producers to resend. Replay is asynchronous: `start-replay` returns `STARTING` and you poll `describe-replay` until `COMPLETED`, `CANCELLED` or `FAILED`.',
    'The most important property is that a replay is **not a direct delivery to one target**. It re-publishes events to the destination bus, so every rule that matches will fire again, including your live consumers. Two ways to avoid duplicate side effects: restrict the replay to specific rules with **`Destination.FilterArns`** (rule ARNs on that bus), and make consumers **idempotent** (events are delivered at least once anyway). Replayed events are identical to the originals except for an extra top-level **`replay-name`** field, so a rule can also opt in (`"replay-name": [{"exists": true}]`) or out (`[{"exists": false}]`).',
    'Operational details that show up in questions: an archive belongs to one bus in one Region, retention is 0 (forever) or a number of days, the window is expressed with the events\' original timestamps (`EventStartTime` and `EventEndTime`), and you should not rely on replayed events arriving in their original order. The event count and size of an archive update asynchronously on AWS, so do not expect exact numbers seconds after publishing. You pay for archived data processed, for storage while retained, and for replayed events like published ones.',
    'In this module the fixture creates the bus `shop`, a live consumer (rule `live-orders` to queue `live`) and a backfill consumer that only wants replayed events (rule `backfill` to queue `backfill`). You create the archive, publish three orders, replay them only to the backfill rule, then replay without a filter and watch the live queue receive its orders a second time.',
  ],
  goal: 'An archive of bus `shop` holds three orders and a filtered replay delivers them only to the backfill queue, and you have seen an unfiltered replay duplicate them into the live queue.',
  steps: [
    { id: 'look', title: 'Look at the two consumers', body: 'The live rule matches every order. The backfill rule only matches events that carry a `replay-name` field, so it stays quiet until a replay happens.', commands: ['aws events list-rules --event-bus-name shop --query Rules[].[Name,EventPattern] --output text'] },
    { id: 'archive', title: 'Create an archive of the bus', body: 'The archive records events published to `shop` from now on. A retention of 1 day keeps the cost bounded.', commands: ['aws events create-archive --archive-name shop-archive --event-source-arn arn:aws:events:us-east-1:000000000000:event-bus/shop --retention-days 1'] },
    { id: 'send', title: 'Publish three orders', body: '`events.json` has three `OrderPlaced` events. The live rule delivers them to the `live` queue and the archive records them.', commands: ['aws events put-events --entries file://events.json'] },
    { id: 'count', title: 'Confirm the archive captured them', body: 'The count should reach 3 within a few seconds. On real AWS the numbers lag by minutes.', commands: ['aws events describe-archive --archive-name shop-archive --query [State,EventCount]'] },
    { id: 'before', title: 'See the queues before any replay', body: '`live` has the three orders, `backfill` is empty.', commands: ['aws sqs get-queue-attributes --queue-url https://sqs.us-east-1.amazonaws.com/000000000000/live --attribute-names ApproximateNumberOfMessages --query Attributes', 'aws sqs get-queue-attributes --queue-url https://sqs.us-east-1.amazonaws.com/000000000000/backfill --attribute-names ApproximateNumberOfMessages --query Attributes'] },
    { id: 'replay', title: 'Replay only to the backfill rule', body: '`replay.json` names the archive, the bus, the time window (written when you opened this module, covering the next hour) and `FilterArns` with the `backfill` rule. The replay starts, then completes within seconds. Read one replayed message: it is the original envelope plus `replay-name`.', commands: ['aws events start-replay --cli-input-json file://replay.json', 'aws events describe-replay --replay-name backfill-run --query [State,EventLastReplayedTime]', "aws sqs receive-message --queue-url https://sqs.us-east-1.amazonaws.com/000000000000/backfill --max-number-of-messages 1 --query 'Messages[].Body'"] },
    { id: 'break', title: 'Break it: replay without a filter', body: '`replay-all.json` is the same replay without `FilterArns`. Run it, wait a few seconds, then count `live` again: the same three orders have been delivered a second time. Imagine each one charging a card.', commands: ['aws events start-replay --cli-input-json file://replay-all.json', 'aws sqs get-queue-attributes --queue-url https://sqs.us-east-1.amazonaws.com/000000000000/live --attribute-names ApproximateNumberOfMessages --query Attributes'], breakIt: true },
  ],
  breakIt: {
    title: 'Replay into the bus without FilterArns',
    command: 'aws events start-replay --cli-input-json file://replay-all.json',
    explain: [
      'The `live` queue went from 3 to 6 messages. A replay re-publishes the archived events to the bus and every matching rule fires: the live consumer cannot tell a replay from a first delivery, except by the `replay-name` field. The backfill queue gained another three as well.',
      'Prevention is a design choice made before you ever replay: restrict with `FilterArns`, give live rules a pattern that excludes `replay-name`, and keep consumers idempotent (an order id used as a dedupe key). The empty-window case (prediction 2) is the opposite surprise: COMPLETED with nothing replayed.',
    ],
  },
  realAws: {
    cost: [
      'Archives cost about $0.10 per GB of events archived (processed) plus about $0.023 per GB-month of storage; replayed events are charged like custom events at about $1.00 per million (all approximate, us-east-1). Check the pricing page: as of 2026-11-15. Retention 0 means storage keeps growing until you delete the archive.',
      'The 3 events here are far below any measurable charge. A busy bus with large events and indefinite retention is where archives get expensive.',
    ],
    differences: [
      'On AWS, `EventCount` and `SizeBytes` of an archive can lag by minutes. The emulator updated within seconds.',
      'Real replays can take much longer than a moment and run in `STARTING` then `RUNNING` states before `COMPLETED`. You can cancel one with `cancel-replay`. The emulator finished immediately in testing.',
      'Real AWS restricts how a replay window and archive relate and rate-limits replays; the emulator accepted the windows used here (including an end time in the future). Cross-Region and cross-account archives are separate topics not covered.',
    ],
    asOf: '2026-11-15',
    sources: [
      { label: 'Archiving and replaying events', url: 'https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-archive.html' },
      { label: 'StartReplay API reference', url: 'https://docs.aws.amazon.com/eventbridge/latest/APIReference/API_StartReplay.html' },
      { label: 'EventBridge pricing', url: 'https://aws.amazon.com/eventbridge/pricing/' },
    ],
  },
  fidelity: [{ service: 'EventBridge', pass: 723, total: 968 }],
  files: ['events.json', 'replay.json', 'replay-all.json'],
  probeNote: 'These checks read the archive, the replay records, the queues and your command history. Pressing Check sends nothing new.',
  checks: [
    { id: 'archive', label: 'Archive `shop-archive` on bus `shop` is ENABLED', hint: 'create-archive with the bus ARN.' },
    { id: 'captured', label: 'The archive captured at least 3 events', hint: 'Publish events.json after creating the archive, then wait a few seconds.' },
    { id: 'replay', label: 'A replay restricted to the `backfill` rule COMPLETED', hint: 'start-replay with replay.json, then describe-replay.' },
    { id: 'backfill', label: 'The `backfill` queue received the replayed orders', hint: 'Wait a few seconds after the replay completes.' },
    { id: 'breakit', label: 'You saw the unfiltered replay duplicate orders into `live`', hint: 'Run start-replay with replay-all.json, then count the `live` queue (6).' },
  ],
}
