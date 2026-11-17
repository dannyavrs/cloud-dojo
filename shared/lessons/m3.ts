import type { LessonContent } from '../types'
import { APIGW_LESSONS } from './m3-apigw'
import { SFN_LESSONS } from './m3-stepfunctions'
import { EB_LESSONS } from './m3-eventbridge'
import { CW_LESSONS } from './m3-cloudwatch'
import { SEC_LESSONS } from './m3-security'

export const M3_LESSONS: LessonContent[] = [...APIGW_LESSONS, ...SFN_LESSONS, ...EB_LESSONS, ...CW_LESSONS, ...SEC_LESSONS]
