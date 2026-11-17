import { CreateArchiveCommand, CreateEventBusCommand, PutEventsCommand, PutRuleCommand, PutTargetsCommand, StartReplayCommand } from '@aws-sdk/client-eventbridge'
import { CreateQueueCommand, ReceiveMessageCommand, SetQueueAttributesCommand } from '@aws-sdk/client-sqs'
import type { Probe } from './capabilities'
import { ACCOUNT } from './lesson-kit'
import { sendPolicy, waitFor } from './lessons/kit2'

/** Capability probes for the EventBridge track (run once per emulator image; set honesty badges). */
export const EB_PROBES: Probe[] = [
  { key: 'eventbridge-replay', label: 'EventBridge archive replay re-delivers archived events to a rule', async run(root) {
    const bus = 'probe-replay-bus'
    const busArn = `arn:aws:events:us-east-1:${ACCOUNT}:event-bus/${bus}`
    await root.events.send(new CreateEventBusCommand({ Name: bus }))
    const url = (await root.sqs.send(new CreateQueueCommand({ QueueName: 'probe-replay-q' }))).QueueUrl!
    await root.sqs.send(new SetQueueAttributesCommand({ QueueUrl: url, Attributes: { Policy: sendPolicy('events.amazonaws.com', `arn:aws:sqs:us-east-1:${ACCOUNT}:probe-replay-q`, 'ArnEquals', `arn:aws:events:us-east-1:${ACCOUNT}:rule/${bus}/only-replays`) } }))
    // The rule only matches replayed events, so anything it receives came from the replay.
    await root.events.send(new PutRuleCommand({ Name: 'only-replays', EventBusName: bus, EventPattern: JSON.stringify({ source: ['probe.replay'], 'replay-name': [{ exists: true }] }) }))
    await root.events.send(new PutTargetsCommand({ Rule: 'only-replays', EventBusName: bus, Targets: [{ Id: 'q', Arn: `arn:aws:sqs:us-east-1:${ACCOUNT}:probe-replay-q` }] }))
    const archive = await root.events.send(new CreateArchiveCommand({ ArchiveName: 'probe-replay-archive', EventSourceArn: busArn, RetentionDays: 1 }))
    const from = new Date(Date.now() - 60_000)
    await root.events.send(new PutEventsCommand({ Entries: [{ EventBusName: bus, Source: 'probe.replay', DetailType: 'Probe', Detail: '{"n":1}' }] }))
    await Bun.sleep(1500)
    await root.events.send(new StartReplayCommand({ ReplayName: 'probe-replay', EventSourceArn: archive.ArchiveArn!, Destination: { Arn: busArn }, EventStartTime: from, EventEndTime: new Date(Date.now() + 60_000) }))
    const got = await waitFor(async () => {
      const r = await root.sqs.send(new ReceiveMessageCommand({ QueueUrl: url, MaxNumberOfMessages: 5, WaitTimeSeconds: 1 }))
      return (r.Messages ?? []).some((m) => m.Body?.includes('"replay-name"'))
    }, 10000, 300)
    return { enforced: got, detail: got ? undefined : 'the replay completed or started but no event reached the rule' }
  } },
]
