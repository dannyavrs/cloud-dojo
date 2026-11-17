import type { LessonContent } from '../types'

export const ddbConditional: LessonContent = {
  id: 'ddb-conditional',
  n: '3.4',
  trackId: 'dynamodb',
  level: 'intermediate',
  prereqs: ['dynamodb-notes'],
  estMinutes: 25,
  honesty: 'live',
  examTags: ['DVA:Dev', 'SAA:Performant'],
  breakItCheck: 'breakit',
  title: 'Conditional writes and optimistic locking',
  tagline: 'Stop two clients from overwriting each other without taking a lock.',
  predict: [
    { id: 'p1', prompt: "Two clients both read an item at version = 1, then both send an update with the condition `version = 1` that sets version = version + 1. What happens?", options: ["Both succeed and the last write wins", "The first succeeds, the second fails with ConditionalCheckFailedException", "Both fail", "DynamoDB merges the two updates"], answer: 1, explain: "The condition is checked atomically with the write. The first update moves the version to 2, so the second client's condition (version = 1) is false and it is rejected: no lost update." },
    { id: 'p2', prompt: "credits is 10. Two clients concurrently send `ADD credits :c` with c = 5 and no condition. What is credits afterwards?", options: ["15, one update is lost", "20, ADD is applied atomically on the server", "10, the writes cancel out", "It depends on which client is faster, and one may fail"], answer: 1, explain: "ADD and SET x = x + :n are evaluated server side, atomically, so concurrent increments never lose updates. Retrying one after a timeout, though, can double count." },
    { id: 'p3', prompt: "Does a write that fails its condition consume write capacity?", options: ["No, nothing was written", "Yes, a failed conditional write still consumes write capacity", "Only on provisioned tables", "Only the first 1 KB is free"], answer: 1, explain: "DynamoDB still has to read the item to evaluate the condition, and the request is billed. Retry storms on a hot key can therefore throttle you." },
  ],
  concept: [
    "A plain `put-item` or `update-item` is **last write wins**. Two clients that read the same item, edit it and write it back will silently erase each other's changes (the **lost update** problem). Databases usually fix this with locks. DynamoDB has no locks, and instead gives you **condition expressions**: the write happens only if a predicate about the *current* stored item is true, and the check and write are atomic.",
    "**Optimistic locking** is the standard pattern built on that. Every item carries a `version` number. A client reads the item and remembers the version it saw, then writes with `ConditionExpression: version = :seen` and increments the version in the same expression. If anyone changed the item in between, the condition is false and DynamoDB answers `ConditionalCheckFailedException`. The loser re-reads, re-applies its change to the fresh item, and retries. Nobody waits, and conflicts, which are rare, cost one extra round trip. The AWS SDKs for Java and others ship this as `@DynamoDBVersionAttribute`.",
    "Two related tools. **Atomic counters** (`ADD hits :one`, or `SET n = n + :one`) are applied on the server, so concurrent increments are safe without any condition, but a retry after a timeout can count twice, so they are for approximate counters, not money. And `attribute_not_exists(pk)` makes a create **idempotent and safe**: a second create of the same key fails instead of overwriting, the pattern from lesson 3.1.",
    "Know the vocabulary for the exam: `ConditionExpression` guards a write, `FilterExpression` only trims a read after the fact, and `ReturnValuesOnConditionCheckFailure` (introduced in 2023) hands you the stored item inside the error so the retry does not need a second read.",
  ],
  goal: "Profile `u1` has gone from version 1 to 3 through two conditional updates, a stale write was rejected, and an atomic counter raised `credits`.",
  steps: [
    { id: 'read', title: 'Read the profile', body: "The fixture created table `Profiles` (partition key `pk`) with one item: name `Noa`, `version` 1, `credits` 10. `--consistent-read` makes sure you see the latest write.", commands: [`aws dynamodb get-item --table-name Profiles --key '{"pk":{"S":"u1"}}' --consistent-read`] },
    { id: 'a', title: 'Client A updates with the version it saw', body: "Set the name and bump the version in one expression, but only `version = :v`. `#n` is an alias for the attribute name because `name` is a DynamoDB reserved word. The result is version 2.", commands: [`aws dynamodb update-item --table-name Profiles --key '{"pk":{"S":"u1"}}' --update-expression 'SET #n = :n, version = version + :one' --condition-expression 'version = :v' --expression-attribute-names '{"#n":"name"}' --expression-attribute-values '{":n":{"S":"Noa A"},":v":{"N":"1"},":one":{"N":"1"}}' --return-values ALL_NEW`] },
    { id: 'b', title: 'Break it: client B still thinks the version is 1', body: "Client B read the item before A wrote. It sends the same kind of update with `:v` = 1. The condition is false, so DynamoDB refuses and nothing is written. Without the condition this would have silently erased A's name.", commands: [`aws dynamodb update-item --table-name Profiles --key '{"pk":{"S":"u1"}}' --update-expression 'SET #n = :n, version = version + :one' --condition-expression 'version = :v' --expression-attribute-names '{"#n":"name"}' --expression-attribute-values '{":n":{"S":"Noa B"},":v":{"N":"1"},":one":{"N":"1"}}'`], breakIt: true },
    { id: 'retry', title: 'B re-reads and retries with the fresh version', body: "The classic loop: read, apply, conditional write, on failure repeat. B now sees version 2 and name `Noa A`, applies its change on top and writes with `:v` = 2. The result is version 3.", commands: [
      `aws dynamodb get-item --table-name Profiles --key '{"pk":{"S":"u1"}}' --consistent-read --query 'Item.[version.N,name.S]' --output text`,
      `aws dynamodb update-item --table-name Profiles --key '{"pk":{"S":"u1"}}' --update-expression 'SET #n = :n, version = version + :one' --condition-expression 'version = :v' --expression-attribute-names '{"#n":"name"}' --expression-attribute-values '{":n":{"S":"Noa B"},":v":{"N":"2"},":one":{"N":"1"}}' --return-values ALL_NEW`] },
    { id: 'counter', title: 'An atomic counter needs no condition', body: "`ADD` is evaluated on the server. Run it twice: `credits` goes from 10 to 20, and two concurrent callers could not lose an increment. The flip side: if a client retries after a timeout, it counts again.", commands: [`aws dynamodb update-item --table-name Profiles --key '{"pk":{"S":"u1"}}' --update-expression 'ADD credits :c' --expression-attribute-values '{":c":{"N":"5"}}' --return-values UPDATED_NEW`] },
    { id: 'init', title: 'Initialize once with if_not_exists', body: "`if_not_exists(created, :now)` sets an attribute only when it is missing, so repeated writes never overwrite the first value. Run it twice and compare the result: `created` keeps the first timestamp.", commands: [`aws dynamodb update-item --table-name Profiles --key '{"pk":{"S":"u1"}}' --update-expression 'SET created = if_not_exists(created, :now)' --expression-attribute-values '{":now":{"S":"2026-11-13"}}' --return-values UPDATED_NEW`] },
  ],
  breakIt: {
    title: 'A stale write with an out-of-date version',
    command: `aws dynamodb update-item --table-name Profiles --key '{"pk":{"S":"u1"}}' --update-expression 'SET #n = :n, version = version + :one' --condition-expression 'version = :v' --expression-attribute-names '{"#n":"name"}' --expression-attribute-values '{":n":{"S":"Noa B"},":v":{"N":"1"},":one":{"N":"1"}}'`,
    explain: [
      "`ConditionalCheckFailedException: The conditional request failed`. The stored version is 2, the condition says 1, so the write is refused atomically. That exception is not an outage, it is the **signal** that someone else got there first. Handle it by re-reading and retrying, not by failing the request.",
      "Compare the unconditional version of the same update: it would succeed, and A's change would vanish with no error anywhere. Optimistic locking trades a rare retry for never losing data.",
    ],
  },
  realAws: {
    cost: [
      "A failed conditional write still consumes write capacity (1 unit per KB of the item being checked), so a retry loop on a hot key costs money and can throttle. Keep conflict rates low by spreading writers over different items.",
      "On-demand writes are about $0.625 per million units in us-east-1 (AWS on-demand pricing page). Transactional writes cost double.",
    ],
    differences: [
      "Behavior of condition expressions is identical in the emulator. `ReturnValuesOnConditionCheckFailure` (the item inside the exception) is a newer API and the CLI prints only the message.",
      "Concurrency here comes from you running two commands in sequence. On real AWS, two clients really do race, and only one wins.",
    ],
    asOf: '2026-11-13',
    sources: [{ label: 'Condition expressions', url: 'https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html' }, { label: 'Optimistic locking with a version number', url: 'https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBMapper.OptimisticLocking.html' }],
  },
  fidelity: [{ service: 'DynamoDB', pass: 1057, total: 1481 }],
  files: [],
  checks: [
    { id: 'seed', label: 'Table `Profiles` has profile `u1`', hint: 'The fixture creates it. Press Reset module if it is missing.' },
    { id: 'a', label: 'Client A updated the profile with a version check (version 2)', hint: 'Run step 2 with `:v` = 1.' },
    { id: 'breakit', label: 'You saw ConditionalCheckFailedException from the stale write', hint: 'Run the break-it command (step 3) after step 2.' },
    { id: 'retry', label: 'Client B retried with the fresh version (version 3, name `Noa B`)', hint: 'Re-read, then run step 4 with `:v` = 2.' },
    { id: 'counter', label: 'The atomic counter raised credits above 10', hint: 'Run the ADD command in step 5 at least once.' },
  ],
}
