/** Lambda sources shared by the API Gateway modules (content shows them, the server zips them). */

/** The backend behind every route: echoes what API Gateway handed it. */
export const NOTES_HANDLER = `export const handler = async (event) => ({
  statusCode: 200,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    route: event.routeKey,
    method: event.requestContext?.http?.method,
    stage: event.requestContext?.stage,
    path: event.rawPath,
    id: event.pathParameters?.id ?? null,
    sv: event.stageVariables ?? null,
    auth: event.requestContext?.authorizer ?? null,
  }),
});
`

/** A REQUEST authorizer using the HTTP API "simple response" format (payload format 2.0). */
export const AUTHZ_HANDLER = `export const handler = async (event) => {
  const token = event.headers?.authorization ?? "";
  return { isAuthorized: token === "let-me-in", context: { user: "danny" } };
};
`

/** The classic mistake: the IAM-policy response shape of a REST API authorizer. */
export const AUTHZ_BROKEN = `export const handler = async (event) => {
  const token = event.headers?.authorization ?? "";
  return {
    principalId: "danny",
    policyDocument: {
      Version: "2012-10-17",
      Statement: [{ Action: "execute-api:Invoke", Effect: token === "let-me-in" ? "Allow" : "Deny", Resource: event.routeArn }],
    },
  };
};
`

export const ACCOUNT_ID = '000000000000'
export const FN_ARN = (name: string) => `arn:aws:lambda:us-east-1:${ACCOUNT_ID}:function:${name}`
export const ROLE_ARN = `arn:aws:iam::${ACCOUNT_ID}:role/lambda-exec`
