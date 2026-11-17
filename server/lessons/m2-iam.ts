import type { LessonServer } from '../lesson-kit'
import { iamAbac, iamBoundaries, iamConditions, iamEvaluation, iamResourcePolicies, iamRolesSts } from './iam-modules'

export const IAM_SERVER_LESSONS: LessonServer[] = [iamEvaluation, iamConditions, iamRolesSts, iamResourcePolicies, iamBoundaries, iamAbac]
