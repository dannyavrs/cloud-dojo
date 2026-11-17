import type { LessonContent } from '../types'

const READER = 'AWS_ACCESS_KEY_ID=<KEY_ID> AWS_SECRET_ACCESS_KEY=<SECRET>'
const FN_ARN = 'arn:aws:lambda:us-east-1:000000000000:function:rotator'

/** A rotation function with the four standard steps. The database is imaginary, so set/test only log. */
export const ROTATION_HANDLER = `import { SecretsManagerClient, GetSecretValueCommand, PutSecretValueCommand, DescribeSecretCommand, UpdateSecretVersionStageCommand } from "@aws-sdk/client-secrets-manager";

const sm = new SecretsManagerClient({});

// Secrets Manager calls this four times per rotation: createSecret, setSecret, testSecret, finishSecret.
export const handler = async ({ SecretId, ClientRequestToken: token, Step }) => {
  console.log("rotation step:", Step);
  const meta = await sm.send(new DescribeSecretCommand({ SecretId }));
  const stages = meta.VersionIdsToStages ?? {};
  if (!stages[token]) throw new Error("version " + token + " has no stage for rotation");
  if (stages[token].includes("AWSCURRENT")) return; // already finished

  if (Step === "createSecret") {
    const current = JSON.parse((await sm.send(new GetSecretValueCommand({ SecretId, VersionStage: "AWSCURRENT" }))).SecretString);
    try {
      await sm.send(new GetSecretValueCommand({ SecretId, VersionId: token, VersionStage: "AWSPENDING" }));
    } catch {
      // no pending value yet: generate the new one and store it as AWSPENDING
      const next = { ...current, password: "rotated-" + token.slice(0, 8) };
      await sm.send(new PutSecretValueCommand({ SecretId, ClientRequestToken: token, VersionStages: ["AWSPENDING"], SecretString: JSON.stringify(next) }));
    }
  }
  // setSecret: a real function changes the password inside the database here (using AWSPENDING).
  // testSecret: a real function logs in with the AWSPENDING credentials here.
  if (Step === "finishSecret") {
    const currentId = Object.entries(stages).find(([, s]) => s.includes("AWSCURRENT"))[0];
    await sm.send(new UpdateSecretVersionStageCommand({ SecretId, VersionStage: "AWSCURRENT", MoveToVersionId: token, RemoveFromVersionId: currentId }));
  }
};
`

