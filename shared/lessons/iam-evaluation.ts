import type { LessonContent } from '../types'

const AS = 'AWS_ACCESS_KEY_ID=<KEY_ID> AWS_SECRET_ACCESS_KEY=<SECRET>'
const SIM = 'aws iam simulate-principal-policy --policy-source-arn arn:aws:iam::000000000000:user/dev --action-names s3:GetObject s3:DeleteObject sqs:SendMessage --resource-arns arn:aws:s3:::iam-lab/h.txt --query "EvaluationResults[].[EvalActionName,EvalDecision,MatchedStatements[0].SourcePolicyId]" --output text'

export const iamEvaluation: LessonContent = {
  id: 'iam-evaluation',
  n: '1.2',
  trackId: 'iam',
  level: 'intermediate',
  prereqs: ['iam-intern'],
  estMinutes: 25,
  honesty: 'live',
  examTags: ['SAA:Secure', 'DVA:Sec'],
  breakItCheck: 'denied',
  title: 'Policy evaluation logic: explicit deny always wins',
  tagline: 'Allow everything on S3, deny one action in a second policy, and read the verdict from IAM itself.',
  predict: [
    { id: 'p1', prompt: "`dev` has one inline policy that allows `s3:*` on `*`, and a second inline policy that denies `s3:DeleteObject` on `*`. Can `dev` delete an object?", options: ['Yes, the broader Allow wins over a narrower Deny', 'Yes, the policy attached first wins', 'No, an explicit Deny in any applicable policy overrides every Allow', 'Only if the Deny sits in the same policy document as the Allow'], answer: 2, explain: 'Evaluation collects every applicable policy. Any matching explicit Deny ends the evaluation with a deny. Policy order, count, and whether the statements live in one document or two are irrelevant.' },
    { id: 'p2', prompt: "`simulate-principal-policy` for `dev` asks about `sqs:SendMessage`. No statement in any of dev's policies mentions SQS. What is the decision?", options: ['allowed', 'explicitDeny', 'implicitDeny', 'An error: unknown action'], answer: 2, explain: '`implicitDeny` means nothing allowed it (the default). `explicitDeny` means a Deny statement matched. The difference matters: you can fix an implicit deny by adding an Allow, but an explicit deny has to be removed or narrowed.' },
  ],
  concept: [
    "Every request to AWS is authorized by one evaluation. (1) **Explicit deny**: if any applicable policy (identity, resource, boundary, SCP, session) has a matching `Deny`, the request is denied and nothing overrides it. (2) If the account is in an Organization, the **SCPs** must allow the action. (3) A **resource-based policy** that allows the principal can grant access in the same account even when no identity policy does. (4) Otherwise an **identity-based policy** must allow it. (5) A **permissions boundary** and (6) a **session policy**, if present, must also allow it: they only cap, they never grant. (7) Anything left is the **implicit deny**. The exam question is always some variation of \"which single statement decides?\": the explicit deny if there is one, otherwise whether the intersection of the guard-rails still contains an Allow.",
    "Three things trip people up. First, **a Deny is not scoped to the policy it lives in**: a managed policy attached to a group can deny an action that a user inline policy allows, and the user is denied. Second, **Allow statements do not combine into a broader Allow than any one guard-rail permits**: a boundary or SCP missing the action blocks it even if five identity policies allow it. Third, **`NotAction`, `NotResource` and `NotPrincipal` invert the match**. `Effect: Allow` with `NotAction: iam:*` allows *everything except IAM*, which is almost never what the author meant, while `Deny` with `NotAction` is the standard way to say \"only these actions are allowed, in this region or with MFA\".",
    "Debugging uses two tools. The AccessDenied message names the **principal, action and resource**, and since 2023 it also says which kind of policy denied (\"no identity-based policy allows\" versus \"with an explicit deny in an identity-based policy\"). `simulate-principal-policy` evaluates the attached identity policies, the boundary and (with `--permissions-boundary-policy-input-list`) extra policies, without making the call, and returns `allowed`, `explicitDeny` or `implicitDeny` per action, with `MatchedStatements` pointing to the policy that decided. Limits to remember: an inline policy is at most 2,048 characters per user (10,240 per role), a managed policy 6,144, and a principal can have 10 managed policies attached by default (quota 20).",
    "Here the emulator really enforces what you will see: identity-policy Allow, explicit Deny, and the implicit deny, for IAM users you create (its own root key is never denied). You will attach two separate policies, act as the user with their own access keys, and then ask IAM to explain the verdict.",
  ],
  goal: "`dev` can still read objects but `s3:DeleteObject` is explicitly denied by a second policy, even though the first policy allows `s3:*`, and you have read IAM's verdict for allowed, explicitDeny and implicitDeny.",
  steps: [
    { id: 'allow', title: 'Allow everything on S3', body: "The fixture created bucket `iam-lab` (objects `h.txt` and `scratch.txt`) and an IAM user `dev` with no permissions. Policy file `allow-s3.json` (open it in Files) allows `s3:*` on `*`. Attach it as an inline policy named `allow-s3`.", commands: ['aws iam put-user-policy --user-name dev --policy-name allow-s3 --policy-document file://allow-s3.json'] },
    { id: 'key', title: 'Mint access keys for dev', body: 'Copy the key id (first value) and secret (second value). From here on, paste them in front of any command that must run as `dev`.', commands: ["aws iam create-access-key --user-name dev --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text"] },
    { id: 'before', title: 'Delete as dev: allowed for now', body: "Only the Allow exists, so deleting `scratch.txt` works. Keep this in mind: the same call is about to fail without anything in the Allow changing.", commands: [`${AS} aws s3api delete-object --bucket iam-lab --key scratch.txt`] },
    { id: 'deny', title: 'Add a second policy that denies DeleteObject', body: "`deny-delete.json` holds one `Deny` statement for `s3:DeleteObject`. It is a different policy document from the Allow. Attach it as `deny-delete`.", commands: ['aws iam put-user-policy --user-name dev --policy-name deny-delete --policy-document file://deny-delete.json'] },
    { id: 'break', title: 'Break it: delete h.txt as dev', body: "The first policy still says `s3:*`. Read the error: it says the identity-based policy has an *explicit deny*, not that nothing allows it.", commands: [`${AS} aws s3api delete-object --bucket iam-lab --key h.txt`], breakIt: true },
    { id: 'read', title: 'Everything else still works', body: 'The deny is surgical. Reading `h.txt` as dev still succeeds, proving the Allow was not removed.', commands: [`${AS} aws s3api get-object --bucket iam-lab --key h.txt h-copy.txt`] },
    { id: 'sim', title: 'Ask IAM for the verdict on three actions', body: "One call, three outcomes: `allowed` for GetObject, `explicitDeny` for DeleteObject (matched statement is in `user_dev_deny-delete`), and `implicitDeny` for SQS because nothing mentions it. The third column shows which policy decided. Run the second command, without `--query`, to see the same answer as the app's decision table (it renders raw `simulate-*` JSON).", commands: [SIM, SIM.replace(/ --query "[^"]*" --output text/, '')] },
  ],
  breakIt: {
    title: 'Delete an object that an Allow policy covers',
    command: `${AS} aws s3api delete-object --bucket iam-lab --key h.txt`,
    explain: [
      "The Allow on `s3:*` matches this request, and so does the Deny, so the Deny wins. Evaluation does not weigh specificity: a narrow Deny beats a broad Allow, and a broad Deny beats a narrow Allow.",
      "The error text says \"explicit deny in an identity-based policy\". Compare it with step 5 of lesson 1.1 (\"no identity-based policy allows\"): the fix is different. For an implicit deny you add an Allow; for an explicit deny you must find and edit the Deny.",
    ],
  },
  realAws: {
    cost: ['IAM and `simulate-principal-policy` are free.'],
    differences: [
      'Real AWS evaluates SCPs, permissions boundaries, resource policies and session policies in the same pass. The emulator applies identity policies, S3/SQS/Lambda/KMS resource policies, and explicit deny, but not boundaries or session policies on real calls (lessons 1.4 and 1.6).',
      'Real AWS changes are eventually consistent: a new Deny can take a few seconds to apply everywhere.',
      'The emulator never denies its own root key, so this lesson uses a created user. On AWS the account root user is also subject to SCPs and explicit denies in resource policies.',
    ],
    asOf: '2026-11-13',
    sources: [
      { label: 'Policy evaluation logic', url: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html' },
      { label: 'SimulatePrincipalPolicy', url: 'https://docs.aws.amazon.com/IAM/latest/APIReference/API_SimulatePrincipalPolicy.html' },
    ],
  },
  fidelity: [{ service: 'IAM', pass: 502, total: 692 }, { service: 'S3', pass: 1025, total: 1226 }],
  files: ['allow-s3.json', 'deny-delete.json'],
  checks: [
    { id: 'allow', label: '`dev` has an Allow for `s3:*`', hint: 'Attach allow-s3.json with put-user-policy (step 1).' },
    { id: 'key', label: '`dev` has an access key', hint: 'Run step 2.' },
    { id: 'before', label: 'You deleted `scratch.txt` as dev while only the Allow existed', hint: 'Run step 3 with the keys from step 2 before attaching the deny.' },
    { id: 'deny', label: 'A separate policy denies `s3:DeleteObject` (IAM says explicitDeny)', hint: 'Attach deny-delete.json as its own policy (step 4).' },
    { id: 'denied', label: 'You watched dev get AccessDenied on delete while `s3:*` is allowed', hint: 'Run the break-it command with dev\'s keys in front.' },
    { id: 'sim', label: 'You read IAM\'s verdict: allowed, explicitDeny and implicitDeny', hint: 'Run the simulate command in step 7.' },
  ],
}
