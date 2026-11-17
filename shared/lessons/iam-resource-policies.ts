import type { LessonContent } from '../types'

const DEV = 'AWS_ACCESS_KEY_ID=<KEY_ID> AWS_SECRET_ACCESS_KEY=<SECRET>'
const GUEST = 'AWS_ACCESS_KEY_ID=<GUEST_KEY_ID> AWS_SECRET_ACCESS_KEY=<GUEST_SECRET>'
const Q = 'https://sqs.us-east-1.amazonaws.com/000000000000/locked'

export const iamResourcePolicies: LessonContent = {
  id: 'iam-resource-policies',
  n: '1.5',
  trackId: 'iam',
  level: 'advanced',
  prereqs: ['iam-intern', 'iam-evaluation'],
  estMinutes: 30,
  honesty: 'live',
  honestyNote: 'S3 bucket policies, SQS queue policies, Lambda resource policies and KMS key policies are enforced on this emulator (hands-on here: S3 and SQS). DynamoDB resource policies are accepted but NOT enforced, so that exception is taught in text only.',
  examTags: ['SAA:Secure', 'DVA:Sec'],
  breakItCheck: 'deny',
  title: 'Resource-based policies: who can grant, who can deny',
  tagline: 'A bucket policy that overrules an Allow, one that grants a user with no permissions at all, and a queue policy that blocks one action.',
  predict: [
    { id: 'p1', prompt: "User `guest` (same account as the bucket) has **no** identity policy. The bucket policy has an Allow for `arn:...:user/guest` on `s3:GetObject`. Can guest read an object?", options: ['No: every principal needs an identity policy too', 'Yes: in the same account a resource policy that names the principal is enough', 'Only if the bucket policy also names the account root', 'Only with MFA'], answer: 1, explain: "Within one account, an Allow in either the identity policy or the resource policy suffices (with no explicit deny anywhere). Cross-account, both sides must allow. That asymmetry is a staple SAA question." },
    { id: 'p2', prompt: "`dev` has an identity policy allowing `s3:*`. The bucket policy denies `s3:GetObject` to `dev`. A GetObject by dev returns:", options: ['Allowed: identity and resource policies are OR-ed', 'Allowed: the identity policy is more specific', 'AccessDenied: any explicit Deny wins, wherever it is written', 'AccessDenied only if the bucket is versioned'], answer: 2, explain: 'Explicit deny is step one of evaluation and is not limited to the policy type it lives in. The resource policy can overrule the identity policy.' },
    { id: 'p3', prompt: "A DynamoDB table has a resource-based policy that denies `dynamodb:GetItem` to a user. On this emulator the user's GetItem will:", options: ['Be denied, like S3', 'Succeed: DynamoDB resource policies are not enforced here (they are on real AWS)', 'Fail with a ValidationException', 'Be throttled'], answer: 1, explain: 'This is the module\'s honest exception. Real DynamoDB enforces table and stream resource policies; the emulator accepts them without enforcing. Never use the emulator to prove a DynamoDB deny.' },
  ],
  concept: [
    "**Identity-based** policies attach to a user, group or role and say what that principal may do. **Resource-based** policies attach to the thing being accessed (S3 bucket, SQS queue, SNS topic, KMS key, Lambda function, Secrets Manager secret, ECR repo, API Gateway, role trust policy) and say *which principals* may do what to it, so they carry a `Principal` element that identity policies lack. Evaluation inside one account is a union with a veto: an Allow from either side is enough, any explicit Deny from either side wins. **Cross-account** is an intersection: the caller's account must allow it in an identity policy *and* the resource's account must allow it in the resource policy (or the principal must assume a role in the resource account). That one rule resolves most SAA \"two accounts, who needs what\" questions.",
    "Service details that the exams exploit. **S3**: bucket policy limit is 20 KB, `Principal: \"*\"` makes it public unless Block Public Access is on, `aws:SourceArn`/`aws:SourceAccount` guard service principals (confused deputy), and ACLs are disabled by default for new buckets (Object Ownership: bucket owner enforced). **SQS and SNS**: a service such as S3 or SNS can only send to your queue if the queue policy allows it, and the usual mistake is a missing or wrongly scoped `aws:SourceArn` condition. **Lambda**: `add-permission` writes the function's resource policy so another service or account can invoke it; the function's *execution role* is a different thing (what the function may call). **KMS**: the key policy is the one resource policy that is *mandatory*, and IAM policies only take effect if the key policy delegates to IAM (the default key policy's statement for `arn:aws:iam::ACCOUNT:root`), so deleting that statement can lock everyone but the key policy's named principals out.",
    "The exception to know: **DynamoDB** added resource-based policies for tables, indexes and streams (mainly for simple cross-account sharing and for blocking access paths such as public endpoints), and real DynamoDB enforces them like any other resource policy. On this emulator they are accepted but **not enforced**, so a hands-on deny would silently teach the wrong lesson. We therefore do not test it, we only state it.",
    "In this lab you will see three behaviours with real calls: (1) a bucket-policy Deny overrules `dev`'s Allow, (2) a bucket-policy Allow grants a user who has no identity policy at all, and (3) a queue-policy Deny stops one action (`SendMessage`) while another (`ReceiveMessage`) still works. One more thing worth watching: `put-bucket-policy` **replaces** the whole document, which is why step 8 swaps the deny for the grant.",
  ],
  goal: "A bucket-policy Deny stopped `dev`, a bucket-policy Allow let `guest` (no identity policy) read, and a queue policy denied `SendMessage` until you removed it.",
  steps: [
    { id: 'devpol', title: 'Give dev broad identity permissions', body: "The fixture created bucket `iam-lab` with `h.txt`, queue `locked`, and users `dev` and `guest`. `dev-allow.json` allows `s3:*` and `sqs:*` on `*`. Attach it to `dev` and make keys.", commands: ['aws iam put-user-policy --user-name dev --policy-name allow-all --policy-document file://dev-allow.json', "aws iam create-access-key --user-name dev --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text"] },
    { id: 'baseline', title: 'dev can read', body: 'Identity Allow, no resource policy yet. Allowed.', commands: [`${DEV} aws s3api get-object --bucket iam-lab --key h.txt h-copy.txt`] },
    { id: 'deny', title: 'Attach a bucket policy that denies dev', body: "`bucket-deny-dev.json` has `Effect: Deny, Principal: user/dev, Action: s3:GetObject`. You are running as the emulator's admin, so you may write it.", commands: ['aws s3api put-bucket-policy --bucket iam-lab --policy file://bucket-deny-dev.json'] },
    { id: 'break', title: 'Break it: dev reads again', body: "`dev` still has `s3:*`. The bucket policy's explicit Deny wins. Look at the error: it mentions an explicit deny in a *resource-based policy*.", commands: [`${DEV} aws s3api get-object --bucket iam-lab --key h.txt h-again.txt`], breakIt: true },
    { id: 'guest', title: 'guest has nothing, and gets nothing', body: "Mint keys for `guest`, who has no identity policy of any kind, then try to read. Implicit deny.", commands: ["aws iam create-access-key --user-name guest --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text", `${GUEST} aws s3api get-object --bucket iam-lab --key h.txt g.txt`] },
    { id: 'grant', title: 'Grant guest through the bucket policy alone', body: "`bucket-grant-guest.json` allows `user/guest` to `GetObject`. `put-bucket-policy` replaces the document, so `dev`'s deny disappears at the same moment. Guest now reads with no identity policy.", commands: ['aws s3api put-bucket-policy --bucket iam-lab --policy file://bucket-grant-guest.json', `${GUEST} aws s3api get-object --bucket iam-lab --key h.txt g.txt`] },
    { id: 'queue', title: 'A queue policy that denies one action', body: "`queue-deny.json` is an `Attributes` map with a `Policy` that denies `sqs:SendMessage` to `dev`. Apply it, then compare `SendMessage` (denied) with `ReceiveMessage` (allowed).", commands: [`aws sqs set-queue-attributes --queue-url ${Q} --attributes file://queue-deny.json`, `${DEV} aws sqs send-message --queue-url ${Q} --message-body hello`, `${DEV} aws sqs receive-message --queue-url ${Q}`] },
    { id: 'fix', title: 'Remove the queue policy', body: 'Setting `Policy` to an empty value removes it. Now the same send works.', commands: [`aws sqs set-queue-attributes --queue-url ${Q} --attributes Policy=`, `${DEV} aws sqs send-message --queue-url ${Q} --message-body hello`] },
  ],
  breakIt: {
    title: 'Read an object that the bucket policy denies you',
    command: `${DEV} aws s3api get-object --bucket iam-lab --key h.txt h-again.txt`,
    explain: [
      "Two policy types voted: the identity policy said Allow, the bucket policy said Deny. A Deny anywhere is final. This is also how a security team blocks a user from a bucket without touching the user's own policies (or the user's team).",
      "Also notice the inverse in step 5-6: guest was denied (implicit) and then allowed by a resource policy alone. Same account, no identity policy needed. Across accounts that would not work: the caller's account would also have to allow it.",
    ],
  },
  realAws: {
    cost: ['IAM, S3 policies and SQS policies are free (SQS requests and S3 requests in the lab fit in the free tier).'],
    differences: [
      'The emulator enforces S3 bucket policies, SQS queue policies, Lambda resource policies and KMS key policies, but not DynamoDB resource policies. Real AWS enforces all of them.',
      'Real S3 adds Block Public Access, ACLs and Object Ownership, which interact with bucket policies and are not modelled here.',
      'Cross-account access (identity policy in one account plus a resource policy in the other) cannot be shown on a single-account emulator.',
    ],
    asOf: '2026-11-13',
    sources: [
      { label: 'Identity-based vs resource-based policies', url: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_identity-vs-resource.html' },
      { label: 'Bucket policy examples', url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/example-bucket-policies.html' },
      { label: 'Key policies in AWS KMS', url: 'https://docs.aws.amazon.com/kms/latest/developerguide/key-policies.html' },
    ],
  },
  fidelity: [{ service: 'IAM', pass: 502, total: 692 }, { service: 'S3', pass: 1025, total: 1226 }, { service: 'SQS', pass: 299, total: 335 }],
  files: ['dev-allow.json', 'bucket-deny-dev.json', 'bucket-grant-guest.json', 'queue-deny.json'],
  checks: [
    { id: 'devpol', label: '`dev` has an identity Allow and keys', hint: 'Run both commands in step 1.' },
    { id: 'deny', label: 'You watched a bucket-policy Deny beat dev\'s identity Allow', hint: 'Read as dev before the bucket policy, attach the deny (step 3), then run the break-it command.' },
    { id: 'guestdenied', label: '`guest` was refused while nothing allowed it', hint: 'Run step 5 (keys, then the get-object).' },
    { id: 'grant', label: '`guest` reads through the bucket policy alone (still no identity policy)', hint: 'Attach bucket-grant-guest.json and read as guest (step 6).' },
    { id: 'sqsdeny', label: 'A queue policy denied dev\'s SendMessage while ReceiveMessage still worked', hint: 'Apply queue-deny.json and run the send and receive commands (step 7).' },
    { id: 'sqsfix', label: 'After removing the queue policy, dev\'s SendMessage worked', hint: 'Run step 8.' },
  ],
}
