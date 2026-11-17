import type { LessonContent } from '../types'

export const ddbIndexes: LessonContent = {
  id: 'ddb-indexes',
  n: '3.3',
  trackId: 'dynamodb',
  level: 'intermediate',
  prereqs: ['ddb-single-table'],
  estMinutes: 30,
  honesty: 'live',
  examTags: ['SAA:Performant', 'DVA:Dev'],
  breakItCheck: 'breakit',
  editable: ['table.json', 'items.json'],
  title: 'GSIs and LSIs: alternate access patterns',
  tagline: 'Same data, a second sort order, a different partition key, and the rules that bite on the exam.',
  predict: [
    { id: 'p1', prompt: "You forgot a Local Secondary Index when you created a table. Can you add one later with update-table?", options: ["Yes, same as a GSI", "No: an LSI can only be defined when the table is created", "Yes, but only on empty tables", "Yes, but only for on-demand tables"], answer: 1, explain: "LSIs share the base table's partition and must be declared at creation. A GSI can be added or removed at any time." },
    { id: 'p2', prompt: "You run a Query on a GSI with --consistent-read. What happens?", options: ["You get a strongly consistent result", "ValidationException: consistent reads are not supported on global secondary indexes", "It silently reads eventually consistently", "It reads the base table instead"], answer: 1, explain: "GSIs are updated asynchronously, so they can only be read eventually consistently. LSIs allow strong consistency." },
    { id: 'p3', prompt: "A new GSI is keyed on `priority`, and only 2 of 8 existing items have that attribute. How many items are in the index once it is ACTIVE?", options: ["8", "2", "0 until you rewrite the items", "6"], answer: 1, explain: "Items missing the index key attribute are not projected into the index. That is a sparse index, and existing items are backfilled automatically when the GSI is created." },
  ],
  concept: [
    "A table's primary key gives you exactly one fast access path. **Secondary indexes** add more. An index is a second copy of some of your data, stored under a different key and kept up to date by DynamoDB. You query it with `--index-name`, exactly like a table.",
    "A **Global Secondary Index (GSI)** has its own partition key and optional sort key, and spans all partitions. It can be added or deleted at any time (DynamoDB backfills it), has its own throughput, and is **eventually consistent**: a write to the table reaches the GSI a moment later, and strongly consistent reads are rejected. A **Local Secondary Index (LSI)** keeps the table's partition key but gives you a different **sort key**, so you can sort one partition two ways. It must be defined at table creation, supports strong consistency, and caps an item collection at 10 GB.",
    "What goes into the index is the **projection**: `KEYS_ONLY` (smallest and cheapest, you must fetch the item for anything else), `INCLUDE` (named attributes), or `ALL`. A narrow projection saves storage and write cost, because every table write that touches projected attributes is also a write to each affected index.",
    "Indexes can be **sparse**. An item appears in a GSI only if it has the index key attributes. Putting `priority` on just the urgent orders gives you a tiny index of exactly those, a cheap way to answer \"what needs attention\" without scanning. In this module you create a table with both index types from a JSON file, query each, add a GSI to a live table, and see the consistency rule fail.",
  ],
  goal: "Table `Orders` with GSI `ByStatus` and LSI `ByAmount`, queried through both, plus a sparse GSI `ByPriority` added later.",
  steps: [
    { id: 'read', title: 'Read table.json', body: "Open `table.json` in Files. It defines `Orders` (partition key `customerId`, sort key `orderTs`) and a GSI `ByStatus` (`status` + `orderTs`). It is missing the LSI. You will add it in the editor. Both `status` and `amount` are already declared in `AttributeDefinitions`: every attribute used as an index key must be declared." },
    { id: 'edit', title: 'Add the LSI in the editor', body: "Open `table.json` and add this block next to `GlobalSecondaryIndexes` (mind the comma), then press Save. An LSI reuses the table's partition key `customerId` and sorts by `amount`. `KEYS_ONLY` keeps it small.", code: { file: 'table.json', text: `"LocalSecondaryIndexes": [{\n  "IndexName": "ByAmount",\n  "KeySchema": [\n    {"AttributeName": "customerId", "KeyType": "HASH"},\n    {"AttributeName": "amount", "KeyType": "RANGE"}\n  ],\n  "Projection": {"ProjectionType": "KEYS_ONLY"}\n}]` } },
    { id: 'create', title: 'Create the table and wait for ACTIVE', body: "`--cli-input-json` reads the whole request from the file. If you created the table without the LSI by mistake, you cannot add it afterwards: `delete-table`, fix the file and create again.", commands: [`aws dynamodb create-table --cli-input-json file://table.json`, `aws dynamodb wait table-exists --table-name Orders`] },
    { id: 'load', title: 'Load eight orders', body: "Orders for three customers, with statuses and amounts. Two carry a `priority` attribute (remember that for later).", commands: [`aws dynamodb batch-write-item --request-items file://items.json`] },
    { id: 'gsi', title: 'Query the GSI: open orders across all customers', body: "This is the question the base table could not answer. `ByStatus` is partitioned by `status` and sorted by `orderTs`, so the four open orders come back in time order, whoever owns them.", commands: [`aws dynamodb query --table-name Orders --index-name ByStatus --key-condition-expression '#s = :s' --expression-attribute-names '{"#s":"status"}' --expression-attribute-values '{":s":{"S":"open"}}' --query 'Items[].[customerId.S,orderTs.S,amount.N]' --output text`] },
    { id: 'lsi', title: "Query the LSI: one customer's big orders", body: "Same partition (`customerId = c1`), different sort key. The projection is `KEYS_ONLY`, so the output has the table keys and `amount` but not `status`: fetching the rest would take a second read.", commands: [`aws dynamodb query --table-name Orders --index-name ByAmount --key-condition-expression 'customerId = :c AND amount > :a' --expression-attribute-values '{":c":{"S":"c1"},":a":{"N":"50"}}'`] },
    { id: 'late', title: 'Add a sparse GSI to the live table', body: "A GSI can be added to a running table. DynamoDB backfills it from existing items; only the two with `priority` qualify. Wait for the index to become ACTIVE, then query it: you get two items, not eight.", commands: [
      `aws dynamodb update-table --table-name Orders --attribute-definitions AttributeName=priority,AttributeType=S AttributeName=orderTs,AttributeType=S --global-secondary-index-updates '[{"Create":{"IndexName":"ByPriority","KeySchema":[{"AttributeName":"priority","KeyType":"HASH"},{"AttributeName":"orderTs","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}}]'`,
      `aws dynamodb describe-table --table-name Orders --query 'Table.GlobalSecondaryIndexes[].[IndexName,IndexStatus]' --output text`,
      `aws dynamodb query --table-name Orders --index-name ByPriority --key-condition-expression 'priority = :p' --expression-attribute-values '{":p":{"S":"high"}}' --query 'Items[].[customerId.S,orderTs.S]' --output text`] },
    { id: 'break', title: 'Break it: strongly consistent read on a GSI', body: "GSIs are replicated asynchronously, so they cannot promise the latest write.", commands: [`aws dynamodb query --table-name Orders --index-name ByStatus --consistent-read --key-condition-expression '#s = :s' --expression-attribute-names '{"#s":"status"}' --expression-attribute-values '{":s":{"S":"open"}}'`], breakIt: true },
  ],
  breakIt: {
    title: 'Consistent read against a global secondary index',
    command: `aws dynamodb query --table-name Orders --index-name ByStatus --consistent-read --key-condition-expression '#s = :s' --expression-attribute-names '{"#s":"status"}' --expression-attribute-values '{":s":{"S":"open"}}'`,
    explain: [
      "`ValidationException: Consistent reads are not supported on global secondary indexes`. A GSI is a separate structure fed by an asynchronous stream of table changes, so it may lag by a moment. Only the base table and LSIs can be read with `ConsistentRead=true`.",
      "Exam rule of thumb: need strong consistency on an alternate sort order and you can plan ahead, use an LSI. Need a different partition key, or you are adding the index later, use a GSI and accept eventual consistency.",
    ],
  },
  realAws: {
    cost: [
      "Every write to the table that changes an indexed or projected attribute also writes to each affected index, and you pay write units for the index as well. Three indexes can mean roughly four times the write cost, so project only what you read.",
      "GSIs have their own storage and (in provisioned mode) their own throughput. In on-demand mode they bill as requests like the table. LSI data counts toward the table's partition, and a collection with an LSI is limited to 10 GB.",
    ],
    differences: [
      "You may create up to 20 GSIs and 5 LSIs per table on real AWS (default quotas, check the Service Quotas page).",
      "Real AWS backfills a new GSI over minutes to hours for large tables, and the table stays available. Here it finishes almost immediately.",
      "On real AWS, a throttled GSI can throttle writes to the base table. That back-pressure is not modeled in the emulator.",
    ],
    asOf: '2026-11-13',
    sources: [{ label: 'Improving data access with secondary indexes', url: 'https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/SecondaryIndexes.html' }, { label: 'DynamoDB on-demand pricing', url: 'https://aws.amazon.com/dynamodb/pricing/on-demand/' }],
  },
  fidelity: [{ service: 'DynamoDB', pass: 1057, total: 1481 }],
  files: ['table.json', 'items.json'],
  checks: [
    { id: 'table', label: 'Table `Orders` is ACTIVE with GSI `ByStatus` and LSI `ByAmount`', hint: 'Add the LSI block to table.json, then create the table. An LSI cannot be added later: delete-table and recreate if needed.' },
    { id: 'items', label: 'The eight orders are loaded', hint: 'Run batch-write-item with items.json.' },
    { id: 'gsi', label: 'You queried the GSI `ByStatus`', hint: 'Run step 5 (--index-name ByStatus).' },
    { id: 'lsi', label: 'You queried the LSI `ByAmount` for one customer', hint: 'Run step 6 (--index-name ByAmount).' },
    { id: 'late', label: 'GSI `ByPriority` was added to the live table, is ACTIVE and you queried it', hint: 'Run the three commands in step 7.' },
    { id: 'breakit', label: 'You saw consistent reads refused on a GSI', hint: 'Run the break-it command.' },
  ],
}
