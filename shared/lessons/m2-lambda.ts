import type { LessonContent } from '../types'
import { lambdaConfigErrors } from './lambda-config-errors'
import { lambdaVersionsAliases } from './lambda-versions-aliases'
import { lambdaLayers } from './lambda-layers'
import { lambdaConcurrency } from './lambda-concurrency'
import { lambdaFunctionUrl } from './lambda-function-url'
import { lambdaAsyncDestinations } from './lambda-async-destinations'

export const LAMBDA_LESSONS: LessonContent[] = [lambdaConfigErrors, lambdaVersionsAliases, lambdaLayers, lambdaConcurrency, lambdaFunctionUrl, lambdaAsyncDestinations]
