import type { LessonContent } from '../types'

export const ddbStreamsTtl: LessonContent = {
  id: 'ddb-streams-ttl',
  n: '3.6',
  trackId: 'dynamodb',
  level: 'advanced',
  prereqs: ['ddb-conditional', 'lambda-roles'],
  estMinutes: 35,
  honesty: 'live',
  honestyNote: 'Streams and the Lambda trigger behave as on AWS. TTL deletes within about 15 seconds here; on AWS expect a delay of hours to days.',
  examTags: ['DVA:Dev', 'SAA:Resilient'],
  breakItCheck: 'breakit',
  editable: ['stream.mjs'],
  title: 'Streams, Lambda triggers and TTL',
  tagline: 'React to every change, and let DynamoDB delete expired data for free.',
  predict: [
    { id: 'p1', prompt: "An item is removed by DynamoDB's TTL process. Does your stream consumer see it?", options: ["No, TTL deletions are invisible to streams", "Yes, as a REMOVE record (marked as a service deletion)", "Yes, as a MODIFY record", "Only if you enabled point-in-time recovery"], answer: 1, explain: "TTL deletions are real deletes and show up in the stream as REMOVE records whose userIdentity is the DynamoDB service. That is how you archive expired items." },
    { id: 'p2', prompt: "You store the expiry as the string \"1700000000\" instead of the number 1700000000. What does TTL do with the item?", options: ["Deletes it normally", "Never deletes it: the TTL attribute must be a Number holding epoch seconds", "Deletes it after 24 hours", "Rejects the put-item"], answer: 1, explain: "A TTL attribute of any type other than Number is ignored. The put succeeds and the item lives forever, a classic quiet bug." },
    { id: 'p3', prompt: "Stream view type is NEW_AND_OLD_IMAGES. What does a MODIFY record contain?", options: ["Only the keys", "Only the new item", "Both the item before and after the change", "Only the changed attributes"], answer: 2, explain: "KEYS_ONLY, NEW_IMAGE, OLD_IMAGE and NEW_AND_OLD_IMAGES are the four view types. NEW_AND_OLD_IMAGES carries both, which lets you compute a diff." },
  ],
  concept: [
    "A **DynamoDB Stream** is an ordered log of item-level changes (`INSERT`, `MODIFY`, `REMOVE`) kept for 24 hours. You choose what each record carries with the **view type**: `KEYS_ONLY`, `NEW_IMAGE`, `OLD_IMAGE` or `NEW_AND_OLD_IMAGES`. Records are ordered **per item**, sharded by partition, and exactly one stream record is produced per change. This is change data capture without polling: audit logs, search indexing, cache invalidation, cross-table replication and event-driven fan-out all hang off it.",
    "The usual consumer is **Lambda through an event source mapping (ESM)**. Lambda polls the shards for you, batches records, invokes your function and only moves the checkpoint forward when the function succeeds. A failing batch is retried until the records expire or you configure bisect, maximum age and a failure destination, so a poison record can block its shard. The function's execution role needs `dynamodb:GetRecords`, `GetShardIterator`, `DescribeStream` and `ListStreams`.",
    "**TTL** deletes items for you once the epoch-seconds timestamp in a designated attribute is in the past. It is free (TTL deletes consume no write capacity), asynchronous, and *not* precise: deletion is a background sweep, so an expired item can still be returned by a read until it is removed, which means filters that care about expiry should also compare the timestamp. Because TTL deletes flow through the stream as `REMOVE`, a stream plus TTL is the standard pattern to archive expired data to S3.",
    "In this module a Lambda function logs every record. You will write, update and delete an item and watch INSERT, MODIFY and REMOVE arrive, then enable TTL and see an expired item vanish and its REMOVE show up. Open `stream.mjs` in the editor to see (and change) what gets logged.",
  ],
  goal: "Function `stream-logger` triggered by the `Events` stream logged INSERT, MODIFY and REMOVE, and TTL removed the expired item with a numeric timestamp but not the one with a string.",
  steps: [
    { id: 'look', title: 'See the stream and the starter handler', body: "The fixture created table `Events` with a stream (`NEW_AND_OLD_IMAGES`) and the role `lambda-exec`. Open `stream.mjs`: it logs one `STREAM` line per record. Copy the stream ARN from this command, you need it in step 3.", commands: [`aws dynamodb describe-table --table-name Events --query 'Table.[LatestStreamArn,StreamSpecification]'`] },
    { id: 'fn', title: 'Deploy the consumer', body: "`stream.zip` is built from `stream.mjs`. Wait for the function to become Active.", commands: [`aws lambda create-function --function-name stream-logger --runtime nodejs22.x --handler stream.handler --role arn:aws:iam::000000000000:role/lambda-exec --zip-file fileb://stream.zip`, `aws lambda wait function-active-v2 --function-name stream-logger`] },
    { id: 'esm', title: 'Connect the stream with an event source mapping', body: "Replace `<STREAM_ARN>` with the LatestStreamArn. `LATEST` means \"only records written from now on\". Give the mapping about ten seconds to start polling before you write anything.", commands: [`aws lambda create-event-source-mapping --function-name stream-logger --event-source-arn <STREAM_ARN> --starting-position LATEST --batch-size 10`] },
    { id: 'writes', title: 'Insert, modify, delete', body: "Three writes, three record types.", commands: [
      `aws dynamodb put-item --table-name Events --item '{"PK":{"S":"order#1"},"status":{"S":"new"}}'`,
      `aws dynamodb update-item --table-name Events --key '{"PK":{"S":"order#1"}}' --update-expression 'SET #s = :s' --expression-attribute-names '{"#s":"status"}' --expression-attribute-values '{":s":{"S":"paid"}}'`,
      `aws dynamodb delete-item --table-name Events --key '{"PK":{"S":"order#1"}}'`] },
    { id: 'logs', title: 'Read what the function saw', body: "Lambda writes to CloudWatch Logs. Allow a few seconds for the batches, then expect three `STREAM` lines: INSERT, MODIFY, REMOVE.", commands: [`aws logs filter-log-events --log-group-name /aws/lambda/stream-logger --query 'events[].message' --output text`] },
    { id: 'ttl', title: 'Turn on TTL', body: "Tell DynamoDB which attribute holds the expiry. It must be a Number of epoch seconds.", commands: [`aws dynamodb update-time-to-live --table-name Events --time-to-live-specification Enabled=true,AttributeName=expiresAt`] },
    { id: 'expire', title: 'Write two already-expired items', body: "`1700000000` is in November 2023, long past. The first item stores it as a **Number**, the second (the break-it) as a **String**.", commands: [
      `aws dynamodb put-item --table-name Events --item '{"PK":{"S":"session#ttl-number"},"expiresAt":{"N":"1700000000"}}'`,
      `aws dynamodb put-item --table-name Events --item '{"PK":{"S":"session#ttl-string"},"expiresAt":{"S":"1700000000"}}'`], breakIt: true },
    { id: 'verify', title: 'Wait about 20 seconds, then look', body: "The numeric one is gone. The string one is still there, expired on paper but invisible to TTL. Check the logs again for the REMOVE of `session#ttl-number`.", commands: [`aws dynamodb scan --table-name Events --query 'Items[].PK.S' --output text`] },
  ],
  breakIt: {
    title: 'A TTL timestamp stored as a string',
    command: `aws dynamodb put-item --table-name Events --item '{"PK":{"S":"session#ttl-string"},"expiresAt":{"S":"1700000000"}}'`,
    explain: [
      "No error at all: the put succeeds and the item sits there forever, because TTL only looks at attributes of type Number. Nothing warns you, which is why this shows up in production as a table that mysteriously keeps growing.",
      "The fix is a data fix: store `expiresAt` as a Number of epoch **seconds** (not milliseconds, which would put expiry thousands of years away). Also remember that an expired item can still be read until the sweep removes it, so check the timestamp in your read path if staleness matters.",
    ],
  },
  realAws: {
    cost: [
      "TTL deletions are free: they do not consume write capacity. The stream records they produce are still readable by your consumers.",
      "DynamoDB Streams charge per read request unit when you read them yourself with the Streams API (see the pricing page). Lambda event source mappings poll the stream for you and the Lambda invocations bill as normal. Records are kept 24 hours.",
    ],
    differences: [
      "The emulator sweeps TTL within about 15 seconds. Real AWS typically deletes expired items within a few days of expiry (AWS documents a delay of up to 48 hours for most items), so never rely on TTL for timely deletion or security.",
      "On real AWS the function role needs the DynamoDB stream read permissions; the managed policy `AWSLambdaDynamoDBExecutionRole` grants them. This module's role is created by the fixture.",
      "Real streams shard automatically and give per-item ordering only. Retry, bisect and on-failure destinations for ESMs exist on real AWS and are worth knowing for the exam.",
    ],
    asOf: '2026-11-13',
    sources: [{ label: 'Change data capture with DynamoDB Streams', url: 'https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html' }, { label: 'Expiring items with TTL', url: 'https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html' }],
  },
  fidelity: [{ service: 'DynamoDB', pass: 1057, total: 1481 }, { service: 'Lambda', pass: 395, total: 788 }],
  files: ['stream.mjs', 'stream.zip'],
  checks: [
    { id: 'fn', label: 'Function `stream-logger` is Active', hint: 'Run step 2.' },
    { id: 'esm', label: 'An event source mapping connects the `Events` stream to the function', hint: 'Run step 3 with the real stream ARN.' },
    { id: 'cdc', label: 'The logs show INSERT, MODIFY and REMOVE', hint: 'Run the three writes (step 4), wait a few seconds and run Check again.' },
    { id: 'ttl', label: 'TTL is enabled on `expiresAt`', hint: 'Run step 6.' },
    { id: 'expired', label: 'The item with a numeric expiry was deleted by TTL', hint: 'Write the two items in step 7 and wait about 20 seconds.' },
    { id: 'breakit', label: 'The string-typed expiry item is still there', hint: 'Write `session#ttl-string` in step 7 and wait for the numeric one to vanish.' },
  ],
}
