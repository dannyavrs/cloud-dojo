import type { LessonContent } from '../types'

const ANALYST = 'AWS_ACCESS_KEY_ID=<KEY_ID> AWS_SECRET_ACCESS_KEY=<SECRET>'
const AUDITOR = 'AWS_ACCESS_KEY_ID=<AUD_KEY_ID> AWS_SECRET_ACCESS_KEY=<AUD_SECRET>'
const ACCT = '000000000000'

export const DENY_POLICY = JSON.stringify({
  Version: '2012-10-17',
  Id: 'vault-policy',
  Statement: [
    { Sid: 'EnableIAMPolicies', Effect: 'Allow', Principal: { AWS: `arn:aws:iam::${ACCT}:root` }, Action: 'kms:*', Resource: '*' },
    { Sid: 'DenyAnalystEncrypt', Effect: 'Deny', Principal: { AWS: `arn:aws:iam::${ACCT}:user/analyst` }, Action: ['kms:Encrypt', 'kms:GenerateDataKey*', 'kms:ReEncrypt*'], Resource: '*' },
  ],
}, null, 2)

/** A key policy that names an admin but never delegates to IAM: IAM policies are ignored for this key. */
export const NO_IAM_POLICY = JSON.stringify({
  Version: '2012-10-17',
  Id: 'isolated-policy',
  Statement: [
    { Sid: 'AdminOnly', Effect: 'Allow', Principal: { AWS: `arn:aws:iam::${ACCT}:user/emulator` }, Action: 'kms:*', Resource: '*' },
  ],
}, null, 2)

