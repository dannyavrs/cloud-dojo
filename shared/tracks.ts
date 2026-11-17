import { IAM_EXAM } from './exam-iam'
import { LAMBDA_EXAM } from './exam-lambda'
import { S3_EXAM } from './exam-s3'
import { APIGW_EXAM } from './exam-apigw'
import { CW_EXAM } from './exam-cloudwatch'
import { EB_EXAM } from './exam-eventbridge'
import { SEC_EXAM } from './exam-security'
import { SFN_EXAM } from './exam-stepfunctions'
import { DDB_EXAM, MESSAGING_EXAM } from './exams'
import type { Track } from './types'

export const TRACKS: Track[] = [
  { id: 'foundations', n: '0', title: 'Foundations', blurb: 'Credentials, the CLI, JMESPath, pagination, waiters and your first real AWS error.', tile: 'foundations', exams: ['SAA:Secure'] },
  { id: 'iam', n: '1', title: 'IAM', blurb: 'Policy evaluation, conditions, roles and STS, resource policies, boundaries and ABAC, with the real AccessDenied.', tile: 'iam', exams: ['SAA:Secure', 'DVA:Sec'], exam: IAM_EXAM },
  { id: 's3', n: '2', title: 'S3', blurb: 'Versioning, presigned URLs, multipart, notifications, lifecycle, encryption and Object Lock, replication.', tile: 's3', exams: ['SAA:Resilient', 'SAA:Cost', 'DVA:Dev'], exam: S3_EXAM },
  { id: 'dynamodb', n: '3', title: 'DynamoDB', blurb: 'From keys to single-table design, indexes, transactions, streams and the cost of a Scan.', tile: 'dynamodb', exams: ['SAA:Performant', 'SAA:Cost', 'SAA:Resilient', 'DVA:Dev'], exam: DDB_EXAM },
  { id: 'lambda', n: '4', title: 'Lambda', blurb: 'Roles and logs, configuration and errors, versions and canary aliases, layers, concurrency, function URLs, async.', tile: 'lambda', exams: ['DVA:Dev', 'DVA:Deploy', 'SAA:Performant'], exam: LAMBDA_EXAM },
  { id: 'messaging', n: '5', title: 'Messaging: SQS and SNS', blurb: 'Visibility, dead letters, FIFO, filtered fan-out and Lambda at scale.', tile: 'messaging', exams: ['SAA:Resilient', 'SAA:Cost', 'DVA:Dev', 'DVA:Troubleshoot'], exam: MESSAGING_EXAM },
  { id: 'apigw', n: '7', title: 'API Gateway', blurb: 'HTTP APIs, stages, Lambda and Cognito JWT authorizers, throttling and CORS, REST API keys and usage plans.', tile: 'apigw', exams: ['DVA:Dev', 'DVA:Deploy', 'DVA:Sec', 'SAA:Performant', 'SAA:Secure'], exam: APIGW_EXAM },
  { id: 'stepfunctions', n: '8', title: 'Step Functions', blurb: 'Retry and backoff, Catch and Fail, Map and Choice, callbacks, Express and JSONata.', tile: 'stepfunctions', exams: ['SAA:Resilient', 'DVA:Dev'], exam: SFN_EXAM },
  { id: 'eventbridge', n: '9', title: 'EventBridge and Scheduler', blurb: 'S3 to SQS to Lambda, buses and patterns, targets with roles, schedules, archive and replay.', tile: 'eventbridge', exams: ['SAA:Resilient', 'DVA:Dev'], exam: EB_EXAM },
  { id: 'cloudwatch', n: '10', title: 'CloudWatch', blurb: 'Custom metrics, alarms that page by themselves, logs and metric filters, dashboards.', tile: 'cloudwatch', exams: ['SAA:Performant', 'DVA:Troubleshoot'], exam: CW_EXAM },
  { id: 'security', n: '11', title: 'KMS, Secrets Manager, Parameter Store', blurb: 'Envelope encryption, key policies and grants, secret rotation, SecureString parameters.', tile: 'security', exams: ['SAA:Secure', 'DVA:Sec'], exam: SEC_EXAM },
  { id: 'capstone', n: '★', title: 'Capstone', blurb: 'Build Snap Notes end to end from a spec card.', tile: 'capstone', exams: ['SAA:Secure', 'SAA:Resilient', 'DVA:Dev'] },
]
export const trackById = (id: string) => TRACKS.find((t) => t.id === id)
