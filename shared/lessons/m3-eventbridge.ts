import type { LessonContent } from '../types'
import { ebPatterns } from './eb-patterns'
import { ebTargetsSfn } from './eb-targets-sfn'
import { ebScheduler } from './eb-scheduler'
import { ebArchiveReplay } from './eb-archive-replay'

/** EventBridge track modules (M3). 9.1 (s3-sqs-lambda) lives in its original file; one file per module under shared/lessons/, listed here in order. */
export const EB_LESSONS: LessonContent[] = [ebPatterns, ebTargetsSfn, ebScheduler, ebArchiveReplay]
