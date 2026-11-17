import type { E2EScript } from './e2e-kit'
import { APIGW_E2E } from './e2e-apigw'
import { SFN_E2E } from './e2e-stepfunctions'
import { EB_E2E } from './e2e-eventbridge'
import { CW_E2E } from './e2e-cloudwatch'
import { SEC_E2E } from './e2e-security'

/** Module id -> script that replays the learner's commands (M3 tracks). */
export const M3_E2E: Record<string, E2EScript> = { ...APIGW_E2E, ...SFN_E2E, ...EB_E2E, ...CW_E2E, ...SEC_E2E }
