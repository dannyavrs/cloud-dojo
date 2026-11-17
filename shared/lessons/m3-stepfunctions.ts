import type { LessonContent } from '../types'
import { sfnRetry } from './sfn-retry'
import { sfnCatchFail } from './sfn-catch-fail'
import { sfnMapChoiceDdb } from './sfn-map-choice-ddb'
import { sfnWaitForToken } from './sfn-wait-for-token'
import { sfnExpressJsonata } from './sfn-express-jsonata'

/** Step Functions track modules (M3). One file per module under shared/lessons/, listed here in order. */
export const SFN_LESSONS: LessonContent[] = [sfnRetry, sfnCatchFail, sfnMapChoiceDdb, sfnWaitForToken, sfnExpressJsonata]
