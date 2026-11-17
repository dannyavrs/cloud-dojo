import type { LessonServer } from '../lesson-kit'
import { s3DataProtection } from './s3-data-protection'
import { s3Lifecycle } from './s3-lifecycle'
import { s3Multipart } from './s3-multipart'
import { s3Notifications } from './s3-notifications'
import { s3Presigned } from './s3-presigned'
import { s3ReplicationConditional } from './s3-replication-conditional'

export const S3_SERVER_LESSONS: LessonServer[] = [s3Presigned, s3Multipart, s3Notifications, s3Lifecycle, s3DataProtection, s3ReplicationConditional]
