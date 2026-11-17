import type { LessonContent } from '../types'
import { TRACKS } from '../tracks'
import { capstone } from './capstone'
import { ddbConditional } from './ddb-conditional'
import { ddbIndexes } from './ddb-indexes'
import { ddbQueryScan } from './ddb-query-scan'
import { ddbSingleTable } from './ddb-single-table'
import { ddbStreamsTtl } from './ddb-streams-ttl'
import { ddbTransactions } from './ddb-transactions'
import { dynamodbNotes } from './dynamodb-notes'
import { httpApi } from './http-api'
import { iamIntern } from './iam-intern'
import { lambdaRoles } from './lambda-roles'
import { liftOff } from './lift-off'
import { M3_LESSONS } from './m3'
import { FOUNDATIONS_LESSONS } from './m2-foundations'
import { IAM_LESSONS } from './m2-iam'
import { LAMBDA_LESSONS } from './m2-lambda'
import { S3_LESSONS } from './m2-s3'
import { s3SqsLambda } from './s3-sqs-lambda'
import { s3Versioning } from './s3-versioning'
import { snsFilterFanout } from './sns-filter-fanout'
import { snsSqs } from './sns-sqs'
import { sqsDlqRedrive } from './sqs-dlq-redrive'
import { sqsFifo } from './sqs-fifo'
import { sqsLambdaBatch } from './sqs-lambda-batch'
import { sqsVisibility } from './sqs-visibility'

const ALL: LessonContent[] = [
  liftOff, ...FOUNDATIONS_LESSONS, iamIntern, ...IAM_LESSONS, s3Versioning, ...S3_LESSONS,
  dynamodbNotes, ddbSingleTable, ddbIndexes, ddbConditional, ddbTransactions, ddbStreamsTtl, ddbQueryScan,
  lambdaRoles, ...LAMBDA_LESSONS,
  snsSqs, sqsVisibility, sqsDlqRedrive, sqsFifo, snsFilterFanout, sqsLambdaBatch,
  s3SqsLambda, httpApi, ...M3_LESSONS, capstone,
]
/** Flat list in track order (track order first, then module order inside the track). */
export const LESSONS: LessonContent[] = TRACKS.flatMap((t) => ALL.filter((l) => l.trackId === t.id))
export const lessonById = (id: string) => LESSONS.find((l) => l.id === id)
export const modulesOf = (trackId: string) => LESSONS.filter((l) => l.trackId === trackId)

const SHORT: Record<string, string> = {
  'cli-fluency': 'CLI fluency', 'iam-evaluation': 'Policy evaluation', 'iam-conditions': 'Conditions', 'iam-roles-sts': 'Roles, trust and STS', 'iam-resource-policies': 'Resource policies', 'iam-boundaries': 'Permission boundaries', 'iam-abac': 'ABAC and tags',
  's3-presigned': 'Presigned URLs', 's3-multipart': 'Multipart upload', 's3-notifications': 'Event notifications', 's3-lifecycle': 'Lifecycle and classes', 's3-data-protection': 'KMS, BPA, Object Lock', 's3-replication-conditional': 'Replication, conditional writes',
  'lambda-config-errors': 'Configuration and errors', 'lambda-versions-aliases': 'Versions and canary', 'lambda-layers': 'Layers', 'lambda-concurrency': 'Concurrency', 'lambda-function-url': 'Function URLs', 'lambda-async-destinations': 'Async and destinations',
  'apigw-routes-stages': 'Routes, stages, variables', 'apigw-lambda-authorizer': 'Lambda authorizer', 'apigw-jwt-cognito': 'Cognito JWT authorizer', 'apigw-throttle-cors': 'Throttling and CORS', 'apigw-rest-keys-usage': 'REST API keys and usage plans',
  'sfn-retry': 'Retry and backoff', 'sfn-catch-fail': 'Catch, Fail, ResultPath', 'sfn-map-choice-ddb': 'Map, Choice, DynamoDB', 'sfn-wait-for-token': 'Human approval callback', 'sfn-express-jsonata': 'Express and JSONata',
  'eb-patterns': 'Event buses and routing', 'eb-targets-sfn': 'Targets with roles', 'eb-scheduler': 'Scheduler', 'eb-archive-replay': 'Archive and replay',
  'cw-metrics': 'Custom metrics', 'cw-alarms-sns': 'Alarms to SNS', 'cw-logs-insights': 'Logs and Insights', 'cw-dashboards': 'Dashboards',
  'kms-envelope': 'KMS and envelope encryption', 'kms-policies-grants': 'Key policies and grants', 'secrets-rotation': 'Secrets and rotation', 'ssm-parameter-store': 'Parameter Store',
  'lift-off': 'Lift-off', 'iam-intern': 'A read-only intern', 's3-versioning': 'Buckets, objects, versioning',
  'dynamodb-notes': 'Keys, queries, conditional writes', 'lambda-roles': 'Functions, roles, logs', 'sns-sqs': 'Fan-out and the queue policy',
  's3-sqs-lambda': 'S3 to SQS to Lambda', 'http-api': 'A public HTTP endpoint', capstone: 'Snap Notes',
}
/** Short title for nav rows and crumbs. */
export const shortTitle = (l: LessonContent) => SHORT[l.id] ?? l.title.split(':')[0]
