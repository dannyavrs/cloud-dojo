import type { LessonContent } from '../types'
import { kmsEnvelope } from './kms-envelope'
import { kmsPoliciesGrants } from './kms-policies-grants'
import { secretsRotation } from './secrets-rotation'
import { ssmParameterStore } from './ssm-parameter-store'

/** Security track modules (M3). One file per module under shared/lessons/, listed here in order. */
export const SEC_LESSONS: LessonContent[] = [kmsEnvelope, kmsPoliciesGrants, secretsRotation, ssmParameterStore]
