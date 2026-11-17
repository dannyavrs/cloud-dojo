import type { LessonContent } from '../types'

const AS = 'AWS_ACCESS_KEY_ID=<KEY_ID> AWS_SECRET_ACCESS_KEY=<SECRET>'
const ROLE = 'AWS_ACCESS_KEY_ID=<ROLE_KEY_ID> AWS_SECRET_ACCESS_KEY=<ROLE_SECRET> AWS_SESSION_TOKEN=<ROLE_TOKEN>'

export const iamRolesSts: LessonContent = {
  id: 'iam-roles-sts',
  n: '1.4',
  trackId: 'iam',
  level: 'intermediate',
  prereqs: ['iam-intern', 'iam-evaluation'],
  estMinutes: 25,
  honesty: 'live',
  honestyNote: 'Roles, trust policies and AssumeRole are enforced. Session policies (`--policy` on assume-role) are NOT: the emulator accepts the argument but does not narrow the session, so that part is concept only (read it, answer the quiz).',
  examTags: ['SAA:Secure', 'DVA:Sec'],
  breakItCheck: 'put-denied',
  title: 'Roles, trust policies and STS',
  tagline: 'Become a role with temporary credentials, and see why two different policies decide who may assume it.',
  predict: [
    { id: 'p1', prompt: "Role `auditor` has a trust policy naming user `dev` and a permissions policy allowing only `s3:GetObject`. `dev` also has `s3:*` in his own identity policy. After `dev` assumes `auditor`, can the session upload an object?", options: ['Yes, the session keeps dev\'s permissions plus the role\'s', 'No, the session has only the role\'s permissions; dev\'s own are dropped', 'Yes, but only if dev passes MFA', 'It depends on the session name'], answer: 1, explain: "Assuming a role *replaces* the caller's identity: the temporary credentials carry the role's permissions only. This is why switching role is a clean way to drop privilege (and why `dev`'s s3:* is irrelevant inside the session)." },
    { id: 'p2', prompt: "You call `sts:AssumeRole` with `--policy` to pass an inline **session policy** that allows only `s3:ListBucket` on a role that allows `s3:*`. On real AWS the session can do:", options: ['s3:* (the session policy is only advisory)', 'Only s3:ListBucket: the effective permissions are the intersection of role policy and session policy', 's3:* plus s3:ListBucket', 'Nothing: session policies require a boundary'], answer: 1, explain: "On real AWS a session policy can only reduce: effective permissions = role identity policies ∩ session policy (∩ boundary). The emulator accepts `--policy` but ignores it (the lesson's honesty note), so you cannot demonstrate this here." },
  ],
  concept: [
    "A **role** has two independent policy sets, and exam questions are built on confusing them. The **trust policy** (`AssumeRolePolicyDocument`) is a *resource-based policy on the role* that says **who may call `sts:AssumeRole`** (`Principal`: a user, account root, a service such as `lambda.amazonaws.com`, a SAML or OIDC provider). The **permissions policies** say **what the session may do**. Same account: a trust policy that names the *specific user or role ARN* is enough by itself; if it names the account root (`arn:aws:iam::123456789012:root`) it only delegates the decision, and the caller's own identity policy must then allow `sts:AssumeRole` on the role. **Cross-account** needs both sides: the trust policy in the target account *and* an identity policy in the caller's account.",
    "`AssumeRole` returns **temporary credentials**: `AccessKeyId` (prefix `ASIA` on real AWS), `SecretAccessKey` and a `SessionToken`, valid 15 minutes to 12 hours (default one hour; the role's `MaxSessionDuration` is the cap, and **role chaining** caps at one hour). All three values must be sent together. The principal in CloudTrail and in AccessDenied messages is `arn:aws:sts::ACCOUNT:assumed-role/ROLE/SESSION`. Know the family: `AssumeRoleWithWebIdentity` (OIDC, what Cognito/EKS use), `AssumeRoleWithSAML`, `GetSessionToken` (a user adds MFA to their own permissions; it cannot call most IAM APIs), `GetFederationToken`, and `sts:SetSourceIdentity`/`sts:TagSession` for attribution and ABAC. Trust conditions you will see: `aws:MultiFactorAuthPresent`, `sts:ExternalId` (the confused-deputy guard for third-party access), `aws:PrincipalOrgID`.",
    "**Session policies** are the third guard-rail: pass `--policy` (inline JSON) or `--policy-arns` to `AssumeRole`, and the session gets *at most* the intersection of the role's permissions and the session policy. They never grant. They are how a broker service hands out narrowly scoped credentials per request from one broad role. Honest note for this lab: the emulator accepts `--policy` but does **not** narrow the session (in our probe a Get still succeeded with a List-only session policy), so there is no step for it here. Know it for the exam: it intersects, it cannot add, and the limit is 2,048 characters for the packed policy.",
    "In this lab you will build the whole loop with real calls: create the role and trust, let `dev` assume it, check `get-caller-identity` shows the assumed-role ARN, prove the role can read but not write, and show that a role whose trust policy does not name you refuses to be assumed (the fixture's `admin-only` requires MFA, so `dev` cannot assume it).",
  ],
  goal: "`dev` assumed role `auditor`, the session ARN reads `assumed-role/auditor/s1`, the session can read but not write, and assuming `admin-only` is refused.",
  steps: [
    { id: 'role', title: 'Create the role with a trust policy', body: "The fixture created bucket `iam-lab` (object `h.txt`), user `dev`, and a role `admin-only` whose trust policy requires MFA. `trust-dev.json` lets exactly `user/dev` call `sts:AssumeRole`. Create `auditor` with it.", commands: ['aws iam create-role --role-name auditor --assume-role-policy-document file://trust-dev.json'] },
    { id: 'rolepol', title: 'Give the role read-only permissions', body: "Trust says who may *become* the role. This inline policy (`auditor-read.json`) says what the role may *do*: `s3:GetObject` on `iam-lab/*` only.", commands: ['aws iam put-role-policy --role-name auditor --policy-name read-only --policy-document file://auditor-read.json'] },
    { id: 'devpol', title: 'Allow dev to call AssumeRole', body: "`dev-assume.json` allows `sts:AssumeRole` on the `auditor` role. With a trust policy that names the user this is belt and braces; if the trust policy only named the account root it would be required.", commands: ['aws iam put-user-policy --user-name dev --policy-name assume-auditor --policy-document file://dev-assume.json'] },
    { id: 'key', title: 'Mint access keys for dev', body: 'Copy the key id and secret.', commands: ["aws iam create-access-key --user-name dev --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text"] },
    { id: 'assume', title: 'Assume the role as dev', body: 'Three values come back: access key id, secret and session token. Copy all three. They expire after an hour (the default). Substitute them as `<ROLE_KEY_ID>`, `<ROLE_SECRET>` and `<ROLE_TOKEN>` below.', commands: [`${AS} aws sts assume-role --role-arn arn:aws:iam::000000000000:role/auditor --role-session-name s1 --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' --output text`] },
    { id: 'whoami', title: 'Who am I now?', body: 'All three variables in front of the command. The ARN shows the session, not `dev`.', commands: [`${ROLE} aws sts get-caller-identity`] },
    { id: 'read', title: 'Read as the role', body: 'The role allows GetObject.', commands: [`${ROLE} aws s3api get-object --bucket iam-lab --key h.txt h-copy.txt`] },
    { id: 'break', title: 'Break it: write as the role', body: "`dev` has no s3 permissions here, but that is not why this fails: the session has *only* the role's permissions, and the role has no PutObject.", commands: [`${ROLE} aws s3api put-object --bucket iam-lab --key y.txt`], breakIt: true },
    { id: 'untrusted', title: 'Assume a role that does not trust you', body: "`admin-only` trusts the account root only when MFA is present. `dev` is not MFA-authenticated, so the trust policy refuses the call: AccessDenied on `sts:AssumeRole`, not on any S3 action.", commands: [`${AS} aws sts assume-role --role-arn arn:aws:iam::000000000000:role/admin-only --role-session-name s2`] },
    { id: 'session', title: 'Read, do not run: session policies', body: "`aws sts assume-role ... --policy file://narrow.json` would cap the session at the intersection of the role and `narrow.json`. The emulator accepts the flag but does not narrow, so a run here would mislead you. The quiz question above covers what AWS does." },
  ],
  breakIt: {
    title: 'A write the assumed role was never given',
    command: `${ROLE} aws s3api put-object --bucket iam-lab --key y.txt`,
    explain: [
      "The AccessDenied message names `assumed-role/auditor/s1`, not `user/dev`. Whatever `dev` can do on his own is gone during the session: you swapped identities, you did not add to them.",
      "On the exam this is the answer to \"why can the role not do X\": look at the role's permissions policies. The question \"why can `dev` not assume the role\" is about the trust policy, and a failing AssumeRole shows up as an `sts:AssumeRole` denial (step 9), not as an S3 error.",
    ],
  },
  realAws: {
    cost: ['IAM and STS are free.'],
    differences: [
      'Real temporary access keys start with `ASIA`; the emulator uses its own `EMULATOR…` prefix. Always send the session token with them.',
      'Session policies (`--policy`, `--policy-arns`) narrow the session on real AWS. The emulator ignores them.',
      'Real AWS lets you restrict roles by `aws:PrincipalOrgID`, `sts:ExternalId` and source identity. Cross-account assume needs a trust policy in the target account and an identity policy in the caller account.',
    ],
    asOf: '2026-11-13',
    sources: [
      { label: 'Roles terms and concepts', url: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_terms-and-concepts.html' },
      { label: 'AssumeRole', url: 'https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumeRole.html' },
      { label: 'Session policies', url: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies.html#policies_session' },
    ],
  },
  fidelity: [{ service: 'IAM', pass: 502, total: 692 }, { service: 'STS', pass: 94, total: 171 }, { service: 'S3', pass: 1025, total: 1226 }],
  files: ['trust-dev.json', 'auditor-read.json', 'dev-assume.json'],
  checks: [
    { id: 'role', label: 'Role `auditor` trusts `user/dev` and nobody wider', hint: 'Create it with trust-dev.json (step 1).' },
    { id: 'rolepol', label: 'IAM says the role may GetObject but not PutObject', hint: 'Attach auditor-read.json with put-role-policy (step 2).' },
    { id: 'assume', label: 'dev assumed `auditor` and got temporary credentials', hint: 'Run step 5 with dev\'s keys in front.' },
    { id: 'whoami', label: 'The session identity is `assumed-role/auditor/…`', hint: 'Run step 6 with all three variables.' },
    { id: 'read', label: 'The session read `h.txt`', hint: 'Run step 7 with the session credentials.' },
    { id: 'put-denied', label: 'You watched the session get AccessDenied on PutObject', hint: 'Run the break-it command with all three variables.' },
    { id: 'untrusted', label: 'You saw dev refused when assuming `admin-only`', hint: 'Run step 9.' },
  ],
}
