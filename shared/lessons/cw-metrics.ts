import type { LessonContent } from '../types'

export const cwMetrics: LessonContent = {
  id: 'cw-metrics',
  n: '10.1',
  trackId: 'cloudwatch',
  level: 'intermediate',
  prereqs: ['lambda-config-errors'],
  estMinutes: 25,
  honesty: 'live',
  honestyNote: 'The emulator stores and aggregates custom metrics for real: namespaces, dimensions, statistics, percentiles, metric math, and the same input validation AWS applies to PutMetricData.',
  examTags: ['SAA:Performant', 'SAA:Cost', 'DVA:Troubleshoot'],
  breakItCheck: 'breakit',
  editable: ['metric-data.json', 'queries.json', 'window.json'],
  title: 'Custom metrics and statistics: publish, slice, read back',
  tagline: 'Publish your own numbers, then learn why the same name with different dimensions is a different metric.',
  predict: [
    { id: 'p1', prompt: "You publish `Errors = 5` to namespace `Dojo` with no dimensions, then publish `Errors = 2` with the dimension `Service=checkout`. You query `get-metric-statistics` for `Dojo/Errors` without any `--dimensions`. What is the Sum?", options: ['7: CloudWatch adds all datapoints of the same metric name together', '5: the dimensionless series is its own metric and the dimension version is a different one', '2: the most recent datapoint wins', 'An error: you must name the dimensions you published with'], answer: 1, explain: "A metric is identified by namespace + metric name + the exact set of dimensions. `Errors` with no dimensions and `Errors{Service=checkout}` are two different metrics that merely share a name. CloudWatch never rolls the dimensioned series up into a dimensionless one for you. To get a total you publish it yourself, or use metric math across the series. This is also why every new dimension combination is billed as another custom metric." },
    { id: 'p2', prompt: "You query `Dojo/Errors` but type the namespace as `dojo` (lower case). What does `get-metric-statistics` do?", options: ['Fails with ResourceNotFound', 'Fails with a validation error because the namespace is unknown', 'Succeeds and returns an empty Datapoints list', 'Matches case-insensitively and returns the data'], answer: 2, explain: "Namespaces are case-sensitive free-form strings and CloudWatch has no registry of valid ones. Querying a metric that does not exist is not an error: you get exit code 0 and `Datapoints: []`. In the real world this is the classic 'my graph is empty' bug: wrong namespace, wrong metric name, a missing dimension, or the wrong Region." },
    { id: 'p3', prompt: "You publish a metric with `StorageResolution=1` (high resolution). Roughly how long can you still read it back at 1-second granularity?", options: ['3 hours', '15 days', '63 days', '15 months'], answer: 0, explain: "CloudWatch keeps data rolling up as it ages: 1-second datapoints for 3 hours, 1-minute for 15 days, 5-minute for 63 days, 1-hour for 455 days (15 months). After 3 hours your 1-second data is still there, but only readable at 60-second periods or coarser." },
  ],
  concept: [
    "A CloudWatch **metric** is a time-ordered set of datapoints, and it is identified by three things: a **namespace** (a container you choose, such as `Dojo`; names starting with `AWS/` are reserved for AWS services), a **metric name**, and zero or more **dimensions** (name/value pairs such as `Service=checkout`). Change any of the three and you are looking at a different metric. You publish with `PutMetricData`: one value, a batch of up to 1,000 metrics per call, or a pre-aggregated **statistic set** (`Sum`, `Minimum`, `Maximum`, `SampleCount`) when you have already counted locally and want to save API calls. Timestamps default to now and may be at most two weeks in the past or two hours in the future.",
    "You read data in **periods**. `GetMetricStatistics` takes a start, an end, a `--period` (a multiple of 60 seconds for standard-resolution data) and the statistics you want: `Sum`, `Average`, `Minimum`, `Maximum`, `SampleCount`, plus percentiles such as `p50` and `p99` through `--extended-statistics`. The two lists cannot be mixed in one call. `GetMetricData` is the modern, batched API: many queries per call, **metric math** expressions (`errors * 2`, `SUM(METRICS())`, `m1 / m2 * 100`), cross-metric ratios, and up to 500 queries. It is what the console and dashboards use. **Units** (`Count`, `Milliseconds`, `Bytes`, ...) are part of the datapoint; filter on them with `--unit`, or you can end up reading two series that look identical.",
    "Where learners get hurt. **Empty graphs** are almost never an outage: a typo in namespace or name, a dimension you forgot to pass (the query must list the same dimensions as the publish, no more and no fewer), a different Region, or a period shorter than the data's resolution. **Cost**: every unique namespace + name + dimension combination counts as one custom metric and is billed per month, so a dimension with unbounded values (a user id, a request id, a container id) quietly creates thousands of billable metrics. Put high-cardinality identifiers in logs, not in dimensions. **Retention** is 3 hours for 1-second data, 15 days for 1-minute, 63 days for 5-minute and 455 days for 1-hour, and a metric with no new data for 15 months expires. Percentiles and Average hide spikes that Maximum shows, which is why an SLO-minded alarm often uses p99, not Average.",
    "Choosing how to emit. From Lambda or containers, the **Embedded Metric Format (EMF)** lets you write one structured JSON log line and CloudWatch extracts the metrics from it, with no `PutMetricData` call, no added latency and the raw event kept in the logs for later Insights queries. From a long-running process the SDK's `PutMetricData` with batching works. For anything that already has an AWS-published metric (Lambda `Errors`, `Duration`, SQS `ApproximateNumberOfMessagesVisible`, ALB `TargetResponseTime`), alarm on that instead of inventing your own. Here you will publish with the CLI, then read the same data back four ways: statistics, percentiles, a dimension slice and a metric-math query. The runner has no shell, so the time window lives in `window.json`, which the CLI reads with `--cli-input-json`. On your own machine you would pass `--start-time` and `--end-time` instead, for example with `date -u -v-1H +%FT%TZ` on macOS.",
  ],
  goal: "You can publish custom metrics, read them with statistics, percentiles and metric math, explain why dimensions create separate metrics, and recognise the silent-empty-result bug.",
  steps: [
    { id: 'put', title: 'Publish one metric', body: "Publish a single datapoint: `Errors = 5` in your own namespace `Dojo`. The call returns nothing on success, and there is no 'create metric' step: the first datapoint creates the metric.", commands: ['aws cloudwatch put-metric-data --namespace Dojo --metric-name Errors --value 5 --unit Count'] },
    { id: 'read', title: 'Read it back with statistics', body: "Open `window.json` in the Files strip: it holds the start time, end time and period, because the runner cannot run `date`. `--cli-input-json` loads those fields and the flags you type add the rest. Ask for `Sum` and `SampleCount`. The Sum should be **5** and there is **1** sample. If the Datapoints list is empty, the data has not landed yet; run it again.", commands: ['aws cloudwatch get-metric-statistics --cli-input-json file://window.json --namespace Dojo --metric-name Errors --statistics Sum SampleCount --unit Count'] },
    { id: 'batch', title: 'Publish a batch and read statistics and percentiles', body: "`metric-data.json` holds three `Latency` datapoints (120, 80 and 400 ms). Publish them with one call, then read Average, Minimum, Maximum and SampleCount. Percentiles need `--extended-statistics`, and they cannot share a call with `--statistics`. Notice how the Average (200) hides the 400 ms outlier that p99 and Maximum expose.", commands: ['aws cloudwatch put-metric-data --namespace Dojo --metric-data file://metric-data.json', 'aws cloudwatch get-metric-statistics --cli-input-json file://window.json --namespace Dojo --metric-name Latency --statistics Average Minimum Maximum SampleCount', 'aws cloudwatch get-metric-statistics --cli-input-json file://window.json --namespace Dojo --metric-name Latency --extended-statistics p50 p99'] },
    { id: 'dims', title: 'Add a dimension and see two metrics', body: "Publish `Errors = 2` again, this time with the dimension `Service=checkout`. `list-metrics` now shows **two** metrics called `Errors`. Read the dimensioned one with `Name=...,Value=...` and compare with step 2: the dimensionless Sum is still 5.", commands: ['aws cloudwatch put-metric-data --namespace Dojo --metric-name Errors --value 2 --unit Count --dimensions Service=checkout', 'aws cloudwatch list-metrics --namespace Dojo --metric-name Errors', 'aws cloudwatch get-metric-statistics --cli-input-json file://window.json --namespace Dojo --metric-name Errors --statistics Sum --dimensions Name=Service,Value=checkout'] },
    { id: 'math', title: 'Metric math with get-metric-data', body: "`queries.json` is a full `GetMetricData` request: two real queries (average and maximum Latency), one hidden query (`ReturnData: false`) and an expression, `errors * 2`, computed from the hidden query's id. Run it and read each result's `StatusCode` and `Values`. Edit the expression (for example `errors * 100 / 10`) and run it again.", commands: ['aws cloudwatch get-metric-data --cli-input-json file://queries.json'] },
    { id: 'break', title: 'Break it: the silent empty result', body: "Query the same `Errors` metric, but type the namespace in lower case. There is no error and the exit code is 0. You just get `Datapoints: []`. Real AWS behaves the same way, which is why a wrong dimension or name looks exactly like 'no data'.", commands: ['aws cloudwatch get-metric-statistics --cli-input-json file://window.json --namespace dojo --metric-name Errors --statistics Sum'], breakIt: true },
    { id: 'limits', title: 'Meet the input limits', body: "Two publishes that CloudWatch refuses, with the same error codes real AWS uses: the reserved `AWS/` namespace, and a timestamp older than two weeks. Both fail with `InvalidParameterValue`.", commands: ['aws cloudwatch put-metric-data --namespace AWS/Lambda --metric-name Errors --value 1', 'aws cloudwatch put-metric-data --namespace Dojo --metric-name Old --value 1 --timestamp 2020-01-01T00:00:00Z'] },
  ],
  breakIt: {
    title: 'An empty graph with no error',
    command: 'aws cloudwatch get-metric-statistics --cli-input-json file://window.json --namespace dojo --metric-name Errors --statistics Sum',
    explain: [
      "The query succeeds and returns `\"Datapoints\": []`. Nothing tells you whether the metric never existed, the name has a typo, a dimension is missing or the window is wrong. CloudWatch cannot know, because there is no registry of valid metrics.",
      "Debug it in this order: `list-metrics` to see what really exists (it shows the exact namespace, name and dimensions), compare character by character, check the Region, and widen the time window. When an alarm watches a metric like this one, the typo shows up as `INSUFFICIENT_DATA`, which module 10.2 covers.",
    ],
  },
  realAws: {
    cost: [
      "Custom metrics are billed per metric per month (about $0.30 for each of the first 10,000 in us-east-1, with cheaper tiers above that; check the CloudWatch pricing page). Every unique namespace + name + dimensions combination is one metric, so unbounded dimension values are a cost bug.",
      "API calls cost too: `PutMetricData` and `GetMetricStatistics` are billed per 1,000 requests and `GetMetricData` per 1,000 metrics requested. Batch publishes, use statistic sets for high-volume counters, and prefer EMF in Lambda to avoid the extra call. The free tier covers 10 custom metrics and 1 million API requests per month.",
    ],
    differences: [
      "The emulator accepts one account and Region and keeps metrics in memory: restart it and everything is gone. Real CloudWatch retains data for up to 15 months and rolls it up as described above.",
      "AWS-published metrics (`AWS/Lambda`, `AWS/SQS`, ...) are produced by the real services. Here you only see what you publish yourself, so you cannot alarm on a Lambda `Errors` metric the way you would on AWS unless you publish a value with that name into your own namespace.",
      "Real AWS has more rules than the emulator checks: for data older than 3 hours the period must be 60 or more, and a single request may return at most 1,440 datapoints. The emulator did not reject a 30-second period in testing, so do not rely on it to catch that mistake.",
    ],
    asOf: '2026-11-15',
    sources: [
      { label: 'Amazon CloudWatch concepts: metrics, namespaces, dimensions', url: 'https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/cloudwatch_concepts.html' },
      { label: 'PutMetricData API reference', url: 'https://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/API_PutMetricData.html' },
      { label: 'Amazon CloudWatch pricing', url: 'https://aws.amazon.com/cloudwatch/pricing/' },
    ],
  },
  fidelity: [{ service: 'CloudWatch', pass: 645, total: 848 }],
  files: ['window.json', 'metric-data.json', 'queries.json'],
  checks: [
    { id: 'put', label: 'Dojo/Errors has one datapoint with Sum 5', hint: 'Publish the value 5 once with `put-metric-data`. If you published it twice, Reset module.' },
    { id: 'read', label: 'You read Errors back with get-metric-statistics and saw Sum 5', hint: 'Run the statistics command with `--cli-input-json file://window.json`.' },
    { id: 'batch', label: 'Dojo/Latency holds three samples and you read its percentiles', hint: 'Publish `metric-data.json`, then run the `--extended-statistics p50 p99` command.' },
    { id: 'dims', label: 'Errors exists with and without the Service=checkout dimension', hint: 'Publish a second Errors datapoint with `--dimensions Service=checkout`.' },
    { id: 'math', label: 'A metric-math query returned a computed series', hint: 'Run `get-metric-data` with `file://queries.json`.' },
    { id: 'breakit', label: 'You saw an empty result for a mistyped namespace', hint: 'Query Errors with `--namespace dojo` (lower case) and read the empty Datapoints list.' },
    { id: 'limits', label: 'You saw both input limits (AWS/ namespace, timestamp too old)', hint: 'Run both commands in the last step; each should fail with InvalidParameterValue.' },
  ],
}
