import type { E2EScript } from './e2e-kit'
import { IAM_E2E } from './e2e-iam'
import { S3_E2E } from './e2e-s3'
import { LAMBDA_E2E } from './e2e-lambda'
import { FOUNDATIONS_E2E } from './e2e-foundations'

/** Module id -> script that replays the learner's commands. One file per M2 track. */
export const M2_E2E: Record<string, E2EScript> = { ...FOUNDATIONS_E2E, ...IAM_E2E, ...S3_E2E, ...LAMBDA_E2E }
