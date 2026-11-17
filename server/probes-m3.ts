import type { Probe } from './capabilities'
import { APIGW_PROBES } from './probes-apigw'
import { SFN_PROBES } from './probes-stepfunctions'
import { EB_PROBES } from './probes-eventbridge'
import { CW_PROBES } from './probes-cloudwatch'
import { SEC_PROBES } from './probes-security'

export const M3_PROBES: Probe[] = [...APIGW_PROBES, ...SFN_PROBES, ...EB_PROBES, ...CW_PROBES, ...SEC_PROBES]
