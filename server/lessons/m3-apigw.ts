import type { LessonServer } from '../lesson-kit'
import { apigwJwtCognito } from './apigw-jwt-cognito'
import { apigwLambdaAuthorizer } from './apigw-lambda-authorizer'
import { apigwRestKeysUsage } from './apigw-rest-keys-usage'
import { apigwRoutesStages } from './apigw-routes-stages'
import { apigwThrottleCors } from './apigw-throttle-cors'

/** API Gateway track checkers (M3). Same order as shared/lessons/m3-apigw.ts. */
export const APIGW_SERVER_LESSONS: LessonServer[] = [apigwRoutesStages, apigwLambdaAuthorizer, apigwJwtCognito, apigwThrottleCors, apigwRestKeysUsage]