export const kmsPoliciesGrants: LessonContent = {
  id: 'kms-policies-grants',
  n: '11.2',
  trackId: 'security',
  level: 'advanced',
  prereqs: ['kms-envelope', 'iam-resource-policies'],
  estMinutes: 45,
  honesty: 'live',
  honestyNote: 'The emulator evaluates KMS key policies (including explicit Deny and the root-delegation statement), grants, rotation settings and key states for real. Rotation only records settings and key-material versions; it does not age keys. The 7 to 30 day deletion window is stored but never elapses.',
  examTags: ['SAA:Secure', 'DVA:Sec'],
  breakItCheck: 'breakit',
  editable: ['key-policy-deny.json', 'key-policy-no-iam.json'],
  title: 'Key policies, grants, rotation and deletion: who can use a key',
  tagline: 'Deny a user in the key policy, grant a user with no IAM permissions, turn on rotation and schedule a key for deletion.',
  predict: [
    { id: 'p1', prompt: 'A user has an IAM policy allowing `kms:Encrypt` on `*`. The key policy contains only an Allow for a different administrator and no statement for the account root. Can the user encrypt with this key?', options: ['Yes, an IAM Allow is enough in the same account', 'No: a KMS key is usable only if the key policy allows it, directly or by delegating to IAM through the account root principal', 'Yes, but only for Decrypt', 'No, but only because KMS keys cannot be used from IAM users'], answer: 1, explain: 'Unlike most services, KMS needs the key policy to say yes (directly, or by trusting the account via `arn:aws:iam::<acct>:root` so that IAM policies take over). Without that delegation statement IAM policies are ignored for the key. The default key policy created by the console includes it; a hand-written one may not.' },
    { id: 'p2', prompt: 'A grant gives principal B the `Decrypt` operation on a key. B has no IAM policy at all. What happens when B calls Decrypt and Encrypt?', options: ['Both are denied: grants only add to what IAM already allows', 'Decrypt works (a grant is an allow in its own right); Encrypt is denied', 'Both work: a grant means full key access', 'Decrypt works only after B also gets an IAM policy'], answer: 1, explain: 'A grant is a programmatic, scoped, revocable allow attached to the key, the typical tool for AWS services acting for you (EBS, RDS, Lambda). It authorises exactly the listed operations. It does not need an IAM policy, and it cannot override an explicit Deny.' },
    { id: 'p3', prompt: 'You schedule a key for deletion with a 7-day window. What can you do during the window?', options: ['Keep encrypting, only decrypt is blocked', 'Nothing with the key (encrypt and decrypt fail), but you can cancel the deletion; the key then comes back Disabled', 'Nothing, the deletion cannot be undone', 'Everything, the key is only hidden from the console'], answer: 1, explain: 'A key in PendingDeletion cannot be used for any cryptographic operation. CancelKeyDeletion restores it, but into the Disabled state, so you must enable it again. The window is 7 to 30 days. After it elapses the key and everything wrapped by it is gone for good; disable the key first if you only want to test the impact.' },
  ],
  concept: [
    "Access to a KMS key is decided by the **key policy first**. Every key has exactly one, and it is the only resource policy in AWS that is **mandatory**. The default policy contains a single statement that allows the account's root principal `kms:*`; that statement does not give root powers to a person, it **enables IAM policies** for the key, so that normal identity permissions (`kms:Encrypt` on the key ARN) work. Remove it and IAM Allows are ignored: only principals named in the key policy (or holders of a grant) can use the key. That is the classic \"I have `kms:*` in IAM and still get AccessDenied\" exam scenario. An **explicit Deny** anywhere (key policy, IAM, SCP) always wins, and you can scope policies with conditions such as `kms:EncryptionContext:<key>`, `kms:ViaService` (only usable through S3, for example) and `kms:CallerAccount`.",
    "**Grants** are the second mechanism. A grant is created with `CreateGrant` (needs `kms:CreateGrant`), names a grantee principal and a list of operations (`Decrypt`, `GenerateDataKey`, ...) and optional constraints on the encryption context. It is attached to the key, takes effect within seconds (eventual consistency; the returned grant token gives immediate use), and can be **retired** by the grantee or **revoked** by an administrator. Grants are how AWS services use your key on your behalf: when you attach an encrypted EBS volume, EBS gets a grant. Prefer a grant over editing the key policy for temporary or programmatic access, and review `list-grants` during audits. Neither a grant nor an IAM Allow can beat a Deny.",
    "**Rotation** and **deletion** are lifecycle controls. Enabling automatic rotation for a symmetric customer managed key creates new key material on a schedule (default every 365 days; you can choose 90 to 2,560 days) while the **key id, ARN, alias and policy stay the same**. KMS keeps every older version of the material, so old ciphertexts still decrypt and no re-encryption is needed; new encryptions use the newest material. AWS managed keys rotate yearly automatically. Automatic rotation does not cover imported key material, asymmetric keys or custom key stores, and on-demand rotation exists for testing. **Deleting** a key is destructive: `ScheduleKeyDeletion` needs a window of 7 to 30 days, the key moves to PendingDeletion and refuses every cryptographic call, and after the window everything encrypted under it is permanently unreadable. A cheaper reversible switch is `DisableKey`.",
    "In this module the fixture creates `alias/vault`, a user `analyst` with an IAM Allow on the key, and a user `auditor` with no permissions. You prove each rule by running commands as those users with their own access keys. The commands that print access keys expose secrets on a real account; here they are lab credentials on an emulator, and the checker never returns key material to the page.",
  ],
  goal: 'A key where the analyst is denied Encrypt by the key policy but still decrypts, an auditor who decrypts through a grant (and loses it on revoke), rotation on, and a scratch key in PendingDeletion that cannot encrypt.',
  steps: [
    { id: 'look', title: 'Read the default key policy', body: "The fixture created `alias/vault`, the users `analyst` (IAM Allow for encrypt, decrypt and data keys, no other permissions) and `auditor` (nothing). Read the key policy: one statement, the account root. That is the delegation to IAM.", commands: ['aws kms get-key-policy --key-id alias/vault --policy-name default --query Policy --output text'] },
    { id: 'keys', title: 'Create access keys for both users', body: "Each command prints `<access key id> <secret>`. Keep them: the analyst pair is `<KEY_ID>`/`<SECRET>`, the auditor pair `<AUD_KEY_ID>`/`<AUD_SECRET>`.", commands: ["aws iam create-access-key --user-name analyst --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text", "aws iam create-access-key --user-name auditor --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text"] },
    { id: 'baseline', title: 'Baseline: the analyst can encrypt', body: "First encrypt something as yourself (admin) and keep the ciphertext as `<CIPHERTEXT>`; you will decrypt it later as other users. Then encrypt as the analyst: IAM Allow plus the default key policy lets it through.", commands: ['aws kms encrypt --key-id alias/vault --plaintext c2VjcmV0 --query CiphertextBlob --output text', `${ANALYST} aws kms encrypt --key-id alias/vault --plaintext c2VjcmV0 --query KeyId --output text`] },
    { id: 'nodeleg', title: 'A key policy without the root statement', body: "`key-policy-no-iam.json` names an administrator but never trusts the account root. Create a second key with it, then try to encrypt as the analyst, who still holds the IAM Allow. The key policy has no say for them, so the call is refused.", commands: ['aws kms create-key --description "no delegation" --policy file://key-policy-no-iam.json --query KeyMetadata.KeyId --output text', `${ANALYST} aws kms encrypt --key-id <ISOLATED_KEY_ID> --plaintext c2VjcmV0`] },
    { id: 'deny', title: 'Add a key-policy Deny for the analyst', body: "`key-policy-deny.json` keeps the root statement and adds an explicit Deny on Encrypt, GenerateDataKey and ReEncrypt for the analyst. Replace the key policy. Never remove the root statement from a policy you are rewriting: that can lock everyone out.", commands: ['aws kms put-key-policy --key-id alias/vault --policy-name default --policy file://key-policy-deny.json'] },
    { id: 'break', title: 'Break it: encrypt as the denied analyst', body: "The IAM Allow is still there; the explicit Deny in the key policy beats it. Then show the Deny is narrow: decrypting the admin's ciphertext as the analyst still works.", commands: [`${ANALYST} aws kms encrypt --key-id alias/vault --plaintext c2VjcmV0`, `${ANALYST} aws kms decrypt --ciphertext-blob <CIPHERTEXT> --query KeyId --output text`], breakIt: true },
    { id: 'grant', title: 'Give the auditor Decrypt with a grant', body: "The auditor has no IAM policy, so decrypt fails. Create a grant for Decrypt only; it prints a `<GRANT_ID>`. Now decrypt works, encrypt still does not. Revoke the grant and decrypt fails again.", commands: [`${AUDITOR} aws kms decrypt --ciphertext-blob <CIPHERTEXT> --query KeyId --output text`, 'aws kms create-grant --key-id alias/vault --grantee-principal arn:aws:iam::000000000000:user/auditor --operations Decrypt --name auditor-read --query GrantId --output text', `${AUDITOR} aws kms decrypt --ciphertext-blob <CIPHERTEXT> --query KeyId --output text`, `${AUDITOR} aws kms encrypt --key-id alias/vault --plaintext c2VjcmV0`, 'aws kms list-grants --key-id alias/vault --query \'Grants[].[Name,GranteePrincipal]\' --output text', 'aws kms revoke-grant --key-id alias/vault --grant-id <GRANT_ID>', `${AUDITOR} aws kms decrypt --ciphertext-blob <CIPHERTEXT> --query KeyId --output text`] },
    { id: 'rotate', title: 'Turn on automatic rotation', body: 'Rotate every 180 days. The key id, ARN and alias do not change, and old ciphertexts keep decrypting.', commands: ['aws kms enable-key-rotation --key-id alias/vault --rotation-period-in-days 180', 'aws kms get-key-rotation-status --key-id alias/vault'] },
    { id: 'delete', title: 'Schedule a scratch key for deletion', body: "Create a throwaway key (note its id as `<SCRATCH_KEY_ID>`), schedule it for deletion with the minimum 7-day window, and try to use it. It is in PendingDeletion and refuses to encrypt. To undo you would run `cancel-key-deletion` and then `enable-key`.", commands: ['aws kms create-key --description scratch --query KeyMetadata.KeyId --output text', 'aws kms schedule-key-deletion --key-id <SCRATCH_KEY_ID> --pending-window-in-days 7', 'aws kms encrypt --key-id <SCRATCH_KEY_ID> --plaintext c2VjcmV0', "aws kms describe-key --key-id <SCRATCH_KEY_ID> --query 'KeyMetadata.[KeyState,DeletionDate]' --output text"] },
  ],
  breakIt: {
    title: 'Encrypting as a user the key policy denies',
    command: `${ANALYST} aws kms encrypt --key-id alias/vault --plaintext c2VjcmV0`,
    explain: [
      "`AccessDeniedException: User ... is not authorized to perform: kms:Encrypt on resource ...`. The analyst's IAM policy still allows the action; the explicit Deny in the key policy wins. Explicit Deny always beats Allow, in every policy type.",
      "The same user can still decrypt, because the Deny lists only Encrypt, GenerateDataKey* and ReEncrypt*. That is the usual way to make a key write-protected but readable. Always check the whole action set you intend to block.",
    ],
  },
  realAws: {
    cost: [
      "Each customer managed key is about 1 USD per month, and rotated key versions are billed on top of that (check the pricing page for the current schedule). Requests are about 0.03 USD per 10,000 after a monthly free tier. List prices as of 2026-11-15, check before relying on them.",
      "A key scheduled for deletion is not charged while it is PendingDeletion. Grants, aliases and policy edits are free.",
    ],
    differences: [
      "KMS API calls are eventually consistent on real AWS: a new grant, key policy or alias can take a few seconds to apply everywhere (grant tokens exist for that). The emulator applies them almost immediately.",
      "Real rotation creates real new key material on schedule and CloudTrail records `RotateKey`; the emulator records settings and on-demand rotations only. The deletion window never elapses here, so you cannot observe the key actually disappearing.",
      "The principal `arn:aws:iam::<account>:root` in a key policy means 'the account, delegating to IAM'. Cross-account use also needs an IAM Allow on the caller's side. This lab has a single account.",
      "Real AWS rejects a key policy that would make the key unmanageable (the lockout safety check). Test any rewrite on a scratch key first.",
    ],
    asOf: '2026-11-15',
    sources: [
      { label: 'Key policies in AWS KMS', url: 'https://docs.aws.amazon.com/kms/latest/developerguide/key-policies.html' },
      { label: 'Grants in AWS KMS', url: 'https://docs.aws.amazon.com/kms/latest/developerguide/grants.html' },
      { label: 'Rotate AWS KMS keys', url: 'https://docs.aws.amazon.com/kms/latest/developerguide/rotate-keys.html' },
      { label: 'Deleting AWS KMS keys', url: 'https://docs.aws.amazon.com/kms/latest/developerguide/deleting-keys.html' },
    ],
  },
  fidelity: [{ service: 'KMS', pass: 291, total: 310 }, { service: 'IAM', pass: 502, total: 692 }],
  files: ['key-policy-deny.json', 'key-policy-no-iam.json'],
  checks: [
    { id: 'baseline', label: 'The analyst encrypted with `alias/vault` before any Deny', hint: 'Create the analyst access keys (step 2) and run the baseline encrypt as the analyst.' },
    { id: 'nodeleg', label: 'A key without the root statement refused the analyst despite an IAM Allow', hint: 'Create the isolated key (step 4) and encrypt with it as the analyst.' },
    { id: 'policy', label: 'The key policy of `alias/vault` has a Deny for the analyst and keeps the root statement', hint: 'Run put-key-policy with key-policy-deny.json.' },
    { id: 'breakit', label: 'You saw the analyst refused on Encrypt by the key policy', hint: 'Run the break-it command as the analyst after the policy is in place.' },
    { id: 'granular', label: 'The analyst could still Decrypt after the Deny', hint: 'Run the second break-it command (decrypt as the analyst).' },
    { id: 'grant', label: 'The auditor was denied, then decrypted through a grant but could not encrypt', hint: 'Follow step 7 in order: decrypt, create-grant, decrypt, encrypt as the auditor.' },
    { id: 'revoked', label: 'After revoking the grant the auditor was denied again', hint: 'Run revoke-grant with the grant id, then decrypt as the auditor once more.' },
    { id: 'rotation', label: 'Automatic rotation is enabled on `alias/vault`', hint: 'Run enable-key-rotation.' },
    { id: 'deletion', label: 'A scratch key is PendingDeletion and refused to encrypt', hint: 'Create a scratch key, schedule its deletion, then try to encrypt with it.' },
  ],
}
