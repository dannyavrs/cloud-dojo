import type { LessonContent } from '../types'

const ACC = 'arn:aws:dynamodb:us-east-1:000000000000:table'
const sim = (table: string, team: string) => `aws iam simulate-principal-policy --policy-source-arn arn:aws:iam::000000000000:user/dev --action-names dynamodb:GetItem --resource-arns ${ACC}/${table} --context-entries ContextKeyName=aws:PrincipalTag/team,ContextKeyValues=a,ContextKeyType=string ContextKeyName=aws:ResourceTag/team,ContextKeyValues=${team},ContextKeyType=string --query "EvaluationResults[].[EvalActionName,EvalDecision]" --output text`

export const iamAbac: LessonContent = {
  id: 'iam-abac',
  n: '1.7',
  trackId: 'iam',
  level: 'advanced',
  prereqs: ['iam-evaluation', 'iam-conditions'],
  estMinutes: 25,
  honesty: 'concept',
  requires: ['abac-principal-tag', 'iam-policy-variable'],
  honestyNote: 'The emulator does not match `aws:PrincipalTag`, `aws:ResourceTag` or `${aws:username}`-style variables on real calls (they are denied even when they should match). You write the policy, we check its JSON, and you can see the verdict through `simulate-principal-policy` with context values. No real call proves it here.',
  examTags: ['SAA:Secure', 'DVA:Sec'],
  editable: ['abac-policy.json'],
  title: 'ABAC: tags and policy variables',
  tagline: 'One policy for every team: match the tag on the person to the tag on the resource.',
  predict: [
    { id: 'p1', prompt: "A policy allows `dynamodb:GetItem` on `*` with `StringEquals: { aws:ResourceTag/team: \"${aws:PrincipalTag/team}\" }`. A user tagged `team=a` reads a table tagged `team=b`. Result?", options: ['Allowed: the user has the action', 'Denied: the tag values differ so the condition is false (implicit deny)', 'Allowed: tags are advisory', 'An error: tags are not valid in conditions'], answer: 1, explain: "The condition compares the resource's tag with the *principal's* tag. `a` is not `b`, so the Allow does not apply. New teams or tables need no policy change, just correct tags." },
    { id: 'p2', prompt: "Why must an ABAC design also restrict who may call `iam:TagUser`, `iam:TagRole` and `iam:UntagUser`?", options: ['Tagging costs money', 'Anyone who can edit their own `team` tag can give themselves another team\'s access', 'Tags are immutable', 'Untagging deletes the user'], answer: 1, explain: "The tag *is* the permission. If a user can retag themselves (or a resource), the whole model collapses, so tag-write permissions are guarded just like policy-write permissions." },
    { id: 'p3', prompt: "Which of these is a policy variable?", options: ['`aws:PrincipalTag/team`', '`${aws:PrincipalTag/team}`', '`StringEquals`', '`aws:ResourceTag`'], answer: 1, explain: "A policy variable is `${key}` placed inside a value (a Resource ARN or a condition value), resolved from the request context at evaluation time. The bare key name is used on the left of a condition, the `${...}` form on the right." },
  ],
  concept: [
    "**Role-based** access control (RBAC) in IAM means one policy per job function, and every new project means a new policy. **Attribute-based** access control (ABAC) uses **tags** instead: you tag principals (users and roles: `team=a`, `project=apollo`) and resources (`team=a`), and write one policy that says \"a principal may act on a resource when their tags match\". Adding a team becomes a tagging task, not a policy edit, and you stay far below the policy-size limits (6,144 characters per managed policy, 10 attached policies by default). The condition keys: `aws:PrincipalTag/KEY` (tag on the caller, or on the role session via `sts:TagSession`), `aws:ResourceTag/KEY` (tag on the target resource, supported per service), `aws:RequestTag/KEY` (tag in a create or tag call) and `aws:TagKeys` (the set of tag keys in the request).",
    "**Policy variables** do the matching: `${aws:PrincipalTag/team}` is replaced by the caller's tag value at evaluation time, `${aws:username}` and `${aws:userid}` by the user's name/id, `${aws:PrincipalAccount}`, `${aws:SourceIp}` and so on. The classic variable use is a Resource ARN such as `arn:aws:s3:::company-data/home/${aws:username}/*`, so one policy gives each user their own prefix. Gotchas: variables only work in `Resource` and in condition **values** (not in `Action`), the policy `Version` must be `2012-10-17` or later or `${...}` is treated as literal text, and a variable whose key is missing from the request context makes the condition false. Put a literal `$` as `${$}`.",
    "ABAC has three standard failure modes the exams use. (1) **Tag tampering**: if principals can change their own tags, or can tag any resource, add `Deny` on `iam:TagUser`/`iam:UntagUser`/`iam:TagRole`/`iam:UntagRole` (or allow it only with `aws:PrincipalTag` guard conditions), and on `*:TagResource` with `aws:RequestTag`. (2) **Untagged resources**: a resource without the tag has no `aws:ResourceTag/team`, so the StringEquals is false and nobody can use it, which is safe but surprising. (3) **Action coverage**: not every service supports `aws:ResourceTag` for every action, so check the service authorisation reference. ABAC also composes with SCPs and boundaries: they are all intersected.",
    "Honest scope here: the emulator does not match tag conditions or variables on real calls (in our probes a correctly tagged user was still denied), so there is no hands-on enforcement. You will tag the user and tables with real calls (the tags are stored), write the policy in `abac-policy.json`, and the checker validates the **JSON**: an explicit action list with no wildcards, `aws:ResourceTag/team` compared with `${aws:PrincipalTag/team}`, and a guard that stops the user retagging themselves. `simulate-principal-policy` with context values lets you see the verdict.",
  ],
  goal: "`abac-policy.json` lists explicit DynamoDB actions, matches `aws:ResourceTag/team` to `${aws:PrincipalTag/team}`, and denies self-tagging. `dev` and the tables are tagged, and IAM simulates `a` against `a` as allowed and `a` against `b` as denied.",
  steps: [
    { id: 'tag-user', title: 'Tag the user', body: "The fixture created user `dev` and two tables, `team-a-data` and `team-b-data`, with no tags. Tag `dev` with `team=a`. This is a real, stored tag.", commands: ['aws iam tag-user --user-name dev --tags Key=team,Value=a'] },
    { id: 'tag-tables', title: 'Tag the tables', body: 'Resource tags: team-a-data is `a`, team-b-data is `b`.', commands: ['aws dynamodb tag-resource --resource-arn arn:aws:dynamodb:us-east-1:000000000000:table/team-a-data --tags Key=team,Value=a', 'aws dynamodb tag-resource --resource-arn arn:aws:dynamodb:us-east-1:000000000000:table/team-b-data --tags Key=team,Value=b'] },
    { id: 'edit', title: 'Write the ABAC policy', body: "Open `abac-policy.json` in the editor. The starter allows `dynamodb:*` on everything: the opposite of what you want. Replace it with two statements: (1) Allow `dynamodb:GetItem`, `dynamodb:PutItem`, `dynamodb:Query` on `*` with `StringEquals` of `aws:ResourceTag/team` to `${aws:PrincipalTag/team}`; (2) Deny `iam:TagUser` and `iam:UntagUser` so the user cannot retag themselves. Save, then run the next step.", code: { file: 'abac-policy.json', text: '{\n  "Version": "2012-10-17",\n  "Statement": [\n    {\n      "Effect": "Allow",\n      "Action": ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query"],\n      "Resource": "*",\n      "Condition": { "StringEquals": { "aws:ResourceTag/team": "${aws:PrincipalTag/team}" } }\n    },\n    {\n      "Effect": "Deny",\n      "Action": ["iam:TagUser", "iam:UntagUser"],\n      "Resource": "*"\n    }\n  ]\n}' } },
    { id: 'attach', title: 'Attach it to dev', body: 'IAM validates the JSON on the way in.', commands: ['aws iam put-user-policy --user-name dev --policy-name abac --policy-document file://abac-policy.json'] },
    { id: 'sim', title: 'Ask IAM: same team, different team', body: "`simulate-principal-policy` with context entries for the principal tag and the resource tag. `a` against `a` should be `allowed`, `a` against `b` should be `implicitDeny`. The simulator is the only authority here, not a real call.", commands: [sim('team-a-data', 'a'), sim('team-b-data', 'b')] },
  ],
  breakIt: {
    title: 'What goes wrong with a sloppy ABAC policy',
    command: '',
    explain: [
      "With `Action: dynamodb:*` the policy hands out `DeleteTable` and `UpdateTable` along with reads. Use an explicit list: with ABAC the tag condition limits *where*, not *what*.",
      "Without the tag-guard Deny, the user can run `aws iam tag-user --tags Key=team,Value=b` on themselves and instantly gain access to team B, because the tag is the permission. And a condition written with the bare key on the right (`\"aws:ResourceTag/team\": \"aws:PrincipalTag/team\"`) compares against the literal text, never matching anything.",
    ],
  },
  realAws: {
    cost: ['IAM is free. DynamoDB tables here cost nothing on-demand with no traffic.'],
    differences: [
      'Real AWS evaluates `aws:PrincipalTag`, `aws:ResourceTag`, `aws:RequestTag` and policy variables on live calls. The emulator denies even a correct match.',
      'Role sessions can carry tags (`sts:TagSession`, session tags) so federated users get a tag per login; the emulator does not model that.',
      'Not every service or action supports `aws:ResourceTag`. Check the Service Authorization Reference before designing around it.',
    ],
    asOf: '2026-11-13',
    sources: [
      { label: 'ABAC for AWS', url: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction_attribute-based-access-control.html' },
      { label: 'IAM policy elements: variables and tags', url: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_variables.html' },
      { label: 'Tutorial: ABAC with tags', url: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/tutorial_attribute-based-access-control.html' },
    ],
  },
  fidelity: [{ service: 'IAM', pass: 502, total: 692 }, { service: 'DynamoDB', pass: 1057, total: 1481 }],
  files: ['abac-policy.json'],
  checks: [
    { id: 'tags', label: '`dev` is tagged `team=a`, the tables are tagged `a` and `b`', hint: 'Run steps 1 and 2.' },
    { id: 'json', label: '`abac-policy.json` is valid policy JSON', hint: 'Fix the JSON in the editor.' },
    { id: 'actions', label: 'The Allow lists explicit actions (no `*` or `service:*`)', hint: 'Replace `dynamodb:*` with GetItem, PutItem, Query.' },
    { id: 'condition', label: 'Condition: `aws:ResourceTag/team` equals `${aws:PrincipalTag/team}`', hint: 'Use StringEquals with the variable on the right-hand side.' },
    { id: 'guard', label: 'A Deny stops dev from calling `iam:TagUser` and `iam:UntagUser`', hint: 'Add a second statement with Effect Deny for both actions.' },
    { id: 'sim', label: 'IAM simulates team a on a as allowed, and a on b as denied', hint: 'Attach the policy (step 4) and run both commands in step 5.' },
  ],
}
