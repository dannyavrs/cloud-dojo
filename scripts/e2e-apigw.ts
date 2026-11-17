/** End-to-end solutions for the API Gateway track: replay the learner's real commands. */
import type { E2E, E2EScript } from './e2e-kit'

const must = (cond: unknown, msg: string) => { if (!cond) throw new Error(msg) }
const parse = (s: string) => { try { return JSON.parse(s) } catch { return {} } }

/** Probe-panel call (same code path as the UI), logged. */
const call = async (id: string, k: E2E, what: string, url: string, init: { method?: string; headers?: Record<string, string> } = {}) => {
  const r = await k.app.probeHttp(id, { url, ...init })
  k.log(`   ${what}: ${r.status} ${r.body.replace(/\s+/g, ' ').slice(0, 130)}`)
  return r
}

export const APIGW_E2E: Record<string, E2EScript> = {
  'apigw-routes-stages': async (id, k) => {
    const { sh, C, sub, json, sleep } = k
    const api = json(await sh(id, C(id, 'api')))
    const v = { API_ID: api.ApiId as string }
    const ep = api.ApiEndpoint as string
    await sh(id, sub(C(id, 'stage'), v))
    const int = json(await sh(id, sub(C(id, 'integration'), v)))
    const w = { ...v, INTEGRATION_ID: int.IntegrationId as string }
    await sh(id, sub(C(id, 'route'), w))
    await sh(id, sub(C(id, 'perm'), v))
    await sleep(1500)
    const ok = await call(id, k, 'GET /dev/notes/42', `${ep}/dev/notes/42`)
    must(ok.status === 200 && parse(ok.body).id === '42', 'dev call should be 200')
    const nostage = await call(id, k, 'GET /notes/42 (no stage)', `${ep}/notes/42`)
    must(nostage.status !== 200, 'no stage should not serve')
    await sh(id, sub(C(id, 'break'), v))
    const del = await call(id, k, 'DELETE /dev/notes/42', `${ep}/dev/notes/42`, { method: 'DELETE' })
    must(del.status === 404, 'unrouted DELETE should be 404')
    await sh(id, sub(C(id, 'default'), w))
    await sleep(2000)
    const del2 = await call(id, k, 'DELETE after $default', `${ep}/dev/notes/42`, { method: 'DELETE' })
    must(del2.status === 200 && parse(del2.body).route === '$default', '$default should catch DELETE')
    await sh(id, sub(C(id, 'prod'), v))
    await sleep(2000)
    const prod = await call(id, k, 'GET /prod/notes/7', `${ep}/prod/notes/7`)
    must(prod.status === 200 && parse(prod.body).sv?.env === 'prod', 'prod should answer')
  },
  'apigw-lambda-authorizer': async (id, k) => {
    const { sh, C, sub, json, sleep } = k
    const [apiId, ep] = (await sh(id, C(id, 'ids', 0))).stdout.trim().split(/\s+/)
    const routeId = (await sh(id, sub(C(id, 'ids', 1), { API_ID: apiId }))).stdout.trim().split(/\s+/).pop()!
    const url = `${ep}/notes`
    const open = await call(id, k, 'POST (open)', url, { method: 'POST' })
    must(open.status === 200, 'route should be open before the authorizer')
    const az = json(await sh(id, sub(C(id, 'authorizer'), { API_ID: apiId })))
    const v = { API_ID: apiId, AUTHORIZER_ID: az.AuthorizerId as string, ROUTE_ID: routeId }
    await sh(id, sub(C(id, 'perm'), v))
    await sh(id, sub(C(id, 'attach'), v))
    await sleep(2000)
    const none = await call(id, k, 'POST no header', url, { method: 'POST' })
    must(none.status === 401, 'no header should be 401')
    const nope = await call(id, k, 'POST nope', url, { method: 'POST', headers: { Authorization: 'nope' } })
    must(nope.status === 403, 'wrong header should be 403')
    const yes = await call(id, k, 'POST let-me-in', url, { method: 'POST', headers: { Authorization: 'let-me-in' } })
    must(yes.status === 200 && parse(yes.body).auth?.lambda?.user === 'danny', 'right header should be 200 with context')
    k.edit(id, 'authz.mjs', () => k.code(id, 'break'))
    await sh(id, C(id, 'break'))
    await sleep(3000)
    const bad = await call(id, k, 'POST fresh-1 (broken authorizer)', url, { method: 'POST', headers: { Authorization: 'fresh-1' } })
    must(bad.status === 500, 'broken authorizer should give 500')
    const cached = await call(id, k, 'POST let-me-in (cached)', url, { method: 'POST', headers: { Authorization: 'let-me-in' } })
    must(cached.status === 200, 'cached decision should still pass')
    k.edit(id, 'authz.mjs', () => k.code(id, 'fix'))
    await sh(id, C(id, 'fix'))
    await sleep(3000)
    const fixed = await call(id, k, 'POST fresh-2 (fixed authorizer)', url, { method: 'POST', headers: { Authorization: 'fresh-2' } })
    must(fixed.status === 403, 'fixed authorizer should deny a fresh wrong value with 403')
  },
  'apigw-jwt-cognito': async (id, k) => {
    const { sh, C, sub, json, sleep } = k
    const [apiId, ep] = (await sh(id, C(id, 'ids', 0))).stdout.trim().split(/\s+/)
    const routeId = (await sh(id, sub(C(id, 'ids', 1), { API_ID: apiId }))).stdout.trim().split(/\s+/).pop()!
    const url = `${ep}/notes`
    const poolId = (await sh(id, C(id, 'pool', 0))).stdout.trim()
    const clientId = (await sh(id, sub(C(id, 'pool', 1), { POOL_ID: poolId }))).stdout.trim()
    await sh(id, sub(C(id, 'user', 0), { POOL_ID: poolId })); await sh(id, sub(C(id, 'user', 1), { POOL_ID: poolId }))
    const token = (await sh(id, sub(C(id, 'token'), { CLIENT_ID: clientId }))).stdout.trim()
    const disco = await call(id, k, 'discovery document', `${k.app.emu.info!.endpoint}/${poolId}/.well-known/openid-configuration`)
    const issuer = parse(disco.body).issuer as string
    must(issuer?.endsWith(`/${poolId}`), 'issuer should end with the pool id')
    const v = { API_ID: apiId, ROUTE_ID: routeId, POOL_ID: poolId, CLIENT_ID: clientId, ISSUER: issuer }
    const az = json(await sh(id, sub(C(id, 'authorizer'), v)))
    const w = { ...v, AUTHORIZER_ID: az.AuthorizerId as string }
    await sh(id, sub(C(id, 'attach'), w))
    await sleep(2000)
    const bearer = { Authorization: `Bearer ${token}` }
    const none = await call(id, k, 'GET no token', url)
    must(none.status === 401, 'no token should be 401')
    const ok = await call(id, k, 'GET with ID token', url, { headers: bearer })
    must(ok.status === 200 && parse(ok.body).auth?.jwt?.claims?.['cognito:username'] === 'danny', 'ID token should be 200 with claims')
    await sh(id, sub(C(id, 'break'), w)); await sleep(1500)
    const bad = await call(id, k, 'GET wrong audience', url, { headers: bearer })
    must(bad.status === 401, 'wrong audience should be 401')
    await sh(id, sub(C(id, 'fix'), w)); await sleep(1500)
    const back = await call(id, k, 'GET after fix', url, { headers: bearer })
    must(back.status === 200, 'fixed audience should be 200')
    await sh(id, sub(C(id, 'scope', 0), w)); await sleep(2000)
    const idTok = await call(id, k, 'GET ID token, scope required', url, { headers: bearer })
    must(idTok.status === 403, 'ID token without scope should be 403')
    const access = (await sh(id, sub(C(id, 'scope', 1), w))).stdout.trim()
    const acc = await call(id, k, 'GET access token', url, { headers: { Authorization: `Bearer ${access}` } })
    must(acc.status === 200 && parse(acc.body).auth?.jwt?.scopes?.length, 'access token should be 200 with scopes')
  },
  'apigw-throttle-cors': async (id, k) => {
    const { sh, C, sub, sleep } = k
    const [apiId, ep] = (await sh(id, C(id, 'ids'))).stdout.trim().split(/\s+/)
    const v = { API_ID: apiId }
    const url = `${ep}/notes`
    const origin = 'http://localhost:5173'
    const pf = { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' } }
    const ok = await call(id, k, 'GET /notes', url)
    must(ok.status === 200, 'open GET should be 200')
    const before = await call(id, k, 'preflight before CORS', url, pf)
    must(!before.headers['access-control-allow-origin'], 'no CORS headers before configuration')
    await sh(id, sub(C(id, 'cors'), v)); await sleep(2000)
    const after = await call(id, k, 'preflight after CORS', url, pf)
    must(after.headers['access-control-allow-origin'] === origin && /GET/.test(after.headers['access-control-allow-methods']), 'preflight should carry allow headers')
    const evil = await call(id, k, 'preflight from evil origin', url, { method: 'OPTIONS', headers: { Origin: 'http://evil.example', 'Access-Control-Request-Method': 'GET' } })
    must(!evil.headers['access-control-allow-origin'], 'other origins get no allow-origin')
    const evilGet = await call(id, k, 'GET with evil Origin', url, { headers: { Origin: 'http://evil.example' } })
    must(evilGet.status === 200, 'the request itself is still served')
    await sh(id, sub(C(id, 'throttle'), v)); await sleep(2000)
    await sh(id, sub(C(id, 'burst'), v))
    // the burst is sent by the checker (Check button); a manual probe also works
    const mid = await k.app.checks(id, true)
    k.log('   Check (preflight + burst):', mid.filter((c) => ['preflight', 'burst', 'breakit'].includes(c.id)).map((c) => `${c.id}=${c.pass} ${c.detail ?? ''}`).join(' | '))
  },
  'apigw-rest-keys-usage': async (id, k) => {
    const { sh, C, sub, json, sleep } = k
    const api = json(await sh(id, C(id, 'api')))
    const v = { REST_ID: api.id as string, ROOT_ID: api.rootResourceId as string }
    await sh(id, sub(C(id, 'method'), v)); await sh(id, sub(C(id, 'integration'), v))
    await sh(id, sub(C(id, 'responses', 0), v)); await sh(id, sub(C(id, 'responses', 1), v))
    await sh(id, sub(C(id, 'deploy'), v))
    const url = `${k.app.emu.info!.endpoint}/_aws/execute-api/${v.REST_ID}/prod/`
    const key = 'dojo-demo-key-0123456789'
    const nokey = await call(id, k, 'GET no key', url)
    must(nokey.status === 403, 'no key should be 403')
    const created = json(await sh(id, C(id, 'key')))
    const early = await call(id, k, 'GET key not in a plan', url, { headers: { 'x-api-key': key } })
    must(early.status === 403, 'unattached key should be 403')
    const plan = json(await sh(id, sub(C(id, 'plan', 0), v)))
    const w = { ...v, PLAN_ID: plan.id as string, KEY_ID: created.id as string }
    await sh(id, sub(C(id, 'plan', 1), w))
    await sleep(1200)
    for (let i = 1; i <= 3; i++) {
      const r = await call(id, k, `GET with key #${i}`, url, { headers: { 'x-api-key': key } })
      must(r.status === 200 && parse(r.body).mock === true, `call ${i} should be 200`)
      await sleep(250)
    }
    const fourth = await call(id, k, 'GET with key #4', url, { headers: { 'x-api-key': key } })
    must(fourth.status === 429 && /Limit Exceeded/.test(fourth.body), 'fourth call should be 429 Limit Exceeded')
    await sh(id, sub(C(id, 'break'), w))
  },
}
