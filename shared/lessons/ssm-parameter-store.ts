import type { LessonContent } from '../types'

const READER = 'AWS_ACCESS_KEY_ID=<KEY_ID> AWS_SECRET_ACCESS_KEY=<SECRET>'

export const READER_KMS = JSON.stringify({
  Version: '2012-10-17',
  Statement: [{ Effect: 'Allow', Action: 'kms:Decrypt', Resource: '*' }],
}, null, 2)

export const ssmParameterStore: LessonContent = {
  id: 'ssm-parameter-store',
  n: '11.4',
  trackId: 'security',
  level: 'intermediate',
  prereqs: ['kms-envelope'],
  estMinutes: 35,
  honesty: 'live',
  honestyNote: 'Parameter Store behaves like AWS for what this module teaches: String and SecureString types, hierarchies and by-path reads, versions, overwrite rules and kms:Decrypt on a customer managed key. The emulator does NOT evaluate IAM permissions on ssm actions (a user with no SSM policy can still read parameters), so this module never relies on them. Only Parameter Store is covered; the SSM service as a whole is only about 24% verified.',
  examTags: ['DVA:Sec', 'DVA:Dev', 'SAA:Secure'],
  breakItCheck: 'breakit',
  editable: ['reader-kms.json'],
  title: 'Parameter Store: configuration, SecureString and what decryption really needs',
  tagline: 'Store plain and secret parameters in a path hierarchy, read a SecureString without decryption, version it, and gate it with a KMS key.',
  predict: [
    { id: 'p1', prompt: 'You read a SecureString parameter with `ssm get-parameter` and no `--with-decryption`. What do you get?', options: ['An AccessDeniedException', 'The plaintext value, SecureString is only a label', 'The value as ciphertext (an opaque base64 string), with no error', 'An empty value'], answer: 2, explain: 'Without WithDecryption=true Parameter Store returns the encrypted value. There is no error, which is exactly why applications that forget the flag get garbage in their config instead of an exception.' },
    { id: 'p2', prompt: 'A SecureString is encrypted with a customer managed KMS key. A role has ssm:GetParameter on it but no kms:Decrypt on the key. What does get-parameter --with-decryption do?', options: ['Returns the plaintext: ssm:GetParameter is enough', 'Fails with AccessDenied for kms:Decrypt: the caller needs both permissions (and the key policy must allow them)', 'Returns ciphertext silently', 'Falls back to the AWS managed key'], answer: 1, explain: 'Decrypting a SecureString is a KMS call made on behalf of the caller, so the caller needs kms:Decrypt on the key (identity policy and key policy). With the default AWS managed key aws/ssm the key policy already trusts everyone in the account who can call SSM, so no explicit kms permission is needed; with a CMK you control who may decrypt.' },
    { id: 'p3', prompt: 'Parameters /shop/prod/a, /shop/prod/b and /shop/dev/c exist. What does `get-parameters-by-path --path /shop` return without --recursive?', options: ['All three', 'Only /shop/prod/a and /shop/prod/b', 'None: by default only parameters directly under the path are returned, and all of these are two levels deeper', 'An error: the path must name a parameter'], answer: 2, explain: 'GetParametersByPath returns the parameters one level below the path unless Recursive is true. /shop has only the sub-paths prod and dev, so you get nothing; --path /shop/prod returns a and b; --recursive on /shop returns all three.' },
  ],
  concept: [
    "**Parameter Store** (part of Systems Manager) holds configuration as named parameters. Names can form a **hierarchy** (`/shop/prod/db-password`), which lets one call fetch everything for an app and environment with `get-parameters-by-path` (one level by default, `--recursive` for the whole subtree) and lets you scope IAM permissions by path (`arn:aws:ssm:...:parameter/shop/prod/*`). Types: **String**, **StringList** and **SecureString**. A SecureString is encrypted with a KMS key at rest: the AWS managed key `alias/aws/ssm` by default, or a customer managed key you name with `--key-id`. Standard parameters are free (up to 10,000 per account and Region, values up to 4 KB); the **Advanced** tier (8 KB, policies such as expiration and notification, higher throughput) is billed per parameter per month.",
    "Reading is where the traps are. `get-parameter` returns a SecureString as **ciphertext** unless you pass `--with-decryption` (`WithDecryption=true` in an SDK). Nothing fails; your app just gets an unusable string. With decryption, SSM calls KMS **as the caller**, so a role needs `ssm:GetParameter(s)` **and** `kms:Decrypt` on the key, and the key policy must allow it. With the default AWS managed key the key policy already lets any principal in the account that is allowed to use SSM decrypt, so you get no separation of duties; with a **customer managed key** you can let the application role decrypt and deny everyone else, which is the usual answer to 'only the payment service may read this parameter'. Every change creates a new **version** (1, 2, ...); `put-parameter` on an existing name fails with `ParameterAlreadyExists` unless you add `--overwrite`, old versions stay readable with `name:1`, and **labels** (`name:stable`) give versions stable aliases.",
    "**Parameter Store or Secrets Manager?** Both hold secrets and both use KMS. Secrets Manager adds **automatic rotation** (11.3), cross-account sharing through resource policies and native RDS integration, and costs per secret per month. Parameter Store is cheaper (free for standard parameters), good for configuration and for secrets you never rotate automatically, and has a cleaner hierarchy and a `ssm:` dynamic reference for CloudFormation. A common split: feature flags, endpoints and tuning knobs in Parameter Store; database credentials with rotation in Secrets Manager. Lambda and ECS can inject either as environment variables or fetch them at start-up; cache the value, because both services have API rate limits and every read of a SecureString also costs a KMS request.",
    "In this module you create three parameters, read a SecureString the wrong way and the right way, page by path, overwrite and read history, then put a SecureString under a customer managed key and see a reader refused until it gets `kms:Decrypt`. Note the honest limit of the emulator: it does not evaluate IAM permissions on `ssm:` actions at all (the `reader` user gets an SSM policy for realism, but nothing here depends on it). The KMS side is enforced, and that is the part the exam cares about. Parameter values are printed in your terminal; the checker compares them on the server and returns none.",
  ],
  goal: 'Three parameters under /shop (one SecureString on the default key), the ciphertext trap seen, a correct decrypt, path reads that return 2 and 3, a second version, and a SecureString on a CMK that a reader can decrypt only after it gets kms:Decrypt.',
  steps: [
    { id: 'look', title: 'Check the starting point', body: "The fixture created a customer managed key with alias `alias/app-config` and a user `reader`. No parameters exist yet.", commands: ["aws ssm describe-parameters --query 'length(Parameters)' --output text", "aws kms list-aliases --query \"Aliases[?AliasName=='alias/app-config'].AliasName\" --output text"] },
    { id: 'put', title: 'Create a plain parameter and two SecureStrings', body: "Two environments, one hierarchy. The SecureStrings use the default AWS managed key because no `--key-id` is given.", commands: ['aws ssm put-parameter --name /shop/prod/log-level --value info --type String', "aws ssm put-parameter --name /shop/prod/db-password --value 'Sup3rS3cret!' --type SecureString", "aws ssm put-parameter --name /shop/dev/db-password --value 'devpass' --type SecureString"] },
    { id: 'break', title: 'Break it: read a SecureString without --with-decryption', body: "No error, no plaintext: the value is ciphertext. This is the bug you meet in real apps that forgot the flag.", commands: ['aws ssm get-parameter --name /shop/prod/db-password --query Parameter.Value --output text'], breakIt: true },
    { id: 'decrypt', title: 'Read it properly', body: 'With `--with-decryption` SSM calls KMS for you and returns `Sup3rS3cret!`.', commands: ['aws ssm get-parameter --name /shop/prod/db-password --with-decryption --query Parameter.Value --output text'] },
    { id: 'path', title: 'Read by path, one level and recursive', body: "`/shop/prod` has two parameters directly under it. `/shop` has none directly under it (only sub-paths). Add `--recursive` and you get all three.", commands: ["aws ssm get-parameters-by-path --path /shop/prod --query 'length(Parameters)' --output text", "aws ssm get-parameters-by-path --path /shop --query 'length(Parameters)' --output text", "aws ssm get-parameters-by-path --path /shop --recursive --query 'length(Parameters)' --output text"] },
    { id: 'versions', title: 'Overwrite and read history', body: "Writing an existing name fails unless you pass `--overwrite`. After it, version 2 is current and version 1 is still readable with `name:1`.", commands: ['aws ssm put-parameter --name /shop/prod/log-level --value debug --type String', 'aws ssm put-parameter --name /shop/prod/log-level --value debug --type String --overwrite', "aws ssm get-parameter-history --name /shop/prod/log-level --query 'Parameters[].[Version,Value]' --output text", 'aws ssm get-parameter --name /shop/prod/log-level:1 --query Parameter.Value --output text'] },
    { id: 'cmk', title: 'Put a SecureString under your own key and gate it', body: "`api-key` is encrypted with `alias/app-config`. Create access keys for `reader` and read the default-key password first (works: the AWS managed key does not gate anyone). Then read `api-key` with decryption: refused, `reader` lacks `kms:Decrypt` on your key. Attach `reader-kms.json` and read again.", commands: ["aws ssm put-parameter --name /shop/prod/api-key --value 'k-12345' --type SecureString --key-id alias/app-config", "aws iam create-access-key --user-name reader --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text", `${READER} aws ssm get-parameter --name /shop/prod/db-password --with-decryption --query Parameter.Name --output text`, `${READER} aws ssm get-parameter --name /shop/prod/api-key --with-decryption --query Parameter.Name --output text`, 'aws iam put-user-policy --user-name reader --policy-name kms-decrypt --policy-document file://reader-kms.json', `${READER} aws ssm get-parameter --name /shop/prod/api-key --with-decryption --query Parameter.Name --output text`] },
  ],
  breakIt: {
    title: 'Reading a SecureString without --with-decryption',
    command: 'aws ssm get-parameter --name /shop/prod/db-password --query Parameter.Value --output text',
    explain: [
      "It succeeds, and that is the problem: you get an opaque base64 string, the encrypted value. The type says `SecureString`, but only `--with-decryption` (WithDecryption=true in SDKs) turns it into plaintext. Applications that skip it end up sending ciphertext as the database password.",
      "The inverse mistake is also real: `--with-decryption` on a plain String is harmless, so a safe habit is to always pass it. Remember the caller then needs `kms:Decrypt` on the key for a customer managed key.",
    ],
  },
  realAws: {
    cost: [
      "Standard parameters are free (10,000 per Region, 4 KB values) and standard throughput is limited by default. Advanced parameters cost about 0.05 USD per parameter per month, and higher-throughput API usage is billed per 10,000 interactions. A customer managed key adds the KMS fees (about 1 USD per month). List prices as of 2026-11-15, check before relying on them.",
      "Secrets Manager costs about 0.40 USD per secret per month; that is the trade for rotation and cross-account sharing.",
    ],
    differences: [
      "Real IAM evaluates ssm: permissions, including path-scoped Resource ARNs and explicit Deny. The emulator does not, so a user without any SSM policy can read parameters. Do not use this lab to prove SSM IAM scoping works; the KMS decrypt gate on a CMK is enforced here and on AWS.",
      "The emulator only implements about a quarter of the Systems Manager API surface. Run Command, Automation, Session Manager, patching and the rest of SSM are out of scope for this module.",
      "Real parameter policies (expiration, notification) exist only on Advanced parameters.",
    ],
    asOf: '2026-11-15',
    sources: [
      { label: 'AWS Systems Manager Parameter Store', url: 'https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html' },
      { label: 'Working with parameter hierarchies', url: 'https://docs.aws.amazon.com/systems-manager/latest/userguide/sysman-paramstore-hierarchies.html' },
      { label: 'Using KMS with SecureString parameters', url: 'https://docs.aws.amazon.com/systems-manager/latest/userguide/secure-string-parameter-kms-encryption.html' },
      { label: 'Parameter Store vs Secrets Manager', url: 'https://docs.aws.amazon.com/systems-manager/latest/userguide/integration-ps-secretsmanager.html' },
    ],
  },
  fidelity: [{ service: 'SSM', pass: 111, total: 457 }, { service: 'KMS', pass: 291, total: 310 }],
  files: ['reader-kms.json'],
  checks: [
    { id: 'params', label: 'Three parameters exist under /shop: one String and two SecureStrings', hint: 'Run the three put-parameter commands in step 2.' },
    { id: 'breakit', label: 'You read a SecureString without decryption and got ciphertext', hint: 'Run the break-it command (no --with-decryption).' },
    { id: 'decrypted', label: 'You read the same SecureString with --with-decryption', hint: 'Add --with-decryption to get the plaintext.' },
    { id: 'path', label: 'By-path reads returned 2 for /shop/prod, 0 for /shop and 3 with --recursive', hint: 'Run the three get-parameters-by-path commands.' },
    { id: 'versions', label: '`/shop/prod/log-level` is at version 2 after you saw ParameterAlreadyExists', hint: 'Run put-parameter twice: without --overwrite (fails) and with it.' },
    { id: 'cmk', label: '`/shop/prod/api-key` is a SecureString encrypted with `alias/app-config`', hint: 'Put it with --key-id alias/app-config.' },
    { id: 'gate', label: '`reader` was refused on the CMK parameter until it got kms:Decrypt', hint: 'Read as reader (fails), attach reader-kms.json, read as reader again.' },
  ],
}
