import type { LessonContent } from '../types'

const ROLE = 'arn:aws:iam::000000000000:role/lambda-exec'
const INV = (file: string) => `aws lambda invoke --function-name greeter --cli-binary-format raw-in-base64-out --payload '{}' ${file}`

export const LAYER_FILES = {
  'nodejs/node_modules/greet/index.mjs': 'export const greet = (name) => `hello ${name} from a layer`;\n',
  'nodejs/node_modules/greet/package.json': '{ "name": "greet", "type": "module", "main": "index.mjs" }\n',
}
export const LAYERS_STARTER = `// Starter: does not use the layer yet.
export const handler = async () => "no layer attached yet";
`
export const LAYERS_HANDLER = `import { greet } from "greet";

export const handler = async () => greet("Danny");`

export const lambdaLayers: LessonContent = {
  id: 'lambda-layers',
  n: '4.4',
  trackId: 'lambda',
  level: 'intermediate',
  prereqs: ['lambda-config-errors'],
  estMinutes: 35,
  honesty: 'live',
  honestyNote: 'Publishing, attaching and removing layers is enforced and the layer contents are really mounted for the handler. Real Node.js ES modules resolve layer packages differently from the emulator (see the differences section).',
  examTags: ['DVA:Dev', 'DVA:Deploy', 'SAA:Performant'],
  breakItCheck: 'breakit',
  editable: ['handler.mjs'],
  title: 'Lambda layers: share code, break the import',
  tagline: 'Package a dependency once, attach it to many functions, and see exactly what fails when the layer goes missing.',
  predict: [
    { id: 'p1', prompt: 'You publish a layer, then publish a second version of it. A function still lists version 1 of the layer. What does the function run?', options: ['Version 2, functions follow the latest layer version', 'Version 1: a function references one specific layer version until you update it', 'Both versions are merged', 'The function fails because the layer changed'], answer: 1, explain: 'A function points at a layer VERSION ARN (...:layer:greet:1). Layer versions are immutable, and nothing auto-updates. To roll out a new layer version you update the function configuration, which is also a safe rollback path.' },
    { id: 'p2', prompt: 'Which folder layout makes a Node.js layer importable by name?', options: ['node_modules/greet at the zip root', 'nodejs/node_modules/greet in the zip', 'lib/greet', 'opt/greet'], answer: 1, explain: 'Layers are extracted to /opt. For Node.js the runtime looks in /opt/nodejs/node_modules, so the zip needs nodejs/node_modules/<package>. Python uses python/, Java uses java/lib, and executables go in bin/.' },
    { id: 'p3', prompt: 'What is the maximum number of layers per function, and the total size limit?', options: ['1 layer, 50 MB', '5 layers, 250 MB unzipped for the function plus all layers', '10 layers, 512 MB', 'Unlimited layers, 10 GB'], answer: 1, explain: 'A function can use up to five layers, and the unzipped size of the function code plus all layers must stay under 250 MB. If you need more, package the function as a container image (up to 10 GB).' },
  ],
  concept: [
    "A **layer** is a zip that Lambda extracts into **`/opt`** of the execution environment before your handler starts. It exists to share dependencies, custom runtimes, binaries and config across functions without re-uploading them each time and to keep deployment zips small. The folder layout decides whether it works: Node.js packages go under `nodejs/node_modules`, Python under `python` (or `python/lib/python3.x/site-packages`), Java under `java/lib`, and executables under `bin`. The runtimes put those folders on their search path (`NODE_PATH`, `PYTHONPATH`, `PATH`). Get the top-level folder wrong and the upload succeeds and the import fails at run time, which is the typical exam troubleshooting scenario.",
    "Layers are versioned and **immutable**: `publish-layer-version` always creates the next number (`greet:1`, `greet:2`...) and the function stores the full version ARN. Nothing updates automatically, so promoting a new layer version is a configuration change on each function and rollback is changing it back. Limits to memorise: **5 layers per function**, and the **unzipped size of the function plus all its layers must be at most 250 MB** (a container image function does not use layers at all and can be 10 GB). Layers are applied in the order you list them and later layers overwrite files of earlier ones with the same path. Layers can be shared with other accounts or the public with `add-layer-version-permission`, which is a resource policy on the layer version, and a function in another account additionally needs the execution role to allow `lambda:GetLayerVersion`.",
    "Layers are not free of trade-offs. They do not reduce cold start time (the layer content is still loaded into the sandbox), they hide a dependency outside your deployment package so local tests and CI must reproduce it, and they couple functions to one version of shared code. Use them for stable, widely shared pieces (an AWS SDK or Powertools build, a native binary, a company logging library); for code that changes with the function, bundle it into the package. SAM and CDK manage layer versions for you, and AWS publishes managed layers such as Lambda Powertools and the AWS Parameters and Secrets extension.",
    "In this module you edit the handler to import a package `greet`, publish the layer, attach it by ARN, then remove the layer on purpose and read the import error before fixing it. The layer zip in your folder contains `nodejs/node_modules/greet/index.mjs`; check it in the Files viewer.",
  ],
  goal: 'A layer `greet` published and attached to function `greeter`; you saw the import error after removing it and restored the working state.',
  steps: [
    { id: 'look', title: 'Look at the starter files', body: "The fixture created the role `lambda-exec`. `layer.zip` contains `nodejs/node_modules/greet/index.mjs` plus a `package.json`: a one-function module. `handler.mjs` does not use it yet." },
    { id: 'publish', title: 'Publish the layer', body: "`--compatible-runtimes` is metadata the console and CLI use to filter. Copy the `LayerVersionArn` from the output (it ends in `:1`) and use it wherever you see `<LAYER_ARN>` below.", commands: ['aws lambda publish-layer-version --layer-name greet --zip-file fileb://layer.zip --compatible-runtimes nodejs22.x --query LayerVersionArn --output text'] },
    { id: 'edit', title: 'Make the handler import from the layer', body: "In the editor replace `handler.mjs` with this version and Save. `import ... from \"greet\"` resolves to `/opt/nodejs/node_modules/greet` once the layer is attached.", code: { file: 'handler.mjs', text: LAYERS_HANDLER } },
    { id: 'create', title: 'Create the function with the layer attached', body: 'The ARN is passed to `--layers`. A function holds up to five of them.', commands: [`aws lambda create-function --function-name greeter --runtime nodejs22.x --handler handler.handler --role ${ROLE} --zip-file fileb://handler.zip --layers <LAYER_ARN>`, 'aws lambda wait function-active-v2 --function-name greeter'] },
    { id: 'works', title: 'Invoke it', body: 'Open `ok.json` in Files: the answer comes from the layer.', commands: [INV('ok.json')] },
    { id: 'break', title: 'Break it: remove the layer', body: "`--layers` with no value sets an empty list. Wait for the update, then invoke. The deployment package did not change, but the dependency is gone: `Runtime.ImportModuleError` in `broken.json`.", commands: ['aws lambda update-function-configuration --function-name greeter --layers', 'aws lambda wait function-updated-v2 --function-name greeter', INV('broken.json')], breakIt: true },
    { id: 'fix', title: 'Fix it: attach the layer again', body: 'Same ARN, same immutable layer version.', commands: ['aws lambda update-function-configuration --function-name greeter --layers <LAYER_ARN>', 'aws lambda wait function-updated-v2 --function-name greeter', INV('fixed.json')] },
    { id: 'inspect', title: 'Inspect the layer and the function', body: 'List the versions of your layer and what the function references. Publishing the zip again would create version 2 and leave `greeter` on version 1.', commands: ['aws lambda list-layer-versions --layer-name greet --query "LayerVersions[].[Version,LayerVersionArn]" --output text', 'aws lambda get-function-configuration --function-name greeter --query Layers'] },
  ],
  breakIt: {
    title: 'A function whose layer was removed',
    command: 'aws lambda update-function-configuration --function-name greeter --layers',
    explain: [
      "The update succeeds and so does the next invoke call: `StatusCode: 200` with `FunctionError: Unhandled`, and the payload says `Runtime.ImportModuleError: Cannot find module 'greet'`. The code is fine; its dependency is not there. Because the failure is in module loading, it happens during the init phase, before your handler runs at all.",
      "The exam variant: a function suddenly fails with an import error after a deployment. Check the function's layer list (version ARNs), the layer's folder layout (`nodejs/node_modules`) and whether the layer's compatible runtime and architecture match. Also remember layers are not updated automatically: a new layer version does nothing until the function references it.",
    ],
  },
  realAws: {
    cost: [
      "Layers have no extra charge; they count toward your regional code storage (75 GB by default) and the 250 MB unzipped package limit. Check the Lambda pricing page for storage and request rates.",
    ],
    differences: [
      "On real AWS the Node.js runtime adds /opt/nodejs/node_modules to NODE_PATH, which CommonJS `require` honours. ES module `import` does not use NODE_PATH, so with .mjs handlers you usually import from a path such as `/opt/nodejs/node_modules/greet/index.mjs` (or write the layer package so a bare import works through your bundler). The emulator resolves the bare specifier `greet` for you, so a bare import that works here may fail on AWS.",
      "Real AWS validates compatible runtimes and architectures on attach, enforces the five-layer and 250 MB limits, and supports cross-account layers through layer version permissions. The emulator accepts a subset of this.",
      "Layers do not reduce cold start time on AWS; they only make packaging easier.",
    ],
    asOf: '2026-11-13',
    sources: [
      { label: 'Managing Lambda dependencies with layers', url: 'https://docs.aws.amazon.com/lambda/latest/dg/chapter-layers.html' },
      { label: 'Adding layers to functions', url: 'https://docs.aws.amazon.com/lambda/latest/dg/adding-layers.html' },
      { label: 'Lambda quotas', url: 'https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html' },
    ],
  },
  fidelity: [{ service: 'Lambda', pass: 395, total: 788 }, { service: 'IAM', pass: 502, total: 692 }],
  files: ['handler.mjs', 'handler.zip', 'layer.zip'],
  checks: [
    { id: 'layer', label: 'Layer `greet` has a published version', hint: 'Run the publish-layer-version step.' },
    { id: 'fn', label: 'Function `greeter` is Active and was created with the layer attached', hint: 'Edit handler.mjs, then create the function with --layers <LAYER_ARN>.' },
    { id: 'works', label: 'The first invoke returned a message "from a layer"', hint: 'Invoke greeter and write the output to ok.json.' },
    { id: 'breakit', label: 'You saw Runtime.ImportModuleError after removing the layer', hint: 'Run the break-it step; the error is in broken.json.' },
    { id: 'fixed', label: 'The layer is attached again and the function works', hint: 'Run the fix step.' },
  ],
}
