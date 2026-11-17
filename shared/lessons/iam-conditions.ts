import type { LessonContent } from '../types'

const AS = 'AWS_ACCESS_KEY_ID=<KEY_ID> AWS_SECRET_ACCESS_KEY=<SECRET>'
const simPrefix = (p: string) => `aws iam simulate-principal-policy --policy-source-arn arn:aws:iam::000000000000:user/dev --action-names s3:ListBucket --resource-arns arn:aws:s3:::iam-lab --context-entries ContextKeyName=s3:prefix,ContextKeyValues=${p},ContextKeyType=string --query "EvaluationResults[].[EvalActionName,EvalDecision]" --output text`
const IP_DOC = `'{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"s3:GetObject","Resource":"*","Condition":{"IpAddress":{"aws:SourceIp":"203.0.113.0/24"}}}]}'`
const simIp = (ip: string) => `aws iam simulate-custom-policy --policy-input-list ${IP_DOC} --action-names s3:GetObject --resource-arns arn:aws:s3:::iam-lab/home/dev/a.txt --context-entries ContextKeyName=aws:SourceIp,ContextKeyValues=${ip},ContextKeyType=ip --query "EvaluationResults[].[EvalActionName,EvalDecision]" --output text`

export const iamConditions: LessonContent = {
  id: 'iam-conditions',
  n: '1.3',
  trackId: 'iam',
  level: 'intermediate',
  prereqs: ['iam-intern', 'iam-evaluation'],
  estMinutes: 25,
  honesty: 'live',
  honestyNote: 'The `s3:prefix` condition is enforced on real calls and simulated with --context-entries. `aws:SourceIp` is only shown through simulate: on real calls the emulator cannot tell a failed IP match from a missing key, so do not trust it as a network control.',
  examTags: ['SAA:Secure', 'DVA:Sec'],
  breakItCheck: 'denied',
  title: 'Conditions: narrowing access with condition keys',
  tagline: 'Let a user list only their own folder, then see exactly which request values the condition is matched against.',
  predict: [
    { id: 'p1', prompt: "`dev` may `s3:ListBucket` on `iam-lab` only when `s3:prefix` matches `home/dev/*` (StringLike). He runs `list-objects-v2 --bucket iam-lab` with no `--prefix`. What happens?", options: ['Allowed: an empty prefix matches everything under home/dev/', 'Denied: the request carries no s3:prefix value, so the condition is false', 'Allowed, but only keys under home/dev/ are returned', 'The CLI adds --prefix home/dev/ automatically'], answer: 1, explain: "A condition on a key the request does not contain evaluates to false (for the positive operators). The Allow does not apply, so the call falls to the implicit deny. The fix is a second statement or to teach the client to always send a prefix." },
    { id: 'p2', prompt: "Which statement about `ListBucket` and `GetObject` in a per-folder policy is correct?", options: ['Both use the bucket ARN as Resource', 'ListBucket takes the bucket ARN and the s3:prefix key; GetObject takes the object ARN `bucket/home/dev/*`', 'GetObject also supports s3:prefix', 'ListBucket takes the object ARN with a wildcard'], answer: 1, explain: "`s3:ListBucket` is a bucket-level action (Resource `arn:aws:s3:::bucket`) filtered by the `s3:prefix` condition key, while `s3:GetObject` is object-level (Resource `arn:aws:s3:::bucket/prefix/*`). Mixing them is the most common wrong answer." },
  ],
  concept: [
    "A **condition** is a block of `Operator: { key: value }` pairs inside a statement. All **operators** (blocks) must be true, and inside one block all **keys** must be true, while multiple **values** for the same key are OR-ed. That AND-of-blocks, AND-of-keys, OR-of-values rule is tested directly on the exams. Operators come in families: `StringEquals`, `StringLike` (with `*` and `?`), `ArnLike`, `NumericLessThan`, `DateGreaterThan`, `Bool`, `IpAddress`/`NotIpAddress`, and `Null` to test whether a key exists. A set-operator prefix `ForAllValues:` or `ForAnyValue:` changes how multi-valued request keys (such as tag keys) match, and the infamous trap is that `ForAllValues` is **true when the key is absent**, so pair it with a `Null` check.",
    "The condition keys you must recognise: **global** ones (`aws:SourceIp`, `aws:SourceVpce`, `aws:PrincipalOrgID`, `aws:MultiFactorAuthPresent`, `aws:SecureTransport`, `aws:CurrentTime`, `aws:RequestedRegion`, `aws:PrincipalTag/*`) and **service** ones (`s3:prefix`, `s3:x-amz-server-side-encryption`, `dynamodb:LeadingKeys`, `ec2:ResourceTag/*`). Two behaviours matter. A key that is **not in the request context** makes a positive operator false (so an Allow does not apply) but makes a negative one such as `StringNotEquals` or `NotIpAddress` **true**, which is why an `Effect: Deny` with a negated condition can lock out calls that simply lack the key. And **`aws:SourceIp` only describes the caller's public address**: calls made through a VPC endpoint or by an AWS service on your behalf carry something else (use `aws:SourceVpce` or `aws:ViaAWSService`).",
    "The classic per-folder policy therefore has two statements: `s3:ListBucket` on the **bucket ARN** with `StringLike: { s3:prefix: [\"home/dev/*\"] }`, and `s3:GetObject`/`s3:PutObject` on the **object ARN** `arn:aws:s3:::bucket/home/dev/*`. Forget the object-level statement and listing works but reading fails; forget the prefix condition and every user can list the whole bucket's keys. In real AWS you would write `home/${aws:username}/*` with a policy variable so one policy serves every user (lesson 1.7).",
    "Honesty on this module: `s3:prefix` is enforced by the emulator on real calls and fully testable. `aws:SourceIp` is demonstrated only through `simulate-custom-policy`, where you set the value yourself. In our probes a real call denied by `NotIpAddress` cannot be told apart from a call that was denied because the emulator never filled in the key, so a green or red result there would teach the wrong lesson. On real AWS `aws:SourceIp` works as the exam describes.",
  ],
  goal: "`dev` can list and read only under `home/dev/`, a listing of `home/other/` and a listing with no prefix are both denied, and you have simulated the same policy with context values, including an IP condition.",
  steps: [
    { id: 'policy', title: 'Attach the per-folder policy', body: "The fixture created bucket `iam-lab` with `home/dev/a.txt` and `home/other/b.txt`, and a user `dev`. Open `list-home-dev.json` in Files: statement 1 lets `dev` list the bucket only when `s3:prefix` matches `home/dev/*`; statement 2 allows `GetObject` on the object ARN `home/dev/*`.", commands: ['aws iam put-user-policy --user-name dev --policy-name home-dev --policy-document file://list-home-dev.json'] },
    { id: 'key', title: 'Mint access keys for dev', body: 'Copy the key id and secret for the commands below.', commands: ["aws iam create-access-key --user-name dev --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text"] },
    { id: 'ok', title: 'List your own folder', body: 'The request carries `s3:prefix = home/dev/`, so the condition is true. You get `a.txt`.', commands: [`${AS} aws s3api list-objects-v2 --bucket iam-lab --prefix home/dev/ --query 'Contents[].Key'`] },
    { id: 'break', title: "Break it: list somebody else's folder", body: 'Same user, same action, `s3:prefix = home/other/`. The condition is false, so the Allow does not apply.', commands: [`${AS} aws s3api list-objects-v2 --bucket iam-lab --prefix home/other/`], breakIt: true },
    { id: 'noprefix', title: 'The trap: list with no prefix at all', body: "No `--prefix` means no `s3:prefix` key in the request, and a positive `StringLike` on a missing key is false. This is denied too, even though everything `dev` wants is under `home/dev/`.", commands: [`${AS} aws s3api list-objects-v2 --bucket iam-lab`] },
    { id: 'sim', title: 'Simulate with context entries', body: "`simulate-principal-policy` does not make a request, so it has no prefix to send. You supply it with `--context-entries`. `home/dev/x` gives `allowed`, `home/other/x` gives `implicitDeny`. Without any entry the key is reported as missing and the verdict is implicitDeny.", commands: [simPrefix('home/dev/x'), simPrefix('home/other/x')] },
    { id: 'ip', title: 'aws:SourceIp, shown through simulate only', body: "`simulate-custom-policy` evaluates a policy you pass in, here an Allow only for `203.0.113.0/24`. An address inside the range is `allowed`; one outside is `implicitDeny`. This is how `aws:SourceIp` behaves on real AWS. We do not run it on a real call here: on this emulator that result is not reliable (see the note at the top).", commands: [simIp('203.0.113.9'), simIp('198.51.100.7')] },
  ],
  breakIt: {
    title: "List a prefix the condition does not allow",
    command: `${AS} aws s3api list-objects-v2 --bucket iam-lab --prefix home/other/`,
    explain: [
      "The Allow on `s3:ListBucket` exists, but its condition requires `s3:prefix` to match `home/dev/*`. With `home/other/` the condition is false, the Allow does not apply, and the result is an implicit deny: \"no identity-based policy allows the s3:ListBucket action\".",
      "A condition never turns into a Deny by itself. If you needed this to be a hard stop that no other policy could reopen, write a separate `Deny` statement with `StringNotLike` and think about what happens when the key is absent.",
    ],
  },
  realAws: {
    cost: ['IAM is free. S3 requests in the lab are covered by the free tier.'],
    differences: [
      'On real AWS `aws:SourceIp` is evaluated for calls from the public internet and ignored for requests that come through a VPC endpoint (use `aws:SourceVpce` or `aws:SourceVpc` there) or from an AWS service acting for you.',
      'Real AWS lets you test with the IAM Policy Simulator in the console, which also resolves real resource tags. `--context-entries` on the CLI is the same engine with values you supply.',
      'S3 also supports `s3:delimiter` and `s3:max-keys` condition keys on ListBucket, which this lab does not cover.',
    ],
    asOf: '2026-11-13',
    sources: [
      { label: 'IAM JSON policy elements: Condition', url: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_condition.html' },
      { label: 'Condition keys for Amazon S3', url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/amazon-s3-policy-keys.html' },
      { label: 'Global condition keys (aws:SourceIp)', url: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_condition-keys.html' },
    ],
  },
  fidelity: [{ service: 'IAM', pass: 502, total: 692 }, { service: 'S3', pass: 1025, total: 1226 }],
  files: ['list-home-dev.json'],
  checks: [
    { id: 'policy', label: '`dev` has a ListBucket Allow gated on `s3:prefix` (no wildcard action)', hint: 'Attach list-home-dev.json with put-user-policy (step 1).' },
    { id: 'key', label: '`dev` has an access key', hint: 'Run step 2.' },
    { id: 'ok', label: 'dev listed `home/dev/` successfully', hint: 'Run step 3 with dev\'s keys in front.' },
    { id: 'denied', label: 'You watched dev get AccessDenied on `home/other/`', hint: 'Run the break-it command with dev\'s keys.' },
    { id: 'noprefix', label: 'You saw that listing with no prefix is denied too', hint: 'Run step 5: no --prefix at all.' },
    { id: 'sim', label: 'You simulated `s3:prefix` values: allowed for home/dev/, implicitDeny for home/other/', hint: 'Run both simulate commands in step 6.' },
    { id: 'ip', label: 'You simulated aws:SourceIp inside and outside 203.0.113.0/24', hint: 'Run both commands in step 7.' },
  ],
}
