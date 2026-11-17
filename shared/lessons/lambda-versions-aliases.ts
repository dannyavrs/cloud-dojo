import type { LessonContent } from '../types'

const ROLE = 'arn:aws:iam::000000000000:role/lambda-exec'
const INV = `aws lambda invoke --function-name release:live --cli-binary-format raw-in-base64-out --payload '{}' out.json --query ExecutedVersion`

export const V1_HANDLER = `export const handler = async () => ({
  message: "v1 behaviour",
  version: process.env.AWS_LAMBDA_FUNCTION_VERSION,
});`

export const lambdaVersionsAliases: LessonContent = {
  id: 'lambda-versions-aliases',
  n: '4.3',
  trackId: 'lambda',
  level: 'advanced',
  prereqs: ['lambda-config-errors'],
  estMinutes: 40,
  honesty: 'live',
  honestyNote: 'Versions, aliases and weighted routing are enforced by the emulator, including the immutability of published versions. CodeDeploy-driven rollouts and CloudWatch alarm rollbacks are not part of this module.',
  examTags: ['DVA:Deploy', 'DVA:Dev', 'SAA:Resilient'],
  breakItCheck: 'breakit',
  editable: ['handler.mjs'],
  title: 'Versions, aliases and a weighted canary',
  tagline: 'Publish an immutable version, point a stable name at it, then shift half the traffic to the new code.',
  predict: [
    { id: 'p1', prompt: 'You publish version 1 of a function, then change the function code with update-function-code. What does version 1 contain?', options: ['The new code, versions follow $LATEST', 'The old code: published versions are immutable snapshots of code and configuration', 'Version 1 is deleted', 'The new code, but the old configuration'], answer: 1, explain: 'A published version is a frozen snapshot of code plus configuration (env vars, memory, timeout, layers). Only $LATEST is mutable. That is exactly why you point an alias at a version instead of at $LATEST.' },
    { id: 'p2', prompt: 'An alias `live` points at version 1 with an AdditionalVersionWeights of {"2": 0.1}. What share of invocations of `fn:live` runs version 2?', options: ['100%, the additional version wins', '10%, and the remaining 90% runs version 1', '0%, an alias can only point at one version', '50%'], answer: 1, explain: 'The weight is the share sent to the additional version; the primary version gets the remainder. An alias can split between at most two versions, and both must be published (not $LATEST).' },
    { id: 'p3', prompt: 'Which resource can an alias point to?', options: ['$LATEST or any published version', 'Any published version only, never $LATEST for a weighted alias', 'Another alias', 'A function in a different account'], answer: 1, explain: 'An alias can point at $LATEST (typical for a dev alias) or a version, but not at another alias. For weighted routing both versions must be published versions, not $LATEST.' },
  ],
  concept: [
    "Every Lambda function has one mutable pointer, **`$LATEST`**, and any number of immutable **versions** (1, 2, 3...) that you create with `publish-version`. A version freezes **code and configuration together**: runtime, handler, memory, timeout, environment variables and layers. Because of that, `update-function-configuration` against `release:1` fails: it modifies the unpublished `$LATEST`, and the qualifier names something that cannot change. Versions also get their own ARN (`...:function:release:1`), their own resource policy surface and, for provisioned concurrency, their own pool. You can have at most 75 GB of code per region by default, so old versions are worth pruning.",
    "An **alias** is a named, mutable pointer to a version (`live` -> 1). Consumers (an API Gateway integration, an S3 notification, an event source mapping, a Function URL) reference the alias ARN, so a deployment is just `update-alias` and nothing upstream changes. Aliases also carry **weighted routing**: `--routing-config '{\"AdditionalVersionWeights\":{\"2\":0.5}}'` sends 50% to version 2 and the rest to the alias's primary version, which is a **canary** or linear shift done by hand. The invoke response tells you what ran: `ExecutedVersion`. The constraints the exam likes: only two versions per alias, both published, and the alias cannot point at `$LATEST` when weights are used.",
    "Do not confuse the pieces. A published version shares nothing with `$LATEST` after publish, so a rollback is `update-alias --function-version 1` with empty weights, instantly, with no redeploy. Environment-specific config (a different table name per stage) belongs in an alias-per-stage design plus variables set **before** you publish, or in Parameter Store read at start-up, not in code branches. In production you rarely shift weights by hand: **AWS CodeDeploy** (and SAM's `DeploymentPreference`) automates it with predefined configurations such as `Canary10Percent5Minutes` and `Linear10PercentEvery1Minute`, runs pre/post-traffic hook functions and **rolls back automatically when a CloudWatch alarm fires**. Know that CodeDeploy for Lambda works through aliases and is what the exam means by 'gradual deployment'.",
    "In this module you edit the handler, publish two versions, create the `live` alias, hit the immutability error on purpose, and then split traffic 50/50. A terminal can only run one command at a time, so you invoke a few times yourself, and the **Check** button then fires 16 invokes through the alias and looks for both `ExecutedVersion` values. With a true 50/50 split the chance that 16 calls all land on one version is about 0.003%.",
  ],
  goal: 'Two published versions with different code, an alias `live` on version 1 with 50% of traffic routed to version 2, and proof that both versions answer.',
  steps: [
    { id: 'look', title: 'Read the handler', body: "The fixture created the role `lambda-exec`. `handler.mjs` returns `v1 behaviour` and the version it runs as (`AWS_LAMBDA_FUNCTION_VERSION`). You will change it for version 2." },
    { id: 'create', title: 'Create the function', body: 'Plain function, no versions yet: only `$LATEST` exists.', commands: [`aws lambda create-function --function-name release --runtime nodejs22.x --handler handler.handler --role ${ROLE} --zip-file fileb://handler.zip`, 'aws lambda wait function-active-v2 --function-name release'] },
    { id: 'v1', title: 'Publish version 1', body: 'Publishing snapshots `$LATEST` as an immutable version. Note the `Version` in the output and the ARN ending in `:1`.', commands: ['aws lambda publish-version --function-name release --description first'] },
    { id: 'edit', title: 'Change the code for version 2', body: "In the editor replace `handler.mjs` with this version and Save; the server rebuilds `handler.zip`.", code: { file: 'handler.mjs', text: V1_HANDLER.replace('v1 behaviour', 'v2 behaviour') } },
    { id: 'v2', title: 'Deploy to $LATEST, then publish version 2', body: "`update-function-code` changes only `$LATEST`. Version 1 keeps the old code. Wait for the update to finish, then publish.", commands: ['aws lambda update-function-code --function-name release --zip-file fileb://handler.zip', 'aws lambda wait function-updated-v2 --function-name release', 'aws lambda publish-version --function-name release --description second'] },
    { id: 'alias', title: 'Create the alias `live` on version 1', body: "Production callers use `release:live`. Invoke through the alias and open `out.json` in Files: version 1 still answers `v1 behaviour`.", commands: ['aws lambda create-alias --function-name release --name live --function-version 1', INV] },
    { id: 'break', title: 'Break it: update the configuration of a published version', body: "Try to give version 1 a longer timeout. Published versions are immutable, so the call is refused: it would modify the unpublished `$LATEST`.", commands: ['aws lambda update-function-configuration --function-name release:1 --timeout 5'], breakIt: true },
    { id: 'canary', title: 'Send 50% of the traffic to version 2', body: "The alias still points at version 1; `AdditionalVersionWeights` steals a share for version 2. The JSON goes in single quotes.", commands: [`aws lambda update-alias --function-name release --name live --function-version 1 --routing-config '{"AdditionalVersionWeights":{"2":0.5}}'`] },
    { id: 'try', title: 'Invoke through the alias a few times', body: "Run this several times. The terminal shows the executed version (`\"1\"` or `\"2\"`). Then press **Check**: it invokes 16 times and requires both versions to appear.", commands: [INV] },
    { id: 'show', title: 'Inspect what you built', body: 'Read the alias and the versions list. To roll back in an emergency you would `update-alias` back to version 1 with empty weights; to promote you would set `--function-version 2` and clear the weights.', commands: ['aws lambda get-alias --function-name release --name live', "aws lambda list-versions-by-function --function-name release --query 'Versions[].[Version,Description]' --output text"] },
  ],
  breakIt: {
    title: 'Updating the configuration of version 1',
    command: 'aws lambda update-function-configuration --function-name release:1 --timeout 5',
    explain: [
      "`InvalidParameterValueException: UpdateFunctionConfiguration modifies the unpublished $LATEST configuration, and the qualifier '1' in 'functionName' names a published version or an alias`. A published version is a snapshot of code and configuration. To change anything, edit `$LATEST`, publish a new version, and move the alias.",
      "The same rule explains a classic exam trap: environment variables are part of the version. If you change a variable on `$LATEST` after publishing, the live alias keeps running the old value until you publish again and shift the alias.",
    ],
  },
  realAws: {
    cost: [
      "Versions and aliases cost nothing by themselves; you pay for invocations. Code storage is capped at 75 GB per region per account by default, so delete old versions you no longer need.",
      "CodeDeploy is free for Lambda deployments; you pay for the pre/post-traffic hook functions and CloudWatch alarms you attach.",
    ],
    differences: [
      "Real AWS automates canaries with CodeDeploy deployment configurations (Canary10Percent5Minutes, Linear10PercentEvery1Minute, AllAtOnce), pre/post-traffic hooks and automatic rollback on a CloudWatch alarm. This module does the shift by hand.",
      "Real routing is probabilistic per invocation, exactly like the emulator, so small samples can look uneven. Do not read a precise percentage out of 16 calls.",
      "On real AWS, alias routing with provisioned concurrency needs provisioned capacity on both versions to avoid cold starts on the new one.",
    ],
    asOf: '2026-11-13',
    sources: [
      { label: 'Lambda function versions', url: 'https://docs.aws.amazon.com/lambda/latest/dg/configuration-versions.html' },
      { label: 'Lambda function aliases', url: 'https://docs.aws.amazon.com/lambda/latest/dg/configuration-aliases.html' },
      { label: 'Implement Lambda canary deployments using a weighted alias', url: 'https://docs.aws.amazon.com/lambda/latest/dg/lambda-rolling-deployments.html' },
    ],
  },
  fidelity: [{ service: 'Lambda', pass: 395, total: 788 }, { service: 'IAM', pass: 502, total: 692 }],
  files: ['handler.mjs', 'handler.zip'],
  probeNote: 'The traffic-split check sends 16 invokes through the alias when you press Check.',
  checks: [
    { id: 'fn', label: 'Function `release` is Active', hint: 'Run the create step.' },
    { id: 'versions', label: 'Versions 1 and 2 are published with different code', hint: 'Publish v1, edit handler.mjs, update-function-code, publish v2.' },
    { id: 'alias', label: 'Alias `live` exists and has version 1 as its primary version', hint: 'Run create-alias with --function-version 1.' },
    { id: 'breakit', label: 'You saw Lambda refuse to update the configuration of version 1', hint: 'Run the break-it command.' },
    { id: 'canary', label: 'The alias routes a share of traffic to version 2', hint: 'Run update-alias with the routing-config JSON.' },
    { id: 'split', label: 'Over 16 invokes through `release:live`, both version 1 and version 2 answered', hint: 'Press Check after the canary is set; it needs the weighted alias.' },
  ],
}
