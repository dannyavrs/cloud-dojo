import type { QuizQuestion } from './types'

export const IAM_EXAM: QuizQuestion[] = [
  {
    id: 'e1', tag: 'SAA:Secure',
    prompt: "A developer's IAM user has an inline policy that allows `s3:*` on all resources. A group the user belongs to has a managed policy with an explicit `Deny` for `s3:DeleteObject` on `arn:aws:s3:::prod-data/*`. The developer calls DeleteObject on `prod-data/report.csv`. What happens?",
    options: ['The delete succeeds because the user inline policy is more specific than the group policy', 'The delete succeeds because Allow statements are evaluated before Deny statements', 'The delete is denied because an explicit Deny in any applicable policy overrides every Allow', 'The delete is denied only if the Deny is in the same policy document as the Allow'],
    answer: 2,
    explain: 'An explicit Deny in any applicable policy ends the evaluation with a deny, regardless of policy type, order, or specificity. Only removing or narrowing the Deny fixes it.',
  },
  {
    id: 'e2', tag: 'DVA:Sec',
    prompt: "A policy lets a user call `s3:ListBucket` on `arn:aws:s3:::reports` with the condition `StringLike: { \"s3:prefix\": [\"home/${aws:username}/*\"] }`. The user runs `aws s3api list-objects-v2 --bucket reports` without `--prefix`. What is the result?",
    options: ['The user receives every key under the bucket', 'The user receives only keys under their own folder, because S3 applies the condition as a filter', 'AccessDenied, because the request has no s3:prefix value so the condition is false and nothing else allows the call', 'The CLI fails with a ValidationException before sending the request'],
    answer: 2,
    explain: 'A positive operator on a missing request key evaluates to false, so the Allow does not apply and the implicit deny wins. The client has to send a prefix, or the policy needs a separate statement for the unprefixed call.',
  },
  {
    id: 'e3', tag: 'SAA:Secure',
    prompt: "A Lambda function in account A must read from a bucket owned by account B. The bucket policy in account B allows the function's execution role ARN to `s3:GetObject`. The role in account A has no S3 permissions. The call fails. What is the minimum fix?",
    options: ['Add an Allow for `s3:GetObject` on the bucket to the execution role in account A as well', 'Add the account A root user to the bucket policy', 'Create an IAM user in account B and put its keys in the function', 'Enable S3 Transfer Acceleration'],
    answer: 0,
    explain: 'Cross-account access needs an Allow on both sides: the resource policy in the owning account and an identity policy in the caller account. In the same account either side alone would be enough.',
  },
  {
    id: 'e4', tag: 'DVA:Sec',
    prompt: "A workload calls `sts:AssumeRole` for a role and passes a session policy that allows only `s3:GetObject`. The role's permissions policy allows `s3:*` and `dynamodb:*`. Which actions can the session perform?",
    options: ['s3:* and dynamodb:*, because session policies are only advisory', 'Only s3:GetObject, the intersection of the role policy and the session policy', 's3:GetObject plus anything the caller user is allowed to do', 'Nothing, because a session policy must be attached to the role first'],
    answer: 1,
    explain: 'Effective permissions of a role session are the intersection of the role identity policies and the session policy (and any boundary). A session policy can only narrow and never grants beyond the role.',
  },
  {
    id: 'e5', tag: 'SAA:Secure',
    prompt: "A company wants developers to create their own IAM roles for Lambda functions, but no developer may create a role with more access than a defined read/write-to-team-buckets maximum. Which solution meets this with the least central involvement?",
    options: ['Give developers iam:* and rely on CloudTrail alerts', 'Allow `iam:CreateRole` and `iam:AttachRolePolicy` only when the condition `iam:PermissionsBoundary` equals the approved boundary policy ARN', 'Put every developer in the PowerUserAccess group', 'Attach an SCP that allows only s3:* in the account'],
    answer: 1,
    explain: 'Delegation with a required permissions boundary caps every role the developer creates, and a Deny on removing the boundary keeps it in place. PowerUserAccess cannot manage IAM, and the SCP would cap the whole account, not the delegated roles.',
  },
  {
    id: 'e6', tag: 'DVA:Sec',
    prompt: "An S3 bucket policy grants `Principal: { \"AWS\": \"arn:aws:iam::111122223333:user/sam\" }` the `s3:GetObject` action. Sam belongs to the same account as the bucket and has no IAM policies attached. Block Public Access is enabled. Can Sam read the objects?",
    options: ['No, every IAM principal needs an identity-based policy', 'No, Block Public Access blocks bucket policies that name specific principals', 'Yes, in the same account an Allow in the resource policy is sufficient when there is no explicit Deny', 'Yes, but only through the S3 console'],
    answer: 2,
    explain: 'Within one account, either an identity policy or a resource policy that names the principal suffices. Block Public Access only affects public grants (Principal "*" and similar), not a named IAM user.',
  },
  {
    id: 'e7', tag: 'SAA:Secure',
    prompt: "A company has 60 teams. Each team's engineers should be able to start and stop only EC2 instances tagged with their own team name, and a new team must be onboarded without editing any IAM policy. Which design fits?",
    options: ['One IAM policy per team listing the instance ARNs', 'One policy with `Condition: StringEquals { aws:ResourceTag/team: ${aws:PrincipalTag/team} }`, with users or sessions tagged by team and tag-editing permissions restricted', 'A permissions boundary per engineer with the instance ARNs inline', 'A single role with a long list of `ec2:*` actions and no conditions'],
    answer: 1,
    explain: 'That is attribute-based access control: one policy, driven by matching principal and resource tags. It only holds if people cannot retag themselves or arbitrary resources, so the tag-write actions need guard rails too.',
  },
  {
    id: 'e8', tag: 'SAA:Secure',
    prompt: "An AWS Organizations SCP attached to the production OU denies `ec2:*` outside `eu-west-1`. A role in a production account has the `AdministratorAccess` managed policy. The role calls `ec2:RunInstances` in `us-east-1`. What happens?",
    options: ['It succeeds, because AdministratorAccess allows everything and the SCP only filters other policies', 'It is denied: SCPs apply to every principal in member accounts, and an explicit deny in the SCP overrides the identity Allow', 'It succeeds only if the role has a permissions boundary', 'It is denied only for the root user'],
    answer: 1,
    explain: 'SCPs set the maximum available permissions for all principals in the member accounts (including the account root user), and a Deny in an SCP cannot be overridden by identity policies. They never grant anything themselves.',
  },
]
