import type { LessonContent } from '../types'

const GROUP = '/dojo/checkout'

export const cwLogsInsights: LessonContent = {
  id: 'cw-logs-insights',
  n: '10.3',
  trackId: 'cloudwatch',
  level: 'intermediate',
  prereqs: ['cw-metrics', 'lambda-config-errors'],
  estMinutes: 30,
  honesty: 'simulated',
  requires: ['cw-metric-filter-emits', 'cw-insights-rows'],
  honestyNote: 'Retention and metric-filter configuration are stored faithfully. Whether a filter really emits metric data and whether Logs Insights returns real rows is probed on every emulator image: the badge reads Live while both probes pass (they did on 1.0.341) and falls back to Simulated if an update breaks either.',
  examTags: ['SAA:Cost', 'SAA:Performant', 'DVA:Troubleshoot'],
  breakItCheck: 'breakit',
  editable: ['events.json', 'query.json', 'window.json'],
  title: 'Logs: retention, metric filters and Insights queries',
  tagline: 'Turn a pile of log lines into a metric you can alarm on, and ask the logs questions.',
  predict: [
    { id: 'p1', prompt: "A log group already holds 100 lines containing `ERROR`. You now create a metric filter for `\"ERROR\"` on it. Five new ERROR lines arrive afterwards. How many does the metric count?", options: ['105: filters scan the whole log group', '100: only the old lines are counted', '5: a filter only evaluates events ingested after it exists', '0: filters only work on Lambda log groups'], answer: 2, explain: "A metric filter is applied to events as they are ingested. It never goes back over stored data, so the history of a log group cannot be turned into metric data after the fact. To analyse history use a Logs Insights query, and create the filter before the problem you want to count." },
    { id: 'p2', prompt: "You create a new log group and change nothing. What is its retention?", options: ['7 days', '30 days', '90 days', 'Never expire'], answer: 3, explain: "New log groups keep events forever. Storage is billed per GB-month, so a chatty service quietly accumulates cost and old data you may not be allowed to keep. Setting a retention period per log group (1 day up to 10 years) is the cheapest cost control in CloudWatch, and the first thing an exam question about 'reducing log storage cost' expects." },
    { id: 'p3', prompt: "You need 'the five customers with the most 500 errors in the last week' from JSON application logs. Which tool answers it?", options: ['A metric filter with a dimension per customer', 'A Logs Insights query using stats count(*) by customerId, sort and limit', 'A CloudWatch alarm on the error count', 'A subscription filter to Kinesis'], answer: 1, explain: "Logs Insights is for ad hoc questions over stored logs: `filter status = 500 | stats count(*) as errors by customerId | sort errors desc | limit 5`. A metric filter would create one billable custom metric per customer, which is the high-cardinality trap from module 10.1, and it cannot look at history. Alarms and subscription filters work on new data." },
  ],
  concept: [
    "CloudWatch Logs organises data in **log groups** (one per application or Lambda function, named like `/aws/lambda/<function>`), each holding **log streams** (one per source, such as a container or a function instance), each holding timestamped **events**. Three settings matter at group level: **retention** (default: never expire), the optional KMS key, and the **log class**. Applications write with `PutLogEvents`; Lambda, API Gateway, ECS and others write through their own integration, which is why the execution role needs `logs:CreateLogGroup`, `logs:CreateLogStream` and `logs:PutLogEvents`. Events are plain text, and structured JSON is far more useful because everything downstream can read the fields.",
    "A **metric filter** watches a log group and converts matching events into custom metric data. The **filter pattern** is a term match (`ERROR`, or `\"ERROR\"` to match the exact quoted string; matching is case-sensitive), an OR of terms (`?ERROR ?FATAL`), a JSON expression (`{ $.latencyMs > 500 }`), or a space-delimited pattern for access logs. The **transformation** names the metric (name, namespace, optional dimensions taken from JSON fields), and the value is a constant such as `1` or a field such as `$.bytes`. Optionally a `defaultValue` of 0 fills the periods with no matches so an alarm does not drown in missing data. The limits to remember: a filter only sees events that arrive after it is created, there are at most 100 filters per log group, and metric data appears within about a minute of the events on AWS.",
    "**Logs Insights** is the query side. A query is a pipe of commands over one or more log groups and a time range: `fields @timestamp, @message`, `filter @message like /ERROR/`, `parse @message \"order * *\" as id, reason`, `stats count(*) as errors by bin(5m)`, `sort`, `limit`, `dedup`. JSON fields are discovered automatically, so `filter status = 500` just works. Queries are asynchronous: `start-query` returns a `queryId`, and `get-query-results` returns `Running`, `Complete`, `Failed` or `Cancelled` with rows of `field`/`value` pairs, and statistics on how much data was scanned. Rows from a plain `fields` query carry a `@ptr` you can pass to `get-log-record`; aggregated `stats` rows do not. Other exits for logs: **subscription filters** stream events in real time to Lambda, Kinesis Data Streams or Data Firehose (at most two per group), and export tasks copy a time range to S3.",
    "Cost and design traps. Logs are billed three ways: **ingestion** per GB (usually the largest part, and the reason to log less and to stop debug logging in production), **storage** per GB-month (the reason for retention), and **Insights** per GB scanned (the reason to narrow the time range and the log groups of every query). Metric filters are the cheap way to alarm on a log pattern, and EMF (module 10.1) is the way to avoid logs-to-metrics entirely. In this module the fixture gives you the log group `/dojo/checkout` with five past events. You set retention, test a pattern, see why a wrong-case pattern silently matches nothing, create a filter, write new events and read the resulting metric, then query the logs with Insights, including an aggregate. The runner has no shell, so epoch times live in `window.json` and `query.json`, read with `--cli-input-json`.",
  ],
  goal: "You can bound a log group's cost with retention, turn a log pattern into a metric, and answer questions with a Logs Insights query.",
  steps: [
    { id: 'look', title: 'Look at the log group', body: "The fixture wrote five past events (two of them ERROR) into `/dojo/checkout`. Look at the group's settings, then search it. Note `retentionInDays` is missing: the group never expires.", commands: [`aws logs describe-log-groups --log-group-name-prefix /dojo`, `aws logs filter-log-events --log-group-name ${GROUP} --filter-pattern ERROR --query 'events[].message'`] },
    { id: 'retention', title: 'Set retention to 7 days', body: "One command caps the storage bill for this group. Events older than 7 days are deleted for you. Confirm with `describe-log-groups`.", commands: [`aws logs put-retention-policy --log-group-name ${GROUP} --retention-in-days 7`, `aws logs describe-log-groups --log-group-name-prefix /dojo --query 'logGroups[].[logGroupName,retentionInDays]'`] },
    { id: 'test', title: 'Test a filter pattern before using it', body: "`test-metric-filter` runs a pattern against sample messages and shows which match, with nothing stored. Use it to iterate on patterns. Here `\"ERROR\"` matches the first message and not the second.", commands: [`aws logs test-metric-filter --filter-pattern '"ERROR"' --log-event-messages 'ERROR payment declined' 'INFO order placed'`] },
    { id: 'break', title: 'Break it: the case-sensitive pattern', body: "Same message, lower-case pattern. `matches` comes back **empty**: patterns are case-sensitive, and a filter built this way would be created happily and never emit a single datapoint.", commands: [`aws logs test-metric-filter --filter-pattern '"error"' --log-event-messages 'ERROR payment declined'`], breakIt: true },
    { id: 'filter', title: 'Create the metric filter', body: "Turn every ERROR line into one datapoint of `Dojo/CheckoutErrors`. Then read the metric: it is **empty**, even though the group holds two old ERROR lines. The filter only sees events ingested from now on. (`window.json` holds the time window, as in module 10.1.)", commands: [`aws logs put-metric-filter --log-group-name ${GROUP} --filter-name errors --filter-pattern '"ERROR"' --metric-transformations metricName=CheckoutErrors,metricNamespace=Dojo,metricValue=1`, `aws cloudwatch get-metric-statistics --cli-input-json file://window.json --namespace Dojo --metric-name CheckoutErrors --statistics Sum`] },
    { id: 'emit', title: 'Write new events and watch the metric appear', body: "`events.json` holds six new events (three ERROR). Write them to the stream, then read the metric again: **Sum 3**. If the list is still empty, wait a couple of seconds and repeat (real AWS takes up to about a minute). This metric can now drive an alarm exactly like the ones in 10.2.", commands: [`aws logs put-log-events --log-group-name ${GROUP} --log-stream-name web-1 --log-events file://events.json`, `aws cloudwatch get-metric-statistics --cli-input-json file://window.json --namespace Dojo --metric-name CheckoutErrors --statistics Sum`] },
    { id: 'insights', title: 'Ask the logs a question with Insights', body: "`query.json` holds the log group, the epoch time range and a query that finds ERROR lines, newest first. Start it, copy the `queryId` from the output, and fetch the results. The status goes from Running to **Complete**. This query sees **all** the events, old and new, which a metric filter never could: expect five ERROR rows.", commands: ['aws logs start-query --cli-input-json file://query.json', 'aws logs get-query-results --query-id <QUERY_ID>'] },
    { id: 'stats', title: 'Aggregate with stats', body: "Override the query string to count events in five-minute bins. `stats` rows have no `@ptr`, they hold just the grouped values. Copy the new `queryId` into the second command. Edit `query.json` and try `parse` or a different `filter`.", commands: ["aws logs start-query --cli-input-json file://query.json --query-string 'stats count(*) as events by bin(5m)'", 'aws logs get-query-results --query-id <QUERY_ID>'] },
  ],
  breakIt: {
    title: 'A filter that can never match',
    command: `aws logs test-metric-filter --filter-pattern '"error"' --log-event-messages 'ERROR payment declined'`,
    explain: [
      "`\"error\"` and `\"ERROR\"` are different patterns. `put-metric-filter` would accept either and report success, so the first sign of the mistake is a metric that stays empty, and an alarm on it sitting in INSUFFICIENT_DATA or, with `notBreaching`, a comforting OK.",
      "Always run `test-metric-filter` on real sample lines first, and keep a few lines from production in the test. For JSON logs prefer `{ $.level = \"ERROR\" }`, where the field name is part of the pattern.",
    ],
  },
  realAws: {
    cost: [
      "CloudWatch Logs is billed on ingestion (roughly $0.50 per GB in us-east-1 for the standard class), storage (roughly $0.03 per GB-month) and Logs Insights queries (roughly $0.005 per GB scanned). Check the pricing page for the current numbers, and for the cheaper Infrequent Access class.",
      "Retention and log-level discipline are the real controls: a 7-day retention on a debug-heavy service can be the difference between a small and a large bill. Each metric a filter creates is an ordinary custom metric and is billed as one.",
    ],
    differences: [
      "Real metric filters publish within about a minute of ingestion. The emulator produced the metric within a second or two of the write.",
      "The emulator ran every Insights query written for this module (fields, filter with regex, parse, stats with bin, sort, limit). That is not the full language, so a function that works on AWS may not work here, and the reverse is not guaranteed either.",
      "Real Insights can query up to 50 log groups in one go, runs for at most 60 minutes, returns at most 10,000 rows (default 1,000) and bills by data scanned. Scanned-bytes statistics here are just a count of the emulator's stored events.",
      "Direct Lambda invocations in the emulator do not create a log group, so this module writes events itself with `put-log-events`. On AWS the Lambda service creates `/aws/lambda/<function>` and fills it.",
    ],
    asOf: '2026-11-15',
    sources: [
      { label: 'Filter and pattern syntax for metric filters', url: 'https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/FilterAndPatternSyntax.html' },
      { label: 'CloudWatch Logs Insights query syntax', url: 'https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CWL_QuerySyntax.html' },
      { label: 'Working with log groups and log streams (retention)', url: 'https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/Working-with-log-groups-and-streams.html' },
      { label: 'Amazon CloudWatch pricing', url: 'https://aws.amazon.com/cloudwatch/pricing/' },
    ],
  },
  fidelity: [{ service: 'CloudWatch Logs', pass: 487, total: 643 }, { service: 'CloudWatch', pass: 645, total: 848 }],
  files: ['window.json', 'events.json', 'query.json'],
  checks: [
    { id: 'retention', label: 'The log group keeps events for 7 days', hint: 'Run `put-retention-policy` with `--retention-in-days 7`.' },
    { id: 'breakit', label: 'You saw a lower-case pattern match nothing', hint: 'Run the `test-metric-filter` command with `"error"` and read the empty matches list.' },
    { id: 'filter', label: 'A metric filter on "ERROR" writes Dojo/CheckoutErrors', hint: 'Create it with `put-metric-filter` and `metricName=CheckoutErrors,metricNamespace=Dojo,metricValue=1`.' },
    { id: 'emits', label: 'Your new ERROR events became metric data (Sum above 0)', hint: 'Write `events.json` with `put-log-events` after the filter exists, then wait a moment.' },
    { id: 'insights', label: 'An Insights query completed and returned log rows', hint: 'Run `start-query`, then `get-query-results` with the queryId until the status is Complete.' },
    { id: 'stats', label: 'A stats query returned aggregated rows', hint: 'Start the query with `--query-string \'stats count(*) as events by bin(5m)\'` and fetch its results.' },
  ],
}
