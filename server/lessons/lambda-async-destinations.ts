import { EIC_STARTER, ORDERS_HANDLER } from '../../shared/lessons/lambda-async-destinations'
import { createFunction, createQueue } from './kit2'
import { item, ranOk, type LessonServer } from '../lesson-kit'
import { readWork, seedRole } from './lambda-kit'

const ARNS = [
  { type: 'SQS', re: /^arn:aws:sqs:[a-z0-9-]+:\d{12}:[A-Za-z0-9_-]{1,80}(\.fifo)?$/ },
  { type: 'SNS', re: /^arn:aws:sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9_-]{1,256}(\.fifo)?$/ },
  { type: 'Lambda', re: /^arn:aws:lambda:[a-z0-9-]+:\d{12}:function:[A-Za-z0-9_-]{1,64}(:[A-Za-z0-9_$-]+)?$/ },
  { type: 'EventBridge', re: /^arn:aws:events:[a-z0-9-]+:\d{12}:event-bus\/[A-Za-z0-9_.-]{1,256}$/ },
]
/** The destination type if the string is a well-formed ARN of an allowed service. */
export const destinationType = (d: unknown): string | undefined => (typeof d === 'string' ? ARNS.find((a) => a.re.test(d))?.type : undefined)

export const lambdaAsyncDestinations: LessonServer = {
  id: 'lambda-async-destinations',
  files: { 'event-invoke-config.json': EIC_STARTER, 'orders.mjs': ORDERS_HANDLER },
  zips: { 'orders.zip': { 'orders.mjs': ORDERS_HANDLER } },
  async fixture(ctx) {
    await seedRole(ctx, [{ Effect: 'Allow', Action: ['sqs:SendMessage', 'sns:Publish'], Resource: '*' }])
    for (const q of ['orders-failures', 'orders-success', 'orders-dlq']) await createQueue(ctx, q)
    await createFunction(ctx, 'orders-handler', 'orders.handler', 'orders.zip', 'lambda-exec')
  },
  async check(ctx) {
    let j: any
    try { j = JSON.parse(readWork(ctx, 'event-invoke-config.json')) } catch { j = undefined }
    const dc = j?.DestinationConfig ?? {}
    const failType = destinationType(dc.OnFailure?.Destination)
    const okType = destinationType(dc.OnSuccess?.Destination)
    const r = j?.MaximumRetryAttempts
    const age = j?.MaximumEventAgeInSeconds
    return [
      item('json', '`event-invoke-config.json` is valid JSON for function `orders-handler`', j?.FunctionName === 'orders-handler', 'Keep it valid JSON with FunctionName "orders-handler".'),
      item('failure', 'OnFailure is a well-formed ARN of an allowed type (SQS, SNS, Lambda or EventBridge)', Boolean(failType), 'Use a full ARN such as arn:aws:sqs:us-east-1:000000000000:orders-failures.', failType ? `${failType} destination` : String(dc.OnFailure?.Destination ?? 'missing')),
      item('success', 'OnSuccess is a well-formed ARN of an allowed type (not S3)', Boolean(okType), 'S3 is not a valid async destination. Use SQS, SNS, Lambda or EventBridge.', okType ? `${okType} destination` : String(dc.OnSuccess?.Destination ?? 'missing')),
      item('retries', 'MaximumRetryAttempts is between 0 and 2', Number.isInteger(r) && r >= 0 && r <= 2, 'Async invokes allow 0, 1 or 2 retries.', `${r ?? 'missing'}`),
      item('age', 'MaximumEventAgeInSeconds is between 60 and 21600', Number.isInteger(age) && age >= 60 && age <= 21600, 'The range is 60 seconds to 6 hours (21600).', `${age ?? 'missing'}`),
      item('applied', 'The emulator accepted your config with put-function-event-invoke-config', ranOk(ctx.history, /put-function-event-invoke-config/), 'Run the apply step after saving the file.'),
    ]
  },
}
