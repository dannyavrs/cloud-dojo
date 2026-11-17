import type { LessonServer } from '../lesson-kit'
import { capstone } from './capstone'
import { dynamodbNotes, iamIntern, lambdaRoles, liftOff, s3Versioning } from './basics'
import { DDB_SERVER_LESSONS } from './ddb'
import { MESSAGING_SERVER_LESSONS } from './messaging'
import { FOUNDATIONS_SERVER_LESSONS } from './m2-foundations'
import { IAM_SERVER_LESSONS } from './m2-iam'
import { LAMBDA_SERVER_LESSONS } from './m2-lambda'
import { S3_SERVER_LESSONS } from './m2-s3'
import { M3_SERVER_LESSONS } from './m3'
import { httpApi, s3SqsLambda, snsSqs } from './wiring'

export const SERVER_LESSONS: LessonServer[] = [
  liftOff, ...FOUNDATIONS_SERVER_LESSONS, iamIntern, ...IAM_SERVER_LESSONS, s3Versioning, ...S3_SERVER_LESSONS,
  dynamodbNotes, ...DDB_SERVER_LESSONS,
  lambdaRoles, ...LAMBDA_SERVER_LESSONS,
  snsSqs, ...MESSAGING_SERVER_LESSONS,
  s3SqsLambda, httpApi, ...M3_SERVER_LESSONS, capstone,
]
export const serverLesson = (id: string) => SERVER_LESSONS.find((l) => l.id === id)
