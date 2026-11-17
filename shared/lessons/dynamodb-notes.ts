import type { LessonContent } from '../types'

export const dynamodbNotes: LessonContent = {
  id: 'dynamodb-notes',
  n: '3.1',
  trackId: 'dynamodb',
  level: 'core',
  prereqs: [],
  estMinutes: 15,
  honesty: 'live',
  examTags: ["SAA:Performant", "DVA:Dev"],
  predict: [{"id": "p1", "prompt": "`put-item` with `attribute_not_exists(pk)` targets a key that already exists. What happens?", "options": ["The item is overwritten", "The write is rejected with ConditionalCheckFailedException and the item is unchanged", "DynamoDB merges the attributes", "The write succeeds but consumes extra capacity"], "answer": 1, "explain": "The condition is evaluated atomically before the write. When it is false nothing changes and you get ConditionalCheckFailedException."}],
  breakItCheck: 'cond',

  title: 'DynamoDB: keys, queries, conditional writes',
  tagline: 'Model a Notes table, query it, and stop a write from clobbering another.',
  concept: [
    'DynamoDB is a key-value and document database with no servers to size. Every table has a **primary key**: a **partition key** (`pk`, decides where the item lives) and optionally a **sort key** (`sk`, orders items inside a partition). You can only fetch efficiently by key, so you design keys around your questions: here, "all notes for one user".',
    '**On-demand** billing (`PAY_PER_REQUEST`) means you pay per read and write, with no capacity to plan. Tables are created asynchronously: they sit in `CREATING` and become `ACTIVE`. Scripts must wait.',
    'A **condition expression** makes a write conditional. `attribute_not_exists(pk)` means "only if this item is new", which is how you avoid overwriting someone else\'s data.',
  ],
  goal: 'An ACTIVE on-demand table `Notes` (pk + sk) with three items, a query that returns one user\'s notes, and a refused duplicate write.',
  steps: [
    { id: 'create', title: 'Create the table', body: 'Two key attributes, both strings, on-demand billing.', commands: ['aws dynamodb create-table --table-name Notes --attribute-definitions AttributeName=pk,AttributeType=S AttributeName=sk,AttributeType=S --key-schema AttributeName=pk,KeyType=HASH AttributeName=sk,KeyType=RANGE --billing-mode PAY_PER_REQUEST'] },
    { id: 'wait', title: 'Wait for ACTIVE', body: 'Do not write before the table is ready. The CLI has a built-in waiter.', commands: ['aws dynamodb wait table-exists --table-name Notes'] },
    { id: 'put', title: 'Write three notes', body: 'Two for Danny, one for Sam. The `S` means string.', commands: [
      `aws dynamodb put-item --table-name Notes --item '{"pk":{"S":"user#danny"},"sk":{"S":"note#001"},"text":{"S":"learn IAM"}}'`,
      `aws dynamodb put-item --table-name Notes --item '{"pk":{"S":"user#danny"},"sk":{"S":"note#002"},"text":{"S":"learn S3"}}'`,
      `aws dynamodb put-item --table-name Notes --item '{"pk":{"S":"user#sam"},"sk":{"S":"note#001"},"text":{"S":"hello"}}'`] },
    { id: 'query', title: 'Query one partition', body: 'Returns only Danny\'s two notes, in sort-key order. A `scan` would read everything.', commands: [`aws dynamodb query --table-name Notes --key-condition-expression "pk = :p" --expression-attribute-values '{":p":{"S":"user#danny"}}' --query 'Items[].text.S'`] },
    { id: 'break', title: 'Break it: overwrite Danny\'s first note', body: 'A plain put-item replaces silently. A conditional one refuses.', commands: [`aws dynamodb put-item --table-name Notes --item '{"pk":{"S":"user#danny"},"sk":{"S":"note#001"},"text":{"S":"overwritten!"}}' --condition-expression "attribute_not_exists(pk)"`], breakIt: true },
  ],
  breakIt: {
    title: 'A conditional put on an item that already exists',
    command: `aws dynamodb put-item --table-name Notes --item '{"pk":{"S":"user#danny"},"sk":{"S":"note#001"},"text":{"S":"overwritten!"}}' --condition-expression "attribute_not_exists(pk)"`,
    explain: [
      '`ConditionalCheckFailedException`: the item already exists, so "only if new" is false and nothing was written. That is DynamoDB\'s optimistic locking and idempotency tool.',
      'Optional extra: run a `put-item` immediately after `create-table` (before the wait) in a loop and you can catch `ResourceNotFoundException` or `ResourceInUseException` while the table is still CREATING. It is timing-dependent, which is exactly why waiters exist.',
    ],
  },
  realAws: {
    cost: [
      'On-demand writes cost $0.625 per million write request units and reads $0.125 per million read request units (figures taken from AWS\'s worked examples on the on-demand pricing page, us-east-1).',
      'The always-free tier covers 25 GB storage and provisioned capacity; it does not offset on-demand request charges.',
    ],
    differences: [
      'A real table also has capacity modes, indexes (GSIs), TTL, streams and point-in-time recovery. Only the basics are modeled here.',
      'Real AWS may take longer to reach ACTIVE; the emulator models the CREATING to ACTIVE step but quickly.',
    ],
    asOf: '2026-11-13',
    sources: [{ label: 'DynamoDB on-demand pricing', url: 'https://aws.amazon.com/dynamodb/pricing/on-demand/' }, { label: 'Condition expressions', url: 'https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html' }],
  },
  fidelity: [{ service: 'DynamoDB', pass: 1057, total: 1481 }],
  files: [],
  checks: [
    { id: 'active', label: 'Table `Notes` is ACTIVE', hint: 'Create it (step 1) and wait (step 2).' },
    { id: 'keys', label: 'Key schema is pk (HASH) + sk (RANGE)', hint: 'Use both --key-schema entries from step 1.' },
    { id: 'ondemand', label: 'Billing mode is on-demand (PAY_PER_REQUEST)', hint: 'Add --billing-mode PAY_PER_REQUEST.' },
    { id: 'items', label: 'At least 3 items, with 2 under the same pk', hint: 'Run the three put-item commands.' },
    { id: 'cond', label: 'You saw ConditionalCheckFailedException on purpose', hint: 'Run the break-it command.' },
  ],
}
