import type { LessonServer } from '../lesson-kit'
import { kmsEnvelope } from './kms-envelope'
import { kmsPoliciesGrants } from './kms-policies-grants'
import { secretsRotation } from './secrets-rotation'
import { ssmParameterStore } from './ssm-parameter-store'

/** Security track checkers (M3). Same order as shared/lessons/m3-security.ts. */
export const SEC_SERVER_LESSONS: LessonServer[] = [kmsEnvelope, kmsPoliciesGrants, secretsRotation, ssmParameterStore]
