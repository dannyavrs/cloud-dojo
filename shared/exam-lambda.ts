import type { QuizQuestion } from './types'

export const LAMBDA_EXAM: QuizQuestion[] = [
  {
    id: 'e1', tag: 'DVA:Dev',
    prompt: 'An order service publishes events to an SNS topic that triggers a Lambda function. The function sometimes throws on malformed events. Which statement about how Lambda handles these failures is correct?',
    options: [
      'SNS invokes Lambda synchronously, so the publisher receives the error',
      'SNS invokes Lambda asynchronously, so Lambda retries a failed event up to two more times and can then send it to a DLQ or OnFailure destination',
      'Lambda polls SNS with an event source mapping and returns the message to the topic after the visibility timeout',
      'Failed events are retried indefinitely until the function succeeds',
    ],
    answer: 1,
    explain: 'SNS (like S3 and EventBridge) invokes functions asynchronously: Lambda queues the event, returns 202, retries failures up to 2 times (0 to 2 is configurable) and keeps events for up to 6 hours. Event source mappings (SQS, Kinesis) are polling-based, and SQS-style visibility timeouts do not apply to SNS.',
  },
  {
    id: 'e2', tag: 'SAA:Resilient',
    prompt: 'A critical Lambda function shares an account with dozens of others. During a traffic spike another function consumed most of the 1,000 account-level concurrent executions and the critical function was throttled. How do you guarantee capacity for the critical function with no extra cost?',
    options: [
      'Enable provisioned concurrency on $LATEST of the critical function',
      'Raise the memory size so the function finishes faster',
      'Configure reserved concurrency on the critical function',
      'Create a second copy of the function in the same region',
    ],
    answer: 2,
    explain: 'Reserved concurrency carves a guaranteed slice out of the account pool for one function (and caps it at that level) at no charge. Provisioned concurrency costs money, targets a version or alias, never $LATEST, and is for cold starts, not capacity. Faster execution lowers concurrency demand but guarantees nothing.',
  },
  {
    id: 'e3', tag: 'DVA:Deploy',
    prompt: 'A team must release a new Lambda version to 10% of API traffic for 10 minutes, then to everyone, and roll back automatically if a CloudWatch alarm fires. Which approach meets this with the least custom code?',
    options: [
      'Publish the version and run a Step Functions workflow that updates the API Gateway integration',
      'Deploy to $LATEST and use Route 53 weighted records to split traffic',
      'Create two functions and use an ALB listener rule with 10% weight',
      'Use an alias with weighted routing deployed through AWS CodeDeploy with a Canary10Percent10Minutes configuration and an alarm',
    ],
    answer: 3,
    explain: 'CodeDeploy for Lambda (also via SAM DeploymentPreference) shifts alias traffic using Canary or Linear configurations, runs pre/post-traffic hooks and rolls back automatically on a CloudWatch alarm. Aliases are the unit of routing, and only published versions (not $LATEST) can be weighted.',
  },
  {
    id: 'e4', tag: 'DVA:Dev',
    prompt: 'Six Lambda functions need the same 90 MB Python data-science library. The team wants smaller deployment packages and one place to update the library. What should they do, and what constraint applies?',
    options: [
      'Put the library in a layer and attach it to each function; a function can use at most 5 layers and the unzipped function plus layers must be under 250 MB',
      'Put the library in /tmp at start-up; /tmp is shared between functions',
      'Create a layer and attach it; layers update automatically in all functions when a new layer version is published',
      'Use a layer; a function can use at most 15 layers of 250 MB each',
    ],
    answer: 0,
    explain: 'Layers share dependencies across functions and shrink the package, but the limits are 5 layers per function and 250 MB unzipped in total. Layer versions are immutable and functions reference a specific version ARN, so there is no automatic update. /tmp is private to each execution environment.',
  },
  {
    id: 'e5', tag: 'DVA:Sec',
    prompt: 'A Lambda function reads a third-party API key from an environment variable. The security team requires that the key is encrypted with a key whose use is audited and that only the function can decrypt it. What is the best solution?',
    options: [
      'Nothing: environment variables are always encrypted with a key that can be audited per use',
      'Store the key in a plaintext environment variable inside a VPC-attached function',
      'Encrypt the variable with a customer managed KMS key, grant the execution role kms:Decrypt on it, and prefer Secrets Manager or Parameter Store for the secret itself',
      'Base64-encode the value and put it in the deployment package',
    ],
    answer: 2,
    explain: 'Environment variables are encrypted at rest by default with an AWS managed key, but a customer managed KMS key gives key policy control and CloudTrail evidence of each use. Anyone with lambda:GetFunctionConfiguration can still read the value, so secrets belong in Secrets Manager or Parameter Store, fetched at start-up and cached.',
  },
  {
    id: 'e6', tag: 'SAA:Performant',
    prompt: 'A Java Lambda function behind an API shows multi-second cold starts after idle periods. The team wants to reduce them with the least operational change and without paying for always-on capacity. What should they enable?',
    options: [
      'Reserved concurrency set to 1',
      'A VPC with a NAT gateway',
      'Provisioned concurrency on $LATEST',
      'Lambda SnapStart on published versions',
    ],
    answer: 3,
    explain: 'SnapStart restores execution environments from a cached snapshot taken after initialisation, cutting cold start time for supported runtimes (Java, and later Python and .NET) without a standing charge for idle capacity. Provisioned concurrency also works but is billed continuously and needs an alias or version; reserved concurrency does not warm anything.',
  },
  {
    id: 'e7', tag: 'SAA:Secure',
    prompt: 'A developer needs a quick public HTTPS endpoint for a webhook that invokes one Lambda function, with no API Gateway cost. Only the webhook provider should call it, using a shared secret. Which setup is correct?',
    options: [
      'Create a Function URL with AWS_IAM auth and give the provider an access key',
      'Create a Function URL with auth type NONE, allow lambda:InvokeFunctionUrl through the resource policy, verify the shared secret in the handler and cap it with reserved concurrency',
      'Create a Function URL with auth type JWT',
      'Attach an IAM role to the Function URL and share the role ARN with the provider',
    ],
    answer: 1,
    explain: 'Function URLs support only NONE and AWS_IAM. A third-party webhook cannot sign SigV4, so NONE plus the required resource-based policy statements and your own verification (HMAC or shared secret) is the usual pattern; reserved concurrency limits cost and abuse. There is no JWT auth type, and a URL is not attached to a role.',
  },
  {
    id: 'e8', tag: 'DVA:Troubleshoot',
    prompt: 'A function triggered by an SQS queue has a function-level dead-letter queue configured. Messages keep failing and the DLQ stays empty, and customers are occasionally charged twice. Which statement best explains both symptoms?',
    options: [
      'Async invokes are at-least-once so retries can repeat side effects, and a function-level DLQ only applies to async invokes, so an SQS-triggered function needs the redrive policy on the source queue instead',
      'Lambda guarantees exactly-once delivery, so the duplicate charge comes from SQS',
      'DLQs only work for synchronous invokes',
      'Retries are disabled by default so the duplicate must come from the client',
    ],
    answer: 0,
    explain: 'Both async delivery and SQS polling are at least once, so handlers must be idempotent (idempotency key plus conditional write). A function DLQ and destinations only apply to async invocations; SQS triggers are polling by an event source mapping, so failed messages are handled by the queue redrive policy.',
  }
]