export const secretsRotation: LessonContent = {
  id: 'secrets-rotation',
  n: '11.3',
  trackId: 'security',
  level: 'advanced',
  prereqs: ['kms-envelope', 'lambda-config-errors'],
  estMinutes: 45,
  honesty: 'live',
  honestyNote: 'Secrets Manager versions and staging labels are real, and rotation really invokes your Lambda through the four steps. The emulator enforces the Lambda resource policy (rotation fails without add-permission) and secret resource policies (a Deny blocks a user). It leaves the AWSPENDING label on the new version after finishing, which real AWS removes.',
  examTags: ['SAA:Secure', 'DVA:Sec', 'DVA:Dev'],
  breakItCheck: 'breakit',
  editable: ['rotation.mjs', 'secret-policy.json'],
  title: 'Secrets Manager: versions, staging labels and rotation with a Lambda',
  tagline: 'Create a secret, watch AWSCURRENT and AWSPREVIOUS move, then rotate it with a Lambda that Secrets Manager is first allowed to call.',
  predict: [
    { id: 'p1', prompt: 'You call put-secret-value on a secret that already has a value. Where do the old and the new value end up?', options: ['The old value is overwritten and lost', 'The new version becomes AWSCURRENT and the old one is relabelled AWSPREVIOUS', 'Both stay AWSCURRENT until you delete one', 'The new version becomes AWSPENDING until you promote it'], answer: 1, explain: 'Every value is a version. A plain put-secret-value moves AWSCURRENT to the new version and gives the previous one the AWSPREVIOUS label, so you can roll back by reading or relabelling it. Older, unlabelled versions are deprecated and eventually cleaned up.' },
    { id: 'p2', prompt: 'Rotation is configured with a Lambda ARN, but you never ran lambda add-permission for secretsmanager.amazonaws.com. What happens at rotate-secret?', options: ['Secrets Manager invokes the function anyway: it is in the same account', 'The call fails: Secrets Manager cannot invoke the function until the function policy grants it lambda:InvokeFunction', 'The secret is rotated by a built-in default function', 'The rotation silently never runs and rotate-secret still succeeds'], answer: 1, explain: 'Secrets Manager is a service principal and needs a resource-based permission on the function, even in the same account. Without it the rotate-secret call is refused with AccessDeniedException, which is why the console adds the permission for you and the CLI does not.' },
    { id: 'p3', prompt: 'A user has an IAM policy that allows secretsmanager:GetSecretValue on all secrets. The secret has a resource policy with an explicit Deny for that user. Can the user read the secret?', options: ['Yes, the IAM Allow is enough in the same account', 'No, an explicit Deny in any applicable policy overrides every Allow', 'Yes, but only the AWSPREVIOUS version', 'It depends on which policy was written last'], answer: 1, explain: 'Policy evaluation is the same as everywhere: explicit Deny wins. Resource policies on secrets are used for cross-account access and for guardrails such as denying everyone outside your organization.' },
  ],
  concept: [
    "A **secret** in Secrets Manager is a container for **versions**. Each version holds a value (`SecretString` or `SecretBinary`, up to 64 KB) and carries one or more **staging labels**. The two that matter are `AWSCURRENT` (what `GetSecretValue` returns by default) and `AWSPREVIOUS` (the one before). `PutSecretValue` creates a new version, moves `AWSCURRENT` to it and relabels the old current as `AWSPREVIOUS`. A third label, `AWSPENDING`, marks a candidate value during rotation. Because applications ask for `AWSCURRENT` at call time, a value changes with no redeploy; clients should cache with a TTL, or fetch through the AWS caching client, to avoid a request per call. Secrets are encrypted with a KMS key (the AWS managed `aws/secretsmanager` by default, or your customer managed key; cross-account access needs the customer managed one), and deleting a secret has a 7 to 30 day recovery window.",
    "**Rotation** replaces a secret on a schedule without downtime, by running a Lambda function in four steps, each a separate invocation with the same `ClientRequestToken`: **createSecret** stores a new value as `AWSPENDING`, **setSecret** applies it in the target (change the database password), **testSecret** proves the new credentials work, and **finishSecret** moves `AWSCURRENT` to the new version (the old one becomes `AWSPREVIOUS`). During the whole process the old value is still `AWSCURRENT`, so clients keep working. If a step throws, rotation stops with the old value still current. For RDS, Redshift and DocumentDB AWS provides ready-made rotation functions, including the 'alternating users' strategy that avoids a window where connections hold the old password.",
    "Three permissions have to line up, and the exam asks about each. (1) **Secrets Manager must be allowed to invoke the function**: a resource policy on the Lambda granting `lambda:InvokeFunction` to `secretsmanager.amazonaws.com` (`lambda add-permission`, ideally restricted with a source account or ARN to avoid the confused deputy problem). (2) **The function's execution role** needs `secretsmanager:GetSecretValue`, `PutSecretValue`, `DescribeSecret` and `UpdateSecretVersionStage` on the secret, plus `kms:Decrypt`/`GenerateDataKey` on a customer managed key, and network access to the database and to Secrets Manager (a VPC endpoint if the function runs in a private subnet). (3) The person or pipeline calling `rotate-secret` needs `secretsmanager:RotateSecret`. Separately, a **secret resource policy** controls who may read the secret, including other accounts, and an explicit Deny in it beats any identity Allow.",
    "In this module you create the secret, push a manual version to see the labels move, create the rotation function from `rotation.zip`, fail a rotation because the permission is missing, fix it, and watch the four steps in the function's logs. The fixture created the execution role `rotation-role` and a user `reader`. Reading a secret prints its value to your terminal: that is why real systems never log GetSecretValue output. The checker compares values on the server and returns none of them.",
  ],
  goal: 'A secret with a manual version, a rotation Lambda that Secrets Manager may invoke, a rotated AWSCURRENT value with the old one under AWSPREVIOUS, the four steps in the logs, and a resource-policy Deny that locks a reader out.',
  steps: [
    { id: 'look', title: 'Look at the rotation role and function code', body: "The fixture created `rotation-role` (Lambda trust, logs, and the Secrets Manager actions a rotation function needs). `rotation.mjs` is the function: open it in Files and find the four steps. The database is imaginary, so set and test only log.", commands: ['aws iam get-role-policy --role-name rotation-role --policy-name rotation --query PolicyDocument --output json'] },
    { id: 'create', title: 'Create the secret', body: 'A JSON secret with a username and password. The output shows the ARN and the first `VersionId`.', commands: [`aws secretsmanager create-secret --name app/db --secret-string '{"user":"app","password":"initial-pw"}'`] },
    { id: 'versions', title: 'Push a manual version and read the labels', body: "A plain `put-secret-value` makes the new value `AWSCURRENT` and relabels the old one `AWSPREVIOUS`. Read the previous version and look at the label map.", commands: [`aws secretsmanager put-secret-value --secret-id app/db --secret-string '{"user":"app","password":"manual-pw"}' --query VersionStages --output text`, 'aws secretsmanager get-secret-value --secret-id app/db --version-stage AWSPREVIOUS --query SecretString --output text', 'aws secretsmanager describe-secret --secret-id app/db --query VersionIdsToStages --output json'] },
    { id: 'fn', title: 'Create the rotation function', body: 'The zip is built from `rotation.mjs`. Give it 30 seconds: a real rotation may talk to a database.', commands: [`aws lambda create-function --function-name rotator --runtime nodejs22.x --handler rotation.handler --role arn:aws:iam::000000000000:role/rotation-role --zip-file fileb://rotation.zip --timeout 30`, 'aws lambda wait function-active-v2 --function-name rotator'] },
    { id: 'break', title: 'Break it: rotate without letting Secrets Manager invoke the function', body: "The role is fine and the function exists, but nothing on the function allows `secretsmanager.amazonaws.com` to call it. The request is refused and no rotation is configured.", commands: [`aws secretsmanager rotate-secret --secret-id app/db --rotation-lambda-arn ${FN_ARN} --rotation-rules AutomaticallyAfterDays=30`], breakIt: true },
    { id: 'perm', title: 'Allow Secrets Manager to invoke the function', body: "Add the resource-based permission. `--source-account` keeps other accounts' Secrets Manager from using your function.", commands: ['aws lambda add-permission --function-name rotator --statement-id secretsmanager --action lambda:InvokeFunction --principal secretsmanager.amazonaws.com --source-account 000000000000'] },
    { id: 'rotate', title: 'Rotate for real', body: 'Same command as before. Rotation starts immediately and the function is invoked for each step. Give it a few seconds.', commands: [`aws secretsmanager rotate-secret --secret-id app/db --rotation-lambda-arn ${FN_ARN} --rotation-rules AutomaticallyAfterDays=30`] },
    { id: 'watch', title: 'Watch the labels and the values', body: "Re-run until `RotationEnabled` is true and `AWSCURRENT` sits on a new version. The password is now `rotated-...`, and `AWSPREVIOUS` holds the value from before the rotation (`manual-pw`). The emulator leaves `AWSPENDING` on the finished version too; real AWS removes it.", commands: ["aws secretsmanager describe-secret --secret-id app/db --query '[RotationEnabled,VersionIdsToStages]' --output json", 'aws secretsmanager get-secret-value --secret-id app/db --query SecretString --output text', 'aws secretsmanager get-secret-value --secret-id app/db --version-stage AWSPREVIOUS --query SecretString --output text'] },
    { id: 'logs', title: 'See the four steps in the function logs', body: 'Each step logged its name: `createSecret`, `setSecret`, `testSecret`, `finishSecret`.', commands: ["aws logs filter-log-events --log-group-name /aws/lambda/rotator --filter-pattern rotation --query 'events[].message' --output text"] },
    { id: 'policy', title: 'Lock a reader out with a secret resource policy', body: "`reader` has an IAM Allow for `GetSecretValue`. First create its keys and read the secret. Then attach `secret-policy.json` (an explicit Deny for `reader`) to the secret and read again: refused.", commands: ["aws iam create-access-key --user-name reader --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text", `${READER} aws secretsmanager get-secret-value --secret-id app/db --query Name --output text`, 'aws secretsmanager put-resource-policy --secret-id app/db --resource-policy file://secret-policy.json', `${READER} aws secretsmanager get-secret-value --secret-id app/db --query Name --output text`] },
  ],
  breakIt: {
    title: 'Rotation without lambda add-permission',
    command: `aws secretsmanager rotate-secret --secret-id app/db --rotation-lambda-arn ${FN_ARN} --rotation-rules AutomaticallyAfterDays=30`,
    explain: [
      "`AccessDeniedException: Secrets Manager cannot invoke the specified Lambda function. Ensure that the function policy grants access to the principal secretsmanager.amazonaws.com.` Even in the same account a service principal needs a resource-based permission on the function.",
      "Nothing changed on the secret: `RotationEnabled` is still false and no version was created. Two other permissions can still break a configured rotation later: the function's execution role (it needs the four Secrets Manager actions and `kms:Decrypt` for a customer managed key) and network access to the database.",
    ],
  },
  realAws: {
    cost: [
      "About 0.40 USD per secret per month (prorated) plus about 0.05 USD per 10,000 API calls, after a 30-day free trial per secret. Rotation Lambda invocations and a customer managed KMS key are billed separately. List prices as of 2026-11-15, check the pricing page before relying on them.",
      "Parameter Store standard parameters are free; that is the usual reason to pick it for non-rotating configuration (see 11.4).",
    ],
    differences: [
      "Real Secrets Manager removes the `AWSPENDING` label from the new version once rotation finishes; the emulator leaves it next to `AWSCURRENT`.",
      "For RDS, Redshift and DocumentDB the console can create the rotation function from an AWS-managed template (single-user or alternating-users strategy); this module hand-writes a toy function. The database steps (setSecret, testSecret) are only log lines here.",
      "A real rotation function in a VPC needs a route to Secrets Manager (VPC endpoint or NAT) and the database security group must allow it. None of that exists in the emulator.",
      "Secrets Manager can also rotate with 'managed rotation' for supported services without any Lambda you own. Not available in the emulator.",
    ],
    asOf: '2026-11-15',
    sources: [
      { label: 'Rotate AWS Secrets Manager secrets', url: 'https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets.html' },
      { label: 'Rotation function permissions', url: 'https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets-required-permissions-function.html' },
      { label: 'Secrets Manager versions and staging labels', url: 'https://docs.aws.amazon.com/secretsmanager/latest/userguide/getting-started.html#term_version' },
      { label: 'Resource-based policies for secrets', url: 'https://docs.aws.amazon.com/secretsmanager/latest/userguide/auth-and-access_resource-policies.html' },
    ],
  },
  fidelity: [{ service: 'Secrets Manager', pass: 175, total: 220 }, { service: 'Lambda', pass: 395, total: 788 }],
  files: ['rotation.mjs', 'rotation.zip', 'secret-policy.json'],
  checks: [
    { id: 'versions', label: 'A manual version was pushed and AWSPREVIOUS read back', hint: 'Run put-secret-value, then get-secret-value --version-stage AWSPREVIOUS.' },
    { id: 'fn', label: 'Function `rotator` is Active', hint: 'Run the create-function step.' },
    { id: 'breakit', label: 'You saw rotation refused because Secrets Manager may not invoke the function', hint: 'Run rotate-secret before add-permission.' },
    { id: 'perm', label: 'The function policy lets secretsmanager.amazonaws.com invoke it', hint: 'Run lambda add-permission for secretsmanager.amazonaws.com.' },
    { id: 'rotated', label: 'AWSCURRENT is now a `rotated-...` password', hint: 'Run rotate-secret again and wait a few seconds.' },
    { id: 'previous', label: 'AWSPREVIOUS holds the value from before the rotation', hint: 'It appears when finishSecret moves AWSCURRENT; re-run describe-secret.' },
    { id: 'steps', label: 'The function logs show createSecret and finishSecret', hint: 'Look in /aws/lambda/rotator once the rotation has run.' },
    { id: 'policy', label: 'A resource-policy Deny stopped `reader` after it had read the secret', hint: 'Read as reader, put-resource-policy with secret-policy.json, read again.' },
  ],
}
