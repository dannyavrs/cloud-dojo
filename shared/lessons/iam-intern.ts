import type { LessonContent } from '../types'

export const iamIntern: LessonContent = {
  id: 'iam-intern',
  n: '1.1',
  trackId: 'iam',
  level: 'core',
  prereqs: [],
  estMinutes: 20,
  honesty: 'live',
  examTags: ["SAA:Secure", "DVA:Sec"],
  predict: [{"id": "p1", "prompt": "The intern user has one policy: Allow `s3:GetObject`. Will `s3api delete-object` run as the intern be allowed?", "options": ["Yes, deletes are implied by reads", "No, anything not allowed is denied by default", "Yes, but only for objects the intern uploaded", "Only if the bucket is versioned"], "answer": 1, "explain": "IAM starts from an implicit deny. Only actions an Allow statement names are permitted, so `s3:DeleteObject` is refused."}],
  breakItCheck: 'denied',

  title: 'IAM: a read-only intern',
  tagline: 'Give someone exactly the access they need, then watch AWS refuse everything else.',
  concept: [
    'IAM answers "who may do what to which resource". A **user** has credentials; a **policy** is a JSON document of `Effect`/`Action`/`Resource` statements. A new user can do nothing: AWS denies by default, and only an explicit `Allow` opens a door. That is **least privilege**.',
    'Here the bucket `snap-photos` already holds `hello.txt`. You will create an `intern` user who can read objects and nothing else, then prove it from the intern\'s own keys.',
    'Honest caveat: on AWS Emulator 1.0.341 identity policies are enforced for users and roles you create, and so are S3 bucket policies, Lambda resource policies, SQS queue policies and KMS key policies (we tested each). DynamoDB resource policies are the exception: they are accepted but not enforced. The emulator\'s own root key is never denied. It is for learning, not a security test.',
  ],
  goal: 'An `intern` user whose only permission is `s3:GetObject` on `snap-photos`, and a real AccessDenied when they try to delete.',
  steps: [
    { id: 'user', title: 'Create the user', body: 'No permissions yet.', commands: ['aws iam create-user --user-name intern'] },
    { id: 'policy', title: 'Attach a read-only inline policy', body: 'The policy file `intern-read-only.json` is in your working folder (open it in Files). It allows only `s3:GetObject` on objects in `snap-photos`.', commands: ['aws iam put-user-policy --user-name intern --policy-name read-only-photos --policy-document file://intern-read-only.json'] },
    { id: 'key', title: 'Mint access keys for the intern', body: 'Copy the two values: the first is the key id, the second the secret. The secret is shown only now.', commands: ["aws iam create-access-key --user-name intern --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text"] },
    { id: 'read', title: 'Read as the intern', body: 'Paste the intern\'s keys in front of the command. This is exactly how you would act as another identity on real AWS.', commands: ['AWS_ACCESS_KEY_ID=<KEY_ID> AWS_SECRET_ACCESS_KEY=<SECRET> aws s3api get-object --bucket snap-photos --key hello.txt hello-copy.txt'] },
    { id: 'break', title: 'Break it: the intern tries to delete', body: 'Same keys, a different action.', commands: ['AWS_ACCESS_KEY_ID=<KEY_ID> AWS_SECRET_ACCESS_KEY=<SECRET> aws s3api delete-object --bucket snap-photos --key hello.txt'], breakIt: true },
    { id: 'sim', title: 'Ask IAM what it would decide', body: '`simulate-principal-policy` evaluates policies without making the call.', commands: ['aws iam simulate-principal-policy --policy-source-arn arn:aws:iam::000000000000:user/intern --action-names s3:GetObject s3:DeleteObject --resource-arns arn:aws:s3:::snap-photos/hello.txt --query "EvaluationResults[].[EvalActionName,EvalDecision]" --output text'] },
  ],
  breakIt: {
    title: 'Delete an object as the intern',
    command: 'AWS_ACCESS_KEY_ID=<KEY_ID> AWS_SECRET_ACCESS_KEY=<SECRET> aws s3api delete-object --bucket snap-photos --key hello.txt',
    explain: [
      '`AccessDenied` here is authorization, not authentication: your keys are valid (lesson 0 showed what invalid ones look like), but no identity policy allows `s3:DeleteObject`, so the default deny wins.',
      'The message names the exact action. On real AWS, that exact string is the fastest way to find the missing statement.',
    ],
  },
  realAws: {
    cost: ['IAM is free on real AWS.'],
    differences: [
      'Real AWS also evaluates resource policies, permission boundaries, SCPs and session policies together. The emulator enforces identity policies, S3 bucket policies, Lambda resource policies, SQS queue policies and KMS key policies, but not DynamoDB resource policies, permission boundaries or session policies on real calls.',
      'Prefer roles with short-lived credentials over long-lived user access keys on real AWS. Users and keys are used here because they are the clearest way to show "acting as someone else".',
      'On real AWS, new IAM changes can take a few seconds to propagate.',
    ],
    asOf: '2026-11-13',
    sources: [{ label: 'AWS Emulator: security model', url: 'https://docs.aws.amazon.com/emulator/latest/userguide/security.html' }, { label: 'IAM', url: 'https://aws.amazon.com/iam/' }],
  },
  fidelity: [{ service: 'IAM', pass: 502, total: 692 }, { service: 'S3', pass: 1025, total: 1226 }],
  files: ['intern-read-only.json'],
  checks: [
    { id: 'user', label: 'User `intern` exists', hint: 'Run step 1.' },
    { id: 'policy', label: 'Intern may GetObject and nothing wider (no wildcard actions)', hint: 'Attach the policy from step 2 with put-user-policy.' },
    { id: 'sim', label: 'IAM says: GetObject allowed, DeleteObject denied', hint: 'The policy must allow only s3:GetObject.' },
    { id: 'key', label: 'The intern has an access key', hint: 'Run step 3.' },
    { id: 'denied', label: 'You watched the intern get AccessDenied on delete', hint: 'Run the break-it command with the intern\'s keys in front.' },
  ],
}
