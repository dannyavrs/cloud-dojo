import type { LessonContent } from '../types'
import { apigwJwtCognito } from './apigw-jwt-cognito'
import { apigwLambdaAuthorizer } from './apigw-lambda-authorizer'
import { apigwRestKeysUsage } from './apigw-rest-keys-usage'
import { apigwRoutesStages } from './apigw-routes-stages'
import { apigwThrottleCors } from './apigw-throttle-cors'

/** API Gateway track modules (M3). One file per module under shared/lessons/, listed here in order. */
export const APIGW_LESSONS: LessonContent[] = [apigwRoutesStages, apigwLambdaAuthorizer, apigwJwtCognito, apigwThrottleCors, apigwRestKeysUsage]
