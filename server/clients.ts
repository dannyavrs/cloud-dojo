import { readFileSync } from 'node:fs'
import https from 'node:https'
import { APIGatewayClient } from '@aws-sdk/client-api-gateway'
import { ApiGatewayV2Client } from '@aws-sdk/client-apigatewayv2'
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch'
import { CloudWatchLogsClient } from '@aws-sdk/client-cloudwatch-logs'
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { EventBridgeClient } from '@aws-sdk/client-eventbridge'
import { IAMClient } from '@aws-sdk/client-iam'
import { KMSClient } from '@aws-sdk/client-kms'
import { LambdaClient } from '@aws-sdk/client-lambda'
import { S3Client } from '@aws-sdk/client-s3'
import { SchedulerClient } from '@aws-sdk/client-scheduler'
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager'
import { SFNClient } from '@aws-sdk/client-sfn'
import { SNSClient } from '@aws-sdk/client-sns'
import { SQSClient } from '@aws-sdk/client-sqs'
import { SSMClient } from '@aws-sdk/client-ssm'
import { STSClient } from '@aws-sdk/client-sts'
import { NodeHttpHandler } from '@smithy/node-http-handler'
import type { EmuInfo } from './env'

export interface Creds { accessKeyId: string; secretAccessKey: string; sessionToken?: string }

/**
 * SDK clients for one emulator run. The cert is regenerated on every start, so the
 * CA is passed to a per-connection https.Agent. Nothing global is changed: TLS
 * verification stays on for every other connection in this process.
 */
export function makeClients(emu: EmuInfo, creds: Creds = emu) {
  const ca = readFileSync(emu.caPath)
  const base = () => ({
    endpoint: emu.endpoint,
    region: 'us-east-1',
    credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey, ...(creds.sessionToken ? { sessionToken: creds.sessionToken } : {}) },
    disableHostPrefix: true,
    maxAttempts: 2,
    requestHandler: new NodeHttpHandler({ httpsAgent: new https.Agent({ ca, keepAlive: false }), connectionTimeout: 3000, requestTimeout: 30000 }),
  })
  return {
    sts: new STSClient(base()),
    iam: new IAMClient(base()),
    s3: new S3Client({ ...base(), forcePathStyle: true }),
    ddb: new DynamoDBClient(base()),
    lambda: new LambdaClient(base()),
    sqs: new SQSClient(base()),
    sns: new SNSClient(base()),
    apigw: new ApiGatewayV2Client(base()),
    logs: new CloudWatchLogsClient(base()),
    kms: new KMSClient(base()),
    apigwRest: new APIGatewayClient(base()),
    sfn: new SFNClient(base()),
    events: new EventBridgeClient(base()),
    scheduler: new SchedulerClient(base()),
    cw: new CloudWatchClient(base()),
    cognito: new CognitoIdentityProviderClient(base()),
    secrets: new SecretsManagerClient(base()),
    ssm: new SSMClient(base()),
    destroy() {
      for (const c of [this.sts, this.iam, this.s3, this.ddb, this.lambda, this.sqs, this.sns, this.apigw, this.logs, this.kms, this.apigwRest, this.sfn, this.events, this.scheduler, this.cw, this.cognito, this.secrets, this.ssm]) c.destroy()
    },
  }
}
export type Clients = ReturnType<typeof makeClients>
