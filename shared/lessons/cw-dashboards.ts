import type { LessonContent } from '../types'

const STARTER = `{
  "widgets": [
    { "type": "text", "x": 0, "y": 0, "width": 24, "height": 2, "properties": { "markdown": "# Checkout service\\nErrors and latency, last 3 hours." } },
    { "type": "metric", "x": 0, "y": 2, "width": 16, "height": 6, "properties": { "title": "Errors (sum per 5 min)", "metrics": [ [ "Dojo", "Errors" ] ], "stat": "Sum", "period": 300, "view": "timeSeries" } },
    { "type": "alarm", "x": 16, "y": 2, "width": 8, "height": 6, "properties": { "title": "Alarms", "alarms": [ "arn:aws:cloudwatch:us-east-1:000000000000:alarm:checkout-errors" ] } }
  ]
}`

const FULL = `{
  "widgets": [
    { "type": "text", "x": 0, "y": 0, "width": 24, "height": 2, "properties": { "markdown": "# Checkout service\\nErrors and latency, last 3 hours. **Owner:** payments." } },
    { "type": "metric", "x": 0, "y": 2, "width": 12, "height": 6, "properties": { "title": "Errors (sum per 5 min)", "region": "us-east-1", "metrics": [ [ "Dojo", "Errors" ] ], "stat": "Sum", "period": 300, "view": "timeSeries", "annotations": { "horizontal": [ { "label": "Alarm threshold", "value": 3 } ] } } },
    { "type": "metric", "x": 12, "y": 2, "width": 12, "height": 6, "properties": { "title": "Latency (ms)", "region": "us-east-1", "metrics": [ [ "Dojo", "Latency", { "stat": "Average", "label": "average" } ], [ "Dojo", "Latency", { "stat": "Maximum", "label": "slowest" } ] ], "period": 300, "view": "timeSeries" } },
    { "type": "metric", "x": 0, "y": 8, "width": 8, "height": 4, "properties": { "title": "Errors, last 3 hours", "region": "us-east-1", "metrics": [ [ "Dojo", "Errors" ] ], "stat": "Sum", "period": 10800, "view": "singleValue" } },
    { "type": "alarm", "x": 8, "y": 8, "width": 16, "height": 4, "properties": { "title": "Alarms", "alarms": [ "arn:aws:cloudwatch:us-east-1:000000000000:alarm:checkout-errors", "arn:aws:cloudwatch:us-east-1:000000000000:alarm:checkout-latency" ] } }
  ]
}`

