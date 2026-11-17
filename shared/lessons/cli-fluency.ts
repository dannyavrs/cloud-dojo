import type { LessonContent } from '../types'

const LIST = 'aws s3api list-objects-v2 --bucket cli-lab'

export const cliFluency: LessonContent = {
  id: 'cli-fluency',
  n: '0.2',
  trackId: 'foundations',
  level: 'intermediate',
  prereqs: ['lift-off'],
  estMinutes: 25,
  honesty: 'live',
  examTags: ['DVA:Dev', 'DVA:Troubleshoot'],
  breakItCheck: 'quirk',
  title: 'CLI fluency: --query, --output, pagination and waiters',
  tagline: 'Read any AWS response like a pro, and know why the CLI sometimes prints None.',
  predict: [
    { id: 'p1', prompt: 'A bucket holds 2,500 objects. You run `aws s3api list-objects-v2 --bucket b` with no pagination flags. How many keys does the CLI print?', options: ['1,000: the S3 API returns at most 1,000 keys per call and the CLI stops there', 'All 2,500: the CLI paginates automatically and merges the pages', '100, the CLI default page size', 'An error telling you to pass --max-items'], answer: 1, explain: 'The AWS CLI v2 follows continuation tokens by itself and merges every page into one response. Only --no-paginate restricts you to a single API call (1,000 keys for S3).' },
    { id: 'p2', prompt: 'What is the difference between `--page-size 100` and `--max-items 100`?', options: ['They are aliases', '--page-size changes how many items each underlying API call asks for but still returns everything; --max-items stops the output after 100 items and prints a NextToken', '--page-size truncates the output, --max-items sets the request size', '--max-items only works with DynamoDB'], answer: 1, explain: '--page-size is a tuning knob for the API calls (useful when a single call times out). --max-items is a limit on the total result and gives you a NextToken to continue with --starting-token.' },
    { id: 'p3', prompt: 'You run a query that matches nothing, with `--output text`, for example `--query "Contents[?starts_with(Key, \'zzz\')].Key"`. What is printed?', options: ['Nothing, an empty line', 'The word None', 'An error: no results', '[]'], answer: 1, explain: 'A JMESPath expression that evaluates to null is rendered as None by the text formatter (and as null by --output json). Scripts that read the text output must expect it.' },
  ],
  concept: [
    "Every AWS CLI command is a thin wrapper around one API operation, and the output is that operation's JSON response. Three client-side features turn raw responses into something usable, and none of them is an AWS feature: **`--query`** (a JMESPath expression evaluated locally on the response), **`--output`** (json, yaml, text, table), and **pagination**. Because they are client-side, they behave the same on the emulator as on real AWS, and a surprising amount of DVA exam trivia (\"how do you return only the first 10 results\", \"which flag reduces the size of each call\") is just these flags.",
    "**JMESPath** is a small query language. `Contents[].Key` projects one field out of every list item; `Contents[?starts_with(Key, 'data/')]` filters a list; `Contents[].{Key:Key,Size:Size}` reshapes each item into a new object; `sort_by(Contents, &Size)[-1]` sorts and takes the last item; `length(Contents)`, `max_by`, `contains`, `ends_with` and `join` are available as functions. `--query` is evaluated against **each page the paginator produces**, so write the expression against one page's shape and be careful with aggregates: with `--page-size 2`, `length(Contents)` prints one number per page (2, 2, 1), not 5. Server-side filtering is a different thing: S3 `--prefix`, DynamoDB `--filter-expression` and EC2 `--filters` reduce what AWS sends back, `--query` only reduces what you see. On the exam, 'filter on the server to save bandwidth and cost, use --query to shape the output' is the usual correct pairing.",
    "**Pagination** is where intermediate users get bitten. List operations return at most a fixed page (1,000 keys for S3, 1 MB for DynamoDB Scan and Query, 50 to 100 for many IAM calls) plus a continuation token. The CLI follows the token for you, so by default you get everything. `--no-paginate` makes one call and silently returns only the first page. `--page-size` shrinks each call (handy when a call times out on a huge bucket) without changing the result. `--max-items` caps the **total** and adds `NextToken` to the output so you can resume with `--starting-token`. Mixing them is allowed. When the CLI paginates client-side, text output prints one line per page, JSON output concatenates list results, and a page where the expression evaluates to null prints `None` in text mode (a `NextToken` query prints `None` for every page that does not carry a token). That is the paginator `None` quirk, and it is also why `--query NextToken --output text` is not a reliable way to read the token.",
    "**Waiters** poll a describe call until a condition holds: `aws dynamodb wait table-exists`, `aws lambda wait function-active-v2`, `aws ec2 wait instance-running`. They are the right tool between a create call and the next step that needs the resource (every later module uses them). A waiter has a fixed delay and a maximum attempt count, then exits with code 255 and `Waiter ... failed`, which is how you notice a stuck resource in a script. Keep this module's habits: print one scalar with `--query ... --output text` when feeding a script, use `table` for people, `json` when another tool will parse it, and always know whether you are looking at one page or all of them.",
  ],
  goal: 'You filtered and reshaped S3 output with JMESPath, compared three pagination modes, resumed with a token, waited for a table, and produced the `None` quirk on purpose.',
  steps: [
    { id: 'shape', title: 'Look at the raw response', body: 'The fixture created bucket `cli-lab` with five objects of different sizes. Run the plain call and notice the top-level shape: `Contents` is a list, and each item has `Key`, `Size`, `ETag` and `StorageClass`. Every `--query` below is written against this shape.', commands: [LIST] },
    { id: 'project', title: 'Project and reshape', body: 'A multiselect hash `{Name:Field}` builds a new object per item. `--output table` is for humans: it draws the columns from the keys you chose.', commands: [`${LIST} --query "Contents[].{Key:Key,Size:Size}" --output table`] },
    { id: 'filter', title: 'Filter with a predicate', body: '`[?...]` keeps the items for which the expression is true. In text mode the keys come out tab separated on one line, which is exactly what a shell loop wants. (The runner rejects backticks, so numeric literals are avoided: filter on strings here.)', commands: [`${LIST} --query "Contents[?starts_with(Key, 'data/')].Key" --output text`] },
    { id: 'functions', title: 'Sort, count and pick', body: 'Functions compose with pipes. `sort_by` plus `[-1]` gives the largest object; `length` counts; `|` feeds the left result into the right expression. Compare `--output yaml`, which keeps structure but is easier to read than JSON.', commands: [`${LIST} --query "sort_by(Contents, &Size)[-1].[Key,Size]" --output text`, `${LIST} --query "Contents[?starts_with(Key, 'logs/')]|length(@)"`, `${LIST} --query "Contents[].Key" --output yaml`] },
    { id: 'pagesize', title: 'Three pagination modes, one bucket', body: 'Run all three and compare. `--page-size 2` makes three API calls but prints all five keys (as three text lines, one per page). `--no-paginate` is a single call. `--max-items 2` stops after two keys and the JSON ends with a `NextToken`.', commands: [`${LIST} --page-size 2 --query "Contents[].Key" --output text`, `${LIST} --no-paginate --query "length(Contents)"`, `${LIST} --max-items 2 --query "Contents[].Key"`] },
    { id: 'resume', title: 'Resume from a NextToken', body: 'Run the first command in JSON and copy the `NextToken` value (a long base64 string). Paste it as the `--starting-token` of the second command: you get the next two keys, not the first two again.', commands: [`${LIST} --max-items 2`, `${LIST} --max-items 2 --starting-token <NEXT_TOKEN>`] },
    { id: 'waiter', title: 'Wait for a resource', body: 'Create a table and block until it is `ACTIVE`, then read the status as a bare scalar. Then delete it and wait for it to be gone. `wait` returns silently on success.', commands: ['aws dynamodb create-table --table-name cli-orders --attribute-definitions AttributeName=id,AttributeType=S --key-schema AttributeName=id,KeyType=HASH --billing-mode PAY_PER_REQUEST', 'aws dynamodb wait table-exists --table-name cli-orders', 'aws dynamodb describe-table --table-name cli-orders --query "Table.TableStatus" --output text', 'aws dynamodb delete-table --table-name cli-orders', 'aws dynamodb wait table-not-exists --table-name cli-orders'] },
    { id: 'break', title: 'Break it: the paginator None', body: 'Same query as before, but with `--max-items 2` and text output. The keys print, and then a stray `None` line appears: the final page of the paginator has no `Contents`, so the expression is null for it.', commands: [`${LIST} --max-items 2 --query "Contents[].Key" --output text`], breakIt: true },
  ],
  breakIt: {
    title: 'A paginated text query that prints None',
    command: `${LIST} --max-items 2 --query "Contents[].Key" --output text`,
    explain: [
      'You get `data/c.csv  data/d.csv` and then a line that just says `None`. Nothing is wrong with the bucket or the call. With client-side pagination the CLI applies `--query` to every page it produces, including the last one that only carries the `NextToken`, and text output prints a null result as `None`.',
      'In scripts the fixes are: use `--no-paginate` when one page is enough, use `--output json` and parse it with `jq`, or add `| [0]`-style guards. Remember it when `--query NextToken --output text` returns `None` followed by the real token. The same behaviour exists on real AWS because it lives in the CLI, not in the service.',
    ],
  },
  realAws: {
    cost: ['The CLI is free. Every extra page is an extra API request, which S3 bills per 1,000 requests (a few cents) and which counts toward throttling limits: `--page-size` does not reduce the number of items you pay for, it increases the number of calls.', 'Waiters poll with ordinary describe calls, which are free for DynamoDB and metered for some services (each ListObjects or HeadObject call on S3 is a billed request).'],
    differences: ['Everything in this module runs in the AWS CLI itself, so it behaves the same on real AWS. The only emulator difference is the speed of `wait`: tables here become ACTIVE almost immediately, on AWS it can take several seconds to minutes depending on the service.', 'Real AWS paginates at service-specific sizes (1,000 S3 keys, 1 MB DynamoDB, 100 IAM users by default). The emulator mimics the S3 page size, so the 5-object bucket here needs `--page-size 2` to show multiple pages.', 'AWS CLI v2 also has `--cli-auto-prompt`, `aws configure`, and client-side `--cli-read-timeout`. The runner here disables interactive and profile features on purpose.'],
    asOf: '2026-11-13',
    sources: [{ label: 'AWS CLI: filtering output with --query', url: 'https://docs.aws.amazon.com/cli/latest/userguide/cli-usage-filter.html' }, { label: 'AWS CLI: pagination', url: 'https://docs.aws.amazon.com/cli/latest/userguide/cli-usage-pagination.html' }],
  },
  fidelity: [{ service: 'S3', pass: 1025, total: 1226 }, { service: 'DynamoDB', pass: 1057, total: 1481 }],
  files: [],
  checks: [
    { id: 'filter', label: 'You filtered a list with a JMESPath predicate ([?...])', hint: 'Run step 3: --query "Contents[?starts_with(Key, \'data/\')].Key".' },
    { id: 'shape', label: 'You reshaped output with a multiselect hash and a function (sort_by, length or max_by)', hint: 'Run step 2 (the {Key:Key,Size:Size} projection) and step 4.' },
    { id: 'formats', label: 'You used at least two different --output formats (table, yaml, text, json)', hint: 'Steps 2, 3 and 4 use table, text and yaml.' },
    { id: 'paginate', label: 'You ran --page-size, --no-paginate and --max-items against the same bucket', hint: 'Run the three commands of step 5.' },
    { id: 'resume', label: 'You resumed a listing with --starting-token', hint: 'Copy the NextToken from step 6, first command, into the second.' },
    { id: 'waiter', label: 'You created a table, waited for it with `wait table-exists`, and it is gone again', hint: 'Run step 7 completely: create, wait, describe, delete, wait.' },
    { id: 'quirk', label: 'You saw the paginator print None', hint: 'Run the break-it command: --max-items 2 with a text-mode --query.' },
  ],
}
