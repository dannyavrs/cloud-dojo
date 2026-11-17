import type { LessonServer } from '../lesson-kit'
import { sfnRetry } from './sfn-retry'
import { sfnCatchFail } from './sfn-catch-fail'
import { sfnMapChoiceDdb } from './sfn-map-choice-ddb'
import { sfnWaitForToken } from './sfn-wait-for-token'
import { sfnExpressJsonata } from './sfn-express-jsonata'

/** Step Functions track checkers (M3). Same order as shared/lessons/m3-stepfunctions.ts. */
export const SFN_SERVER_LESSONS: LessonServer[] = [sfnRetry, sfnCatchFail, sfnMapChoiceDdb, sfnWaitForToken, sfnExpressJsonata]
