import type { LessonContent } from '../types'
import { iamAbac } from './iam-abac'
import { iamBoundaries } from './iam-boundaries'
import { iamConditions } from './iam-conditions'
import { iamEvaluation } from './iam-evaluation'
import { iamResourcePolicies } from './iam-resource-policies'
import { iamRolesSts } from './iam-roles-sts'

export const IAM_LESSONS: LessonContent[] = [iamEvaluation, iamConditions, iamRolesSts, iamResourcePolicies, iamBoundaries, iamAbac]
