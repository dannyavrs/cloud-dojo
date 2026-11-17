export interface Row { action: string; resource: string; decision: string; matched: number; boundary?: boolean; context: string[] }

/** Parse the JSON printed by simulate-principal-policy / simulate-custom-policy. Null when it is not that shape. */
export function parseSimulation(command: string, stdout: string): Row[] | null {
  if (!/iam simulate-(principal|custom)-policy/.test(command) || /--query/.test(command)) return null
  try {
    const j = JSON.parse(stdout)
    if (!Array.isArray(j.EvaluationResults)) return null
    return j.EvaluationResults.map((r: Record<string, any>) => ({
      action: String(r.EvalActionName ?? ''),
      resource: String(r.EvalResourceName ?? '*'),
      decision: String(r.EvalDecision ?? ''),
      matched: Array.isArray(r.MatchedStatements) ? r.MatchedStatements.length : 0,
      boundary: r.PermissionsBoundaryDecisionDetail?.AllowedByPermissionsBoundary,
      context: Array.isArray(r.MissingContextValues) ? r.MissingContextValues.map(String) : [],
    }))
  } catch { return null }
}

