import type { LessonServer } from '../lesson-kit'
import { cwMetrics } from './cw-metrics'
import { cwAlarmsSns } from './cw-alarms-sns'
import { cwLogsInsights } from './cw-logs-insights'
import { cwDashboards } from './cw-dashboards'

/** CloudWatch track checkers (M3). Same order as shared/lessons/m3-cloudwatch.ts. */
export const CW_SERVER_LESSONS: LessonServer[] = [cwMetrics, cwAlarmsSns, cwLogsInsights, cwDashboards]
