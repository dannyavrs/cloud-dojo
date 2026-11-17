import type { LessonContent } from '../types'
import { cwMetrics } from './cw-metrics'
import { cwAlarmsSns } from './cw-alarms-sns'
import { cwLogsInsights } from './cw-logs-insights'
import { cwDashboards } from './cw-dashboards'

/** CloudWatch track modules (M3). One file per module under shared/lessons/, listed here in order. */
export const CW_LESSONS: LessonContent[] = [cwMetrics, cwAlarmsSns, cwLogsInsights, cwDashboards]