export const cwDashboards: LessonContent = {
  id: 'cw-dashboards',
  n: '10.4',
  trackId: 'cloudwatch',
  level: 'intermediate',
  prereqs: ['cw-metrics', 'cw-alarms-sns'],
  estMinutes: 20,
  honesty: 'live',
  honestyNote: 'The emulator stores dashboards and validates part of the body (metric widgets need a region). It has no console, so this app draws the stored body itself: metric lines and numbers from get-metric-data, alarm tiles from describe-alarms, and the text widget.',
  examTags: ['SAA:Performant', 'DVA:Troubleshoot'],
  breakItCheck: 'breakit',
  editable: ['dashboard.json'],
  title: 'Dashboards: one stored JSON body, drawn live',
  tagline: 'Describe a dashboard as JSON, get a validation error you can read, and watch the mini dashboard draw it.',
  predict: [
    { id: 'p1', prompt: "Your `put-dashboard` body has a metric widget with `metrics` and `stat` but no `region` in its properties. What happens?", options: ['It is stored and the widget defaults to the dashboard\'s own Region', 'It is rejected with InvalidParameterInput and a list of validation messages', 'It is stored, but the widget shows No data', 'It is stored with a warning in DashboardValidationMessages'], answer: 1, explain: "`PutDashboard` validates the body and returns `InvalidParameterInput` with a `DashboardValidationMessages` list that names the JSON path of each problem (here `/widgets/1/properties`). Nothing is stored when validation fails. A metric widget needs a `region` because dashboards are account-wide, not regional: each widget says where its data lives." },
    { id: 'p2', prompt: "What does a stored dashboard actually contain?", options: ['A snapshot of the metric data at the time you saved it', 'Only the layout and queries as JSON; the data is fetched fresh every time someone opens it', 'A copy of every metric it references', 'The alarm history of the alarms it shows'], answer: 1, explain: "A dashboard is a `DashboardBody` JSON document: widget positions, sizes and the metric, alarm or log queries. It stores no data, so it costs nothing to keep stale and it always shows current values. This is also why a dashboard can be recreated from code (CloudFormation `AWS::CloudWatch::Dashboard`, CDK, Terraform) and why dashboards are best kept in version control." },
    { id: 'p3', prompt: "A dashboard is created in us-east-1. Can one of its widgets graph a metric from eu-west-1?", options: ['No: a dashboard can only show metrics from its own Region', 'Yes: dashboards are global and each widget names its Region', 'Only if cross-account observability is enabled', 'Only for AWS-published metrics, not custom ones'], answer: 1, explain: "Dashboards are not tied to a Region: you can mix Regions in one dashboard, and the `region` property of each widget decides where its metrics are read. Cross-account dashboards are a separate feature (cross-account observability or sharing) and are not needed for cross-Region." },
  ],
  concept: [
    "A **CloudWatch dashboard** is a named JSON document, the `DashboardBody`, holding a `widgets` array. Every widget has a `type`, a position on a **24-column grid** (`x`, `y`) and a size (`width`, `height`, in grid units), plus `properties` that depend on the type. The common types are `metric` (a line, stacked area, bar, pie or single number built from metrics and optional **metric math**), `alarm` (a status grid of up to 100 alarms), `text` (Markdown for context and runbook links), `log` (a Logs Insights query result) and `explorer` (a tag-driven metric explorer). `PutDashboard` creates the dashboard or **replaces it completely**, so there is no partial update: send the whole body every time.",
    "What a dashboard does not do is store data. Each time it loads, the console runs the queries in the widgets: for each metric widget a `GetMetricData` over the time range (a relative `start` such as `-PT3H`, or the picker), for each alarm widget a lookup of the alarms' current state. That has three consequences. Dashboards cost nothing in storage and never go stale. They are **global**: the `region` in each widget decides where its metrics come from, so one dashboard can show several Regions, and a missing region is a validation error. And they are ideal as **code**: treat the JSON as source, generate it from CloudFormation, CDK or Terraform, and review it like any other change.",
    "Design habits that show up in operations questions. Put the alarm status widget and the golden signals at the top (traffic, errors, latency, saturation) and the detail below. Add a **horizontal annotation** at the alarm threshold so a graph tells you how close you are, use the same period and statistic as the alarm so what you see is what pages you, and pick Maximum or p99 for latency rather than Average. Use a `text` widget for the owner, the runbook link and what 'bad' looks like. Dashboards can be shared with people who have no AWS account (read-only, through a link, SSO or a public URL), and `GetMetricWidgetImage` renders a single widget as a PNG for reports and chat. Automatic dashboards exist for most AWS services and are a good starting point.",
    "In this module the fixture seeded 45 minutes of `Errors` and `Latency` data and two alarms, `checkout-errors` and `checkout-latency`. `dashboard.json` is a starter body with a deliberate mistake. You will see the validation error, fix it, store the dashboard, then grow it to five widgets. The emulator is honest about what it does: it stores the body and checks that metric widgets name a region, but it does not check every property (a width above 24, for example, is accepted, where real AWS refuses it) and it has no console. So this app reads the stored body back with `get-dashboard` and draws it under the checker, using only the data the emulator returns. Open the mini dashboard after each `put-dashboard` and it redraws within a few seconds.",
  ],
  goal: "You can describe a dashboard as JSON, read a validation error, store it, and explain what a dashboard keeps and what it fetches live.",
  steps: [
    { id: 'look', title: 'See what there is to chart', body: "The fixture published 45 minutes of `Errors` and `Latency` datapoints to the `Dojo` namespace and created two alarms. A dashboard shows these, so look at them first. The alarm states come from the data, not from the fixture.", commands: ['aws cloudwatch list-metrics --namespace Dojo', "aws cloudwatch describe-alarms --query 'MetricAlarms[].[AlarmName,StateValue]' --output text"] },
    { id: 'break', title: 'Break it: store the starter body', body: "Open `dashboard.json` and read it: a text widget, an Errors line chart and an alarm widget. Try to store it. `put-dashboard` refuses with **InvalidParameterInput** and a list of validation messages naming the path `/widgets/1/properties`: the metric widget has no `region`. Nothing was stored.", commands: ['aws cloudwatch put-dashboard --dashboard-name checkout --dashboard-body file://dashboard.json'], breakIt: true },
    { id: 'fix', title: 'Fix the body and store it', body: "Add `\"region\": \"us-east-1\"` to the properties of the metric widget in `dashboard.json`, save, and run the command again. This time `DashboardValidationMessages` is empty. The mini dashboard below the checker now draws three widgets from your JSON.", code: { file: 'dashboard.json', text: '"properties": { "title": "Errors (sum per 5 min)", "region": "us-east-1", "metrics": [ [ "Dojo", "Errors" ] ], ... }' }, commands: ['aws cloudwatch put-dashboard --dashboard-name checkout --dashboard-body file://dashboard.json'] },
    { id: 'get', title: 'Read it back', body: "A dashboard is just the JSON you sent. `get-dashboard` returns it as a string in `DashboardBody` (plus the ARN), and `list-dashboards` shows its size and last-modified time. This is the document the mini dashboard parses.", commands: ['aws cloudwatch get-dashboard --dashboard-name checkout', 'aws cloudwatch list-dashboards'] },
    { id: 'extend', title: 'Grow it to five widgets', body: "Replace the whole content of `dashboard.json` with the body below and store it again (`put-dashboard` replaces, it does not merge). It adds a latency chart with two series, a single-value tile, a threshold line at 3 on the errors chart and a second alarm. Watch the mini dashboard redraw.", code: { file: 'dashboard.json', text: FULL }, commands: ['aws cloudwatch put-dashboard --dashboard-name checkout --dashboard-body file://dashboard.json'] },
  ],
  breakIt: {
    title: 'A dashboard body that is not stored',
    command: 'aws cloudwatch put-dashboard --dashboard-name checkout --dashboard-body file://dashboard.json',
    explain: [
      "The error is `InvalidParameterInput: The dashboard body is invalid, there are 2 validation errors`, followed by JSON objects with a `dataPath` and a `message`. The path points at the widget (`/widgets/1/properties`), which is how you find the culprit in a 40-widget body.",
      "The CLI also prints `DashboardValidationMessages` on success, as an empty list. On real AWS some problems come back as messages on a successful call, others as errors, so always read that list after `put-dashboard`, and keep dashboards in version control so a rejected change is a failed pipeline instead of a missing dashboard.",
    ],
  },
  realAws: {
    cost: [
      "Each custom dashboard is billed per month after the free allowance (three dashboards of up to 50 metrics each, then about $3 per dashboard per month in the last pricing I checked; confirm on the CloudWatch pricing page). Automatic service dashboards are free.",
      "The data behind widgets is billed as API usage: every dashboard load runs `GetMetricData` queries, charged per 1,000 metrics requested. A wall-mounted dashboard with auto-refresh and many metrics is a steady background cost, so reduce refresh rates and widget counts for dashboards nobody watches.",
    ],
    differences: [
      "The emulator validates fewer rules than AWS. A widget width above 24, an unknown widget type and a bad period were all accepted in testing, where real AWS rejects them. Treat success here as 'well-formed JSON with regions', not as proof that the console will draw it.",
      "There is no console in the emulator. The mini dashboard in this app is a small renderer written for the course: it understands text, metric (line and single value, with metric math, annotations and relative time) and alarm widgets and ignores everything else, which it labels as unsupported. Its single-value tile takes the widget's statistic over the whole time range (the console shows the latest datapoint) and its time axis fits the returned datapoints. The real console supports many more widget types and options.",
      "On AWS dashboards can be shared outside your account and can cross accounts and Regions with the right setup. None of that exists in a single-account emulator.",
    ],
    asOf: '2026-11-15',
    sources: [
      { label: 'Dashboard body structure and syntax', url: 'https://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/CloudWatch-Dashboard-Body-Structure.html' },
      { label: 'Using Amazon CloudWatch dashboards', url: 'https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Dashboards.html' },
      { label: 'Amazon CloudWatch pricing', url: 'https://aws.amazon.com/cloudwatch/pricing/' },
    ],
  },
  fidelity: [{ service: 'CloudWatch', pass: 645, total: 848 }],
  files: ['dashboard.json'],
  probeNote: 'The last check reads whether this app fetched and drew your dashboard; it turns green a few seconds after a successful put-dashboard while this page is open.',
  checks: [
    { id: 'breakit', label: 'You saw put-dashboard reject a metric widget without a region', hint: 'Run `put-dashboard` on the unedited `dashboard.json`.' },
    { id: 'stored', label: 'Dashboard checkout is stored and every metric widget names a region', hint: 'Add `"region": "us-east-1"` to the metric widget, save, and run `put-dashboard` again.' },
    { id: 'get', label: 'You read the dashboard back with get-dashboard', hint: 'Run `aws cloudwatch get-dashboard --dashboard-name checkout`.' },
    { id: 'full', label: 'The dashboard has a text widget, two metric charts, a number and an alarm tile', hint: 'Replace `dashboard.json` with the five-widget body and store it again.' },
    { id: 'rendered', label: 'The mini dashboard drew your five widgets', hint: 'Keep this page open after storing the full body; it draws within a few seconds.' },
  ],
}

export const CW_DASH_STARTER = STARTER
