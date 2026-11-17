import type { LessonContent } from '../types'

const AS = 'AWS_ACCESS_KEY_ID=<KEY_ID> AWS_SECRET_ACCESS_KEY=<SECRET>'
const B = 'arn:aws:iam::000000000000:policy/read-only-boundary'
const simDev = 'aws iam simulate-principal-policy --policy-source-arn arn:aws:iam::000000000000:user/dev --action-names s3:GetObject s3:PutObject --resource-arns arn:aws:s3:::iam-lab/h.txt --query "EvaluationResults[].[EvalActionName,EvalDecision,PermissionsBoundaryDecisionDetail.AllowedByPermissionsBoundary]" --output text'
const simLead = (ctx: boolean) => `aws iam simulate-principal-policy --policy-source-arn arn:aws:iam::000000000000:user/team-lead --action-names iam:CreateUser ${ctx ? `--context-entries ContextKeyName=iam:PermissionsBoundary,ContextKeyValues=${B},ContextKeyType=string ` : ''}--query "EvaluationResults[].[EvalActionName,EvalDecision]" --output text`

export const iamBoundaries: LessonContent = {
  id: 'iam-boundaries',
  n: '1.6',
  trackId: 'iam',
  level: 'advanced',
  prereqs: ['iam-evaluation'],
  estMinutes: 25,
  honesty: 'simulated',
  requires: ['permission-boundary'],
  honestyNote: 'This module teaches permission boundaries through `simulate-principal-policy`, which evaluates them correctly. A real call on the emulator ignores the boundary (the PutObject in step 6 succeeds), whereas AWS would refuse it. The checker uses the simulation only.',
  examTags: ['SAA:Secure', 'DVA:Sec'],
  breakItCheck: 'real',
  title: 'Permission boundaries and safe delegation',
  tagline: 'Cap what a user can ever be granted, and let a team lead create users only if they carry the cap.',
  predict: [
    { id: 'p1', prompt: "`dev` has an identity policy that allows `s3:*`. His permissions boundary allows only `s3:Get*` and `s3:List*`. What are his effective S3 permissions on AWS?", options: ['s3:* (identity policy wins)', 's3:Get* and s3:List* (the intersection)', 's3:* plus Get* and List*', 'Nothing: boundaries replace identity policies'], answer: 1, explain: 'A boundary never grants. Effective permissions for an identity are what the identity policy allows AND the boundary allows (and any SCP and session policy). Neither a boundary alone nor an identity policy alone is enough.' },
    { id: 'p2', prompt: "A team lead may create IAM roles for developers. Which control stops a developer role from being created with more power than the lead is allowed to hand out?", options: ['An SCP that denies iam:CreateRole', 'An identity policy for the lead that allows iam:CreateRole only when `iam:PermissionsBoundary` equals the approved boundary ARN', 'MFA on the lead', 'A bucket policy'], answer: 1, explain: "That is the standard delegated-administration pattern: the lead can create principals only if the same API call attaches the approved boundary (condition key `iam:PermissionsBoundary`), plus a deny on `DeleteUserPermissionsBoundary`, so the cap cannot be removed afterwards." },
    { id: 'p3', prompt: "On this emulator, the boundary is attached to `dev` and `simulate-principal-policy` says PutObject is implicitDeny. What will a real `put-object` as dev do?", options: ['Be denied, the same as the simulation', 'Succeed: the emulator does not apply boundaries to real calls (AWS would deny)', 'Fail with a ValidationException', 'Be queued'], answer: 1, explain: "That gap is why this module is badged Simulated. The IAM evaluation engine behind `simulate-principal-policy` handles boundaries; the request path does not. You will see both side by side in step 6." },
  ],
  concept: [
    "A **permissions boundary** is a managed policy attached to a *user or role* (not a group) that sets the **maximum** permissions that identity can have. It grants nothing on its own. Effective permissions are the intersection of the identity-based policies and the boundary, further intersected with any SCP and session policy. Two sharp corners for the exam: a **resource-based policy that names the principal directly** (for example an S3 bucket policy for `user/dev` or the role ARN) is *not* limited by the boundary in the same account, and an explicit Deny in the boundary is, like any Deny, final. A boundary also has no effect on what *other* principals can do: it is a property of the identity it is attached to.",
    "The use case is **safe delegation**. You want developers to create their own roles (for Lambda, ECS, CI) without calling a central admin, but you do not want them to create a role with `AdministratorAccess` and then assume it. You give the developer (or a team-lead role) an identity policy that allows `iam:CreateRole`, `iam:AttachRolePolicy`, `iam:PutRolePolicy` **only** `Condition: StringEquals: { iam:PermissionsBoundary: <approved boundary ARN> }`, a deny on `iam:DeleteRolePermissionsBoundary`/`iam:PutRolePermissionsBoundary` to anything else, and a deny on modifying the boundary policy itself. Every role the developer creates is then capped by the boundary, and the developer cannot lift it. The mistake the exam likes: the delegator may attach any managed policy but forgot the boundary condition, so the created role is uncapped.",
    "Compare the three guard-rails by *where they are attached and who sees them*. An **SCP** (Organizations) caps every principal in an account or OU, including the account's root user (but not the management account) and does not apply to service-linked roles. A **permissions boundary** caps one user or role. A **session policy** caps one assumed-role or federated session. All three only restrict. Quotas: one boundary per user/role; a managed policy up to 6,144 characters.",
    "Honest picture on this emulator: `simulate-principal-policy` implements the boundary (it will report `PermissionsBoundaryDecisionDetail.AllowedByPermissionsBoundary: false` and an `implicitDeny`), but a real request as the user is not stopped. So the lesson shows both: the simulation says no, the real call says yes, and AWS would say no. The checker only trusts the simulation. If a future emulator enforces boundaries on real calls, this module flips to Live on its own.",
  ],
  goal: "`dev` has an `s3:*` identity policy and a read-only boundary, IAM simulates PutObject as denied by the boundary, you saw the real call go through on the emulator, and a team lead can create users only when the boundary is attached.",
  steps: [
    { id: 'devpol', title: 'Give dev a broad identity policy', body: "The fixture created bucket `iam-lab` (object `h.txt`) and users `dev` and `team-lead`. `dev-allow.json` allows `s3:*`. Attach it.", commands: ['aws iam put-user-policy --user-name dev --policy-name allow-s3 --policy-document file://dev-allow.json'] },
    { id: 'policy', title: 'Create the boundary policy', body: "`boundary.json` allows only `s3:Get*` and `s3:List*`. A boundary is an ordinary managed policy; what makes it a boundary is how you attach it.", commands: ['aws iam create-policy --policy-name read-only-boundary --policy-document file://boundary.json'] },
    { id: 'attach', title: 'Attach it as dev\'s boundary', body: `Not \`attach-user-policy\`: that would grant. This sets the cap (\`${B}\`).`, commands: [`aws iam put-user-permissions-boundary --user-name dev --permissions-boundary ${B}`] },
    { id: 'sim', title: 'Simulate: the boundary caps dev', body: "GetObject is allowed (identity and boundary both allow). PutObject is `implicitDeny`, and the last column, `AllowedByPermissionsBoundary`, is `False`: the identity policy allowed it, the boundary did not. The second command prints the raw JSON, which the app renders as a decision table with the boundary note.", commands: [simDev, simDev.replace(/ --query "[^"]*" --output text/, '')] },
    { id: 'key', title: 'Mint access keys for dev', body: 'You will use them for the real call next.', commands: ["aws iam create-access-key --user-name dev --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text"] },
    { id: 'real', title: 'The real call, side by side with the simulation', body: "Simulation said PutObject is denied. Run it for real as dev. On this emulator it **succeeds**, which is the honest gap: AWS would answer AccessDenied (\"no permissions boundary allows the s3:PutObject action\").", commands: [`${AS} aws s3api put-object --bucket iam-lab --key from-dev.txt`], breakIt: true },
    { id: 'delegate', title: 'Safe delegation: only with the boundary attached', body: "`delegation.json` lets `team-lead` call `iam:CreateUser` only when `iam:PermissionsBoundary` equals the boundary ARN. Attach it, then simulate with the key present (allowed) and absent (implicitDeny). The real-call enforcement happens in the IAM service on AWS, so we show it with the simulator.", commands: ['aws iam put-user-policy --user-name team-lead --policy-name create-users-with-boundary --policy-document file://delegation.json', simLead(true), simLead(false)] },
  ],
  breakIt: {
    title: 'Run the call the boundary should stop',
    command: `${AS} aws s3api put-object --bucket iam-lab --key from-dev.txt`,
    explain: [
      "On AWS this call fails: the identity policy allows `s3:PutObject`, but a request is allowed only when the identity policy and the boundary both allow it, and the boundary has no PutObject. Here it succeeds because this emulator's request path does not evaluate boundaries. That is why this module is **Simulated**, and why you should treat `simulate-principal-policy` as the authoritative answer in this lab.",
      "The practical lesson: when someone says \"the role has AdministratorAccess but cannot do X\", look for a boundary, an SCP or a session policy, then run the simulation with `--permissions-boundary-policy-input-list` if you want to test a candidate boundary before attaching it.",
    ],
  },
  realAws: {
    cost: ['IAM is free.'],
    differences: [
      'Real AWS enforces the boundary on every request by the user or role. The emulator enforces it only inside `simulate-principal-policy`.',
      'Boundaries can be attached to users and roles, not groups. A boundary does not limit a resource policy that names the principal directly, in the same account.',
      'On real AWS you would pair the delegation policy with a Deny on `iam:DeleteUserPermissionsBoundary`/`iam:DeleteRolePermissionsBoundary` and on editing the boundary policy itself.',
    ],
    asOf: '2026-11-13',
    sources: [
      { label: 'Permissions boundaries for IAM entities', url: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html' },
      { label: 'Delegate permissions management with boundaries', url: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html#access_policies_boundaries-delegate' },
    ],
  },
  fidelity: [{ service: 'IAM', pass: 502, total: 692 }, { service: 'S3', pass: 1025, total: 1226 }],
  files: ['dev-allow.json', 'boundary.json', 'delegation.json'],
  checks: [
    { id: 'boundary', label: 'The read-only boundary exists and is attached to `dev`', hint: 'Run steps 2 and 3.' },
    { id: 'sim', label: 'IAM simulates: GetObject allowed, PutObject denied by the boundary', hint: 'dev needs allow-s3 (step 1) and the boundary (step 3), then run step 4.' },
    { id: 'seen', label: 'You read the simulation output with AllowedByPermissionsBoundary', hint: 'Run the simulate command in step 4.' },
    { id: 'real', label: 'You ran the real PutObject as dev and compared it with the simulation', hint: 'Run step 6 with dev\'s keys in front.' },
    { id: 'delegation', label: 'IAM says team-lead may CreateUser only with the boundary in the request', hint: 'Attach delegation.json to team-lead and run both simulations (step 7).' },
  ],
}
