import type { LessonServer } from '../lesson-kit'
import { ebPatterns } from './eb-patterns'
import { ebTargetsSfn } from './eb-targets-sfn'
import { ebScheduler } from './eb-scheduler'
import { ebArchiveReplay } from './eb-archive-replay'

/** EventBridge track checkers (M3). Same order as shared/lessons/m3-eventbridge.ts. */
export const EB_SERVER_LESSONS: LessonServer[] = [ebPatterns, ebTargetsSfn, ebScheduler, ebArchiveReplay]
