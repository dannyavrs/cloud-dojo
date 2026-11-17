import type { LessonContent } from '../types'

export const ddbQueryScan: LessonContent = {
  id: 'ddb-query-scan',
  n: '3.7',
  trackId: 'dynamodb',
  level: 'intermediate',
  prereqs: ['ddb-single-table'],
  estMinutes: 25,
  honesty: 'live',
  examTags: ['SAA:Performant', 'SAA:Cost', 'DVA:Dev'],
  breakItCheck: 'breakit',
  title: 'Query vs Scan, filters and pagination',
  tagline: 'What you pay for is what DynamoDB reads, not what it returns.',
  predict: [
    { id: 'p1', prompt: "A partition has 20 items and a FilterExpression keeps 8. How many items do you pay to read?", options: ["8, the filtered ones", "20, the filter runs after the read", "28", "It depends on the filter"], answer: 1, explain: "Filters are applied after DynamoDB reads the items matching the key condition. You are billed for the data read (ScannedCount), not for the data returned (Count)." },
    { id: 'p2', prompt: "You run a Query with --limit 5 and a filter. What does the limit apply to?", options: ["Items returned after filtering", "Items evaluated before filtering, so a page can return fewer than 5", "Pages", "The size in KB"], answer: 1, explain: "Limit caps the items DynamoDB reads per request, before the filter. A page can legitimately come back with fewer matches (even none) and still carry a LastEvaluatedKey." },
    { id: 'p3', prompt: "A Scan with a filter returns Count 8. What is ScannedCount on a 36-item table?", options: ["8", "36", "Between 8 and 36", "It depends on the sort key"], answer: 1, explain: "A Scan reads every item in the table (up to 1 MB per page), then filters. ScannedCount is the full 36." },
  ],
  concept: [
    "**Query** reads one partition (or one index partition): you give a partition key and an optional sort-key condition, DynamoDB jumps straight to that item collection and reads only the matching range. **Scan** reads every item in the table or index, in pages, and applies your filter afterwards. Query cost grows with the size of what you read from one partition. Scan cost grows with the size of the *table*. On a large table a Scan is the exam's standard wrong answer.",
    "A **FilterExpression** is easy to misunderstand. It does **not** make a Query cheaper: DynamoDB reads every item that matches the key condition, then discards the ones that fail the filter. Two numbers in the response tell the story. `ScannedCount` is how many items were read (what you pay for) and `Count` is how many survived the filter. A big gap between them means the filter is doing work the key design should have done. Put the selective attribute into the sort key or a GSI instead.",
    "**Pagination.** Every Query and Scan response is limited to 1 MB of data read, or to `--limit` items if you set it. If there is more, the response carries a `LastEvaluatedKey`. You pass that value as `--exclusive-start-key` on the next call and stop when no key comes back. The AWS CLI hides this by auto-paginating; `--no-paginate` shows you the raw page. Remember the `Limit` rule: it counts items *evaluated*, so a filtered page can be short or empty while more pages remain. Always loop until `LastEvaluatedKey` is absent.",
    "Capacity maths to carry into the exam: one read unit is a 4 KB strongly consistent read, an eventually consistent read costs half (8 KB per unit), a transactional read costs double. `--return-consumed-capacity` shows the bill per call. For key schema design the rules are: Query beats Scan, project only what you need, choose keys so that your most frequent request is a Query, and use `--select COUNT` when you only need a number.",
  ],
  goal: "You have seen a filter read more than it returned, run a Scan, paged a Query to the end with LastEvaluatedKey, tried PartiQL, and hit the reserved-keyword error.",
  steps: [
    { id: 'count', title: 'Count the books with a Query', body: "The fixture created table `Catalog` (partition key `category`, sort key `sku`) with 36 items: 20 books, 10 music, 6 games. `--select COUNT` returns only the numbers. Note that `Count` and `ScannedCount` are both 20.", commands: [`aws dynamodb query --table-name Catalog --key-condition-expression 'category = :c' --expression-attribute-values '{":c":{"S":"books"}}' --select COUNT`] },
    { id: 'filter', title: 'Add a filter and compare the numbers', body: "Books over 20 dollars. `Count` drops to 8 but `ScannedCount` is still 20: DynamoDB read all 20 books and threw 12 away. You paid for 20.", commands: [`aws dynamodb query --table-name Catalog --key-condition-expression 'category = :c' --filter-expression 'price > :p' --expression-attribute-values '{":c":{"S":"books"},":p":{"N":"20"}}' --select COUNT`] },
    { id: 'scan', title: 'Run a Scan', body: "Same filter, but no partition key: the whole table is read. `ScannedCount` is 36. At 36 items this is nothing; at 360 million it is an outage and a bill.", commands: [`aws dynamodb scan --table-name Catalog --filter-expression 'price > :p' --expression-attribute-values '{":p":{"N":"20"}}' --select COUNT`] },
    { id: 'page1', title: 'Read the first page', body: "`--limit 12` with `--no-paginate` returns one page of at most 12 items evaluated, plus a `LastEvaluatedKey` pointing at the last one read. Copy that object.", commands: [`aws dynamodb query --table-name Catalog --key-condition-expression 'category = :c' --expression-attribute-values '{":c":{"S":"books"}}' --limit 12 --no-paginate --query '{count: Count, LastEvaluatedKey: LastEvaluatedKey}'`] },
    { id: 'page2', title: 'Continue to the end', body: "Paste the key in place of `<LAST_KEY>` (single quotes around it). This is the last page: 8 items and no `LastEvaluatedKey` (it prints `null`). That is your loop's stop condition.", commands: [`aws dynamodb query --table-name Catalog --key-condition-expression 'category = :c' --expression-attribute-values '{":c":{"S":"books"}}' --limit 12 --no-paginate --exclusive-start-key '<LAST_KEY>' --query '{count: Count, LastEvaluatedKey: LastEvaluatedKey}'`] },
    { id: 'cap', title: 'See the bill', body: "`--return-consumed-capacity TOTAL` adds the read units used. Run it with and without the filter: the number does not change, which is the proof that filters do not save money.", commands: [
      `aws dynamodb query --table-name Catalog --key-condition-expression 'category = :c' --expression-attribute-values '{":c":{"S":"books"}}' --return-consumed-capacity TOTAL --select COUNT`,
      `aws dynamodb query --table-name Catalog --key-condition-expression 'category = :c' --filter-expression 'price > :p' --expression-attribute-values '{":c":{"S":"books"},":p":{"N":"20"}}' --return-consumed-capacity TOTAL --select COUNT`] },
    { id: 'partiql', title: 'The same question in PartiQL', body: "SQL-flavoured syntax over the same engine. The rules do not change: with the key in the WHERE clause it is a Query, without it a Scan.", commands: [`aws dynamodb execute-statement --statement "SELECT sku, price FROM Catalog WHERE category = 'books' AND price > 20"`] },
    { id: 'break', title: "Break it: filter on a reserved word", body: "`name` is a DynamoDB reserved word (so are `status`, `total`, `data` and hundreds more). The expression is rejected. The fix is an alias: `#n` plus `--expression-attribute-names`.", commands: [`aws dynamodb query --table-name Catalog --key-condition-expression 'category = :c' --filter-expression 'name = :n' --expression-attribute-values '{":c":{"S":"books"},":n":{"S":"Book 1"}}'`], breakIt: true },
  ],
  breakIt: {
    title: 'A reserved word in a filter expression',
    command: `aws dynamodb query --table-name Catalog --key-condition-expression 'category = :c' --filter-expression 'name = :n' --expression-attribute-values '{":c":{"S":"books"},":n":{"S":"Book 1"}}'`,
    explain: [
      "`ValidationException: Invalid FilterExpression: Attribute name is a reserved keyword; reserved keyword: name`. DynamoDB reserves a long list of words. Use an expression attribute name, `#n`, defined as `--expression-attribute-names '{\"#n\":\"name\"}'`.",
      "This catches nearly everybody. The same rule applies to key conditions, projections and update expressions, and the safe habit is to alias every attribute name you did not invent yourself.",
    ],
  },
  realAws: {
    cost: [
      "Reads are billed by data read: a strongly consistent read unit is 4 KB, an eventually consistent read is half of that. A Scan of a 1 GB table is roughly 262,144 strongly consistent read units (131,072 eventually consistent) no matter how few items the filter keeps. On-demand reads are about $0.125 per million units in us-east-1.",
      "`--select COUNT` and a `ProjectionExpression` reduce the network payload but not the read units: you pay for the items read, not the fields returned.",
    ],
    differences: [
      "On real AWS, `ConsumedCapacity` is reported for indexes and tables separately and rounds per item. Treat the emulator's figures as illustrative.",
      "Pages are capped at 1 MB of data read; with this small dataset you only hit the `--limit` boundary. The pagination contract is the same.",
      "Parallel Scan (`--segment` and `--total-segments`) exists on real AWS for faster full-table jobs.",
    ],
    asOf: '2026-11-13',
    sources: [{ label: 'Best practices for querying and scanning data', url: 'https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-query-scan.html' }, { label: 'Paginating table query results', url: 'https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.Pagination.html' }],
  },
  fidelity: [{ service: 'DynamoDB', pass: 1057, total: 1481 }],
  files: [],
  checks: [
    { id: 'seed', label: 'Table `Catalog` holds the 36 seeded items', hint: 'The fixture creates it. Press Reset module if it is missing.' },
    { id: 'filter', label: 'You saw a filter read more than it returned (ScannedCount above Count)', hint: 'Run the filtered Query in step 2 with --select COUNT.' },
    { id: 'scan', label: 'You ran a Scan that read the whole table (ScannedCount 36)', hint: 'Run step 3.' },
    { id: 'pages', label: 'You paged a Query to the end with LastEvaluatedKey and --exclusive-start-key', hint: 'Run step 4, copy the key into step 5.' },
    { id: 'partiql', label: 'You ran a PartiQL statement', hint: 'Run step 7.' },
    { id: 'breakit', label: 'You hit the reserved-keyword error', hint: 'Run the break-it command.' },
  ],
}
