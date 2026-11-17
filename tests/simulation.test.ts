import { describe, expect, test } from 'bun:test'
import { parseSimulation } from '../src/lib/simulation'

const out = JSON.stringify({ EvaluationResults: [
  { EvalActionName: 's3:GetObject', EvalResourceName: 'arn:aws:s3:::b/k', EvalDecision: 'allowed', MatchedStatements: [{ SourcePolicyId: 'p' }] },
  { EvalActionName: 's3:DeleteObject', EvalResourceName: 'arn:aws:s3:::b/k', EvalDecision: 'explicitDeny', MatchedStatements: [] },
  { EvalActionName: 's3:PutObject', EvalDecision: 'implicitDeny', PermissionsBoundaryDecisionDetail: { AllowedByPermissionsBoundary: false }, MissingContextValues: ['aws:SourceIp'] },
] })

describe('policy simulator view', () => {
  test('parses simulate output into one row per action', () => {
    const rows = parseSimulation('aws iam simulate-principal-policy --policy-source-arn x --action-names a', out)!
    expect(rows.map((r: { decision: string }) => r.decision)).toEqual(['allowed', 'explicitDeny', 'implicitDeny'])
    expect(rows[2]).toMatchObject({ boundary: false, context: ['aws:SourceIp'], resource: '*' })
    expect(rows[0].matched).toBe(1)
  })
  test('leaves other commands, --query output and junk alone', () => {
    expect(parseSimulation('aws s3api list-buckets', out)).toBeNull()
    expect(parseSimulation('aws iam simulate-principal-policy --query "x"', out)).toBeNull()
    expect(parseSimulation('aws iam simulate-custom-policy', 'not json')).toBeNull()
    expect(parseSimulation('aws iam simulate-custom-policy', '{"a":1}')).toBeNull()
  })
})
