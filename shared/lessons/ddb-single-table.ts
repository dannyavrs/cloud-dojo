import type { LessonContent } from '../types'

export const ddbSingleTable: LessonContent = {
  id: 'ddb-single-table',
  n: '3.2',
  trackId: 'dynamodb',
  level: 'intermediate',
  prereqs: ['dynamodb-notes'],
  estMinutes: 25,
  honesty: 'live',
  examTags: ['SAA:Performant', 'DVA:Dev'],
  breakItCheck: 'breakit',
  editable: ['seed.json'],
  title: 'Single-table design: model the access patterns first',
  tagline: 'One table, composite keys, and item collections that answer a question in a single request.',
  predict: [
    { id: 'p1', prompt: "A table holds USER#u1 items with sort keys PROFILE and ORDER#<date>#<id>. What does a Query with PK = USER#u1 and begins_with(SK, 'ORDER#') read?", options: ["Only the order items inside that one partition", "The whole table, then filters", "Every ORDER# item for all users", "Only the first order"], answer: 0, explain: "A Query always targets one partition key value. The sort-key condition narrows the read inside that item collection, so DynamoDB never touches other users." },
    { id: 'p2', prompt: "SK is ORDER#<ISO date>#<id>. How do you fetch a user's newest order with one cheap request?", options: ["Scan the table and sort in the app", "Query the same key condition with ScanIndexForward=false and Limit=1", "Add a GSI on the date", "It cannot be done without a GSI"], answer: 1, explain: "Items in a collection are stored sorted by SK. Reading backwards and stopping after one item returns the latest order and bills for one item." },
    { id: 'p3', prompt: "You Query with the key condition tier = :t, where tier is an ordinary attribute of the user profile. What happens?", options: ["Matching items are returned", "ValidationException: a key condition must name the partition key", "An empty result", "DynamoDB quietly falls back to a Scan"], answer: 1, explain: "Query needs an equality on the partition key. DynamoDB never falls back to a Scan for you, which is why access patterns drive key design." },
  ],
  concept: [
    "In a relational database you model the **data** and write queries later. In DynamoDB you do the opposite: list the **access patterns** first (\"get a user\", \"list a user's orders newest first\", \"get one product\"), then choose keys so each pattern is a single **Query** or **GetItem**. There are no joins, so related items are stored together and read together.",
    "The trick is a generic key pair. `PK` and `SK` are just strings, and you put an **entity prefix** in them: `USER#u1` / `PROFILE`, `USER#u1` / `ORDER#2026-11-05#o2`, `PRODUCT#p1` / `META`. Every item that shares a `PK` forms an **item collection**, stored together and sorted by `SK`. One Query on `PK = USER#u1` returns the profile and all orders in one round trip. Add `begins_with(SK, 'ORDER#')` and you get only the orders.",
    "Because the sort key starts with an ISO date, **chronological order is free**. `ScanIndexForward=false` plus `Limit=1` is the newest order, and `SK BETWEEN` gives a date range. Choosing a sort key that sorts the way you want to read is the central skill of this module.",
    "The cost of this design is rigidity. A Query must name the partition key, so a question you did not design for (\"all users on the pro tier\") needs either a **GSI** (next module) or a Scan. Single-table design is a bet that you know your access patterns, and that is exactly the trade the SAA and DVA exams test: pick keys for the dominant pattern, spread load across many partition key values, and never plan around Scan.",
  ],
  goal: "Table `Shop` loaded with the seed data, and you have read one user's orders, the whole item collection, and the newest order, each with a single Query.",
  steps: [
    { id: 'layout', title: 'Read the key layout', body: "The fixture created an empty on-demand table `Shop` with a string `PK` and string `SK`. Open `seed.json` in Files: eight items follow this layout. Notice that the entity type lives in the key values, not in the key names.", code: { file: 'key layout', text: "PK            SK                         what it is\nUSER#u1       PROFILE                    the user\nUSER#u1       ORDER#2026-11-01#o1        an order (date sorts first)\nUSER#u1       ORDER#2026-11-05#o2\nUSER#u1       ORDER#2026-11-09#o3\nUSER#u2       PROFILE\nUSER#u2       ORDER#2026-11-02#o4\nPRODUCT#p1    META                       a product\nPRODUCT#p2    META" } },
    { id: 'load', title: 'Load the data with one batch write', body: "`batch-write-item` sends up to 25 puts or deletes in one call, with no transaction guarantees. Check that `UnprocessedItems` is empty: on real AWS a throttled batch returns the leftovers there and your code must retry them.", commands: [`aws dynamodb batch-write-item --request-items file://seed.json`] },
    { id: 'orders', title: "Query one user's orders", body: "Equality on the partition key, prefix on the sort key. Three items, in sort-key order, from one partition.", commands: [`aws dynamodb query --table-name Shop --key-condition-expression 'PK = :p AND begins_with(SK, :o)' --expression-attribute-values '{":p":{"S":"USER#u1"},":o":{"S":"ORDER#"}}' --query 'Items[].SK.S'`] },
    { id: 'collection', title: 'Read the whole item collection', body: "Drop the sort-key condition and you get the profile and every order in one request. This is the single-table payoff: what would be two queries or a join elsewhere. `PROFILE` sorts after `ORDER#` alphabetically.", commands: [`aws dynamodb query --table-name Shop --key-condition-expression 'PK = :p' --expression-attribute-values '{":p":{"S":"USER#u1"}}' --query 'Items[].SK.S'`] },
    { id: 'newest', title: 'Newest order in one read', body: "`--no-scan-index-forward` reads the collection backwards and `--limit 1` stops after one item. You are billed for one item, not three. The answer is `o3`.", commands: [`aws dynamodb query --table-name Shop --key-condition-expression 'PK = :p AND begins_with(SK, :o)' --expression-attribute-values '{":p":{"S":"USER#u1"},":o":{"S":"ORDER#"}}' --no-scan-index-forward --limit 1 --query 'Items[].SK.S'`] },
    { id: 'break', title: "Break it: ask a question the keys were not designed for", body: "\"Which users are on the pro tier?\" filters on an ordinary attribute with no partition key. DynamoDB refuses rather than scanning for you.", commands: [`aws dynamodb query --table-name Shop --key-condition-expression 'tier = :t' --expression-attribute-values '{":t":{"S":"pro"}}'`], breakIt: true },
    { id: 'think', title: 'Think: how would you answer it?', body: "Two honest answers: a **GSI** keyed on `tier` (module 3.3), or a Scan with a filter, which reads every item and is the wrong tool at scale. Edit `seed.json`, add an item for `USER#u2` with a new order and re-run the load if you want to see the collection grow." },
  ],
  breakIt: {
    title: 'Query on a non-key attribute',
    command: `aws dynamodb query --table-name Shop --key-condition-expression 'tier = :t' --expression-attribute-values '{":t":{"S":"pro"}}'`,
    explain: [
      "`ValidationException: Query condition missed key schema element: PK`. A Query requires an equality condition on the partition key. There is no index on `status`, so the only ways to answer the question are a Scan (read everything) or a new access path, a GSI.",
      "That error is the whole point of single-table design: the keys you pick now decide which questions are cheap later. If you find yourself wanting a Scan in production, the key design is usually missing an access pattern.",
    ],
  },
  realAws: {
    cost: [
      "On-demand pricing (us-east-1, from the AWS on-demand pricing page): about $0.625 per million write request units and $0.125 per million read request units. One write unit covers up to 1 KB, one eventually consistent read unit covers up to 8 KB (a strongly consistent read of 4 KB costs a full unit).",
      "A Query bills for the total size of the items it reads, rounded up, not per item returned. Reading the newest order with Limit 1 is much cheaper than reading the whole collection and sorting in the app.",
    ],
    differences: [
      "A single item collection is capped at about 3,000 read units and 1,000 write units per second per partition on real AWS. A hot partition key (everything under one `PK`) throttles, so spread keys across many values.",
      "Real DynamoDB can return `UnprocessedItems` and throttle batches under load. The emulator accepts the whole batch.",
      "Item size limit is 400 KB on both. Key design guidance (prefixes, composite sort keys) is identical.",
    ],
    asOf: '2026-11-13',
    sources: [{ label: 'Best practices for designing and using partition keys', url: 'https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html' }, { label: 'DynamoDB on-demand pricing', url: 'https://aws.amazon.com/dynamodb/pricing/on-demand/' }],
  },
  fidelity: [{ service: 'DynamoDB', pass: 1057, total: 1481 }],
  files: ['seed.json'],
  checks: [
    { id: 'table', label: 'Table `Shop` is ACTIVE with PK (HASH) and SK (RANGE)', hint: 'The fixture creates it. Press Reset module if it is missing.' },
    { id: 'seeded', label: 'The seed data is loaded (8 items)', hint: 'Run the batch-write-item command from step 2.' },
    { id: 'orders', label: "You queried one user's orders with begins_with on the sort key", hint: 'Run the begins_with query from step 3.' },
    { id: 'collection', label: 'You read the whole item collection (profile and orders) in one query', hint: 'Run the query without a sort-key condition (step 4).' },
    { id: 'newest', label: 'You fetched the newest order with --no-scan-index-forward and --limit 1', hint: 'Run step 5 and look for o3.' },
    { id: 'breakit', label: 'You saw the ValidationException on a non-key query', hint: 'Run the break-it command.' },
  ],
}
