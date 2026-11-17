import type { LessonServer } from '../lesson-kit'
import { APIGW_SERVER_LESSONS } from './m3-apigw'
import { SFN_SERVER_LESSONS } from './m3-stepfunctions'
import { EB_SERVER_LESSONS } from './m3-eventbridge'
import { CW_SERVER_LESSONS } from './m3-cloudwatch'
import { SEC_SERVER_LESSONS } from './m3-security'

export const M3_SERVER_LESSONS: LessonServer[] = [...APIGW_SERVER_LESSONS, ...SFN_SERVER_LESSONS, ...EB_SERVER_LESSONS, ...CW_SERVER_LESSONS, ...SEC_SERVER_LESSONS]
