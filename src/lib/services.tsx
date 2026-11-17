import { Activity, Archive, Bell, CalendarClock, GitBranch, Lock, Users, Boxes, Database, Globe, Inbox, KeyRound, ShieldCheck, Terminal, Zap, type LucideIcon } from 'lucide-react'
import { lessonById } from '@shared/lessons'
import type { MapNode } from '@shared/types'

/** Flat tile colors follow the public AWS architecture *category* colors. Glyphs are original (lucide). */
export interface Service { name: string; color: string; Icon: LucideIcon }

export const SERVICE_BY_TRACK: Record<string, Service> = {
  foundations: { name: 'STS', color: '#d33a4c', Icon: KeyRound },
  iam: { name: 'IAM', color: '#d33a4c', Icon: ShieldCheck },
  s3: { name: 'S3', color: '#5f8f17', Icon: Archive },
  dynamodb: { name: 'DynamoDB', color: '#b43fc4', Icon: Database },
  lambda: { name: 'Lambda', color: '#e8700f', Icon: Zap },
  messaging: { name: 'SNS + SQS', color: '#d6246f', Icon: Bell },
  eventbridge: { name: 'EventBridge', color: '#d6246f', Icon: CalendarClock },
  stepfunctions: { name: 'Step Functions', color: '#d6246f', Icon: GitBranch },
  cloudwatch: { name: 'CloudWatch', color: '#d6246f', Icon: Activity },
  security: { name: 'KMS + Secrets', color: '#d33a4c', Icon: Lock },
  apigw: { name: 'API Gateway', color: '#7f4de8', Icon: Globe },
  capstone: { name: 'Capstone', color: '#3d6fb4', Icon: Boxes },
}
export const serviceForTrack = (trackId: string): Service => SERVICE_BY_TRACK[trackId] ?? { name: 'AWS', color: '#3d6fb4', Icon: Terminal }
/** The service tile of the track a module belongs to. */
export const serviceFor = (lessonId: string): Service => serviceForTrack(lessonById(lessonId)?.trackId ?? '')

export const SERVICE_BY_KIND: Record<MapNode['kind'], Service> = {
  bucket: { name: 'S3 bucket', color: '#5f8f17', Icon: Archive },
  table: { name: 'DynamoDB table', color: '#b43fc4', Icon: Database },
  queue: { name: 'SQS queue', color: '#d6246f', Icon: Inbox },
  topic: { name: 'SNS topic', color: '#d6246f', Icon: Bell },
  function: { name: 'Lambda function', color: '#e8700f', Icon: Zap },
  api: { name: 'API Gateway', color: '#7f4de8', Icon: Globe },
  role: { name: 'IAM role', color: '#d33a4c', Icon: ShieldCheck },
  statemachine: { name: 'State machine', color: '#d6246f', Icon: GitBranch },
  bus: { name: 'Event bus', color: '#d6246f', Icon: CalendarClock },
  alarm: { name: 'CloudWatch alarm', color: '#d6246f', Icon: Activity },
  key: { name: 'KMS key', color: '#d33a4c', Icon: Lock },
  secret: { name: 'Secret', color: '#d33a4c', Icon: Lock },
  pool: { name: 'Cognito pool', color: '#d33a4c', Icon: Users },
  user: { name: 'IAM user', color: '#d33a4c', Icon: KeyRound },
}

export function ServiceTile({ svc, size = 28 }: { svc: Service; size?: number }) {
  const { Icon } = svc
  return (
    <span className="tile" style={{ background: svc.color, width: size, height: size }} aria-hidden="true">
      <Icon size={Math.round(size * 0.58)} strokeWidth={2} />
    </span>
  )
}
