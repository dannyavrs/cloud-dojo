import { NOTES_HANDLER } from '../../shared/lessons/apigw-sources'
import { item, type LessonServer } from '../lesson-kit'
import { findApi, NOTES_ZIP, probesAt, seedHttpApi, seedNotesFn, stagesOf } from './apigw-kit'

const ORIGIN = 'http://localhost:5173'

export const apigwThrottleCors: LessonServer = {
  id: 'apigw-throttle-cors',
  files: { 'handler.mjs': NOTES_HANDLER },
  zips: NOTES_ZIP,
  async fixture(ctx) {
    await seedNotesFn(ctx)
    await seedHttpApi(ctx, ['GET /notes'])
  },
  async check(ctx, { probe }) {
    const api = await findApi(ctx)
    const base = api?.ApiEndpoint
    const cors = api?.CorsConfiguration
    const corsOk = Boolean(cors?.AllowOrigins?.includes(ORIGIN) && cors.AllowMethods?.includes('GET') && cors.AllowMethods.includes('POST'))
    const stage = (await stagesOf(ctx, api?.ApiId)).find((s) => s.StageName === '$default')
    const limits = stage?.DefaultRouteSettings
    const throttled = limits?.ThrottlingRateLimit === 1 && limits.ThrottlingBurstLimit === 1
    const gets = probesAt(ctx, base ? `${base}/notes` : undefined, 'GET')
    const call = gets.some((p) => p.status === 200)

    let preflight: boolean | null = null
    let pfDetail = 'press Check'
    let burst: boolean | null = null
    let burstDetail = 'press Check'
    if (probe && base) {
      if (throttled) await Bun.sleep(1100) // let the bucket refill so the preflight is not the throttled call
      preflight = false
      pfDetail = 'no CORS configured yet'
      if (corsOk) {
        const r = await ctx.httpGet(`${base}/notes`, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'GET' } }).catch(() => undefined)
        const allowMethods = r?.headers['access-control-allow-methods'] ?? ''
        preflight = r?.headers['access-control-allow-origin'] === ORIGIN && /GET/.test(allowMethods)
        pfDetail = r ? `${r.status}, allow-origin ${r.headers['access-control-allow-origin'] ?? '(none)'}, allow-methods ${allowMethods || '(none)'}` : 'no answer'
      }
      burst = false
      burstDetail = 'no stage limit yet'
      if (throttled) {
        await Bun.sleep(1100)
        const codes = await Promise.all(Array.from({ length: 12 }, () => ctx.httpGet(`${base}/notes`).then((r) => r.status, () => 0)))
        const n200 = codes.filter((c) => c === 200).length
        const n429 = codes.filter((c) => c === 429).length
        burst = n200 >= 1 && n429 >= 1
        burstDetail = `12 calls: ${n200} x 200, ${n429} x 429`
        // the burst is real probe traffic: record the throttle so the break-it check sees it
        if (n429 && !ctx.probes.some((p) => p.status === 429)) ctx.probes.push({ url: `${base}/notes`, method: 'GET', status: 429, body: '{"message":"Too Many Requests"}', at: Date.now() })
      }
    }
    const saw429 = gets.some((p) => p.status === 429) || ctx.probes.some((p) => p.status === 429 && base && p.url.startsWith(base))
    return [
      item('call', 'GET /notes returned 200 from the probe', call, 'Send GET <ApiEndpoint>/notes from the HTTP probe (before the limit, or after waiting a second).'),
      item('cors-config', 'The API allows http://localhost:5173 for GET and POST', corsOk, 'Run update-api with --cors-configuration.', cors ? `origins ${cors.AllowOrigins?.join(',')}, methods ${cors.AllowMethods?.join(',')}` : 'no CORS configuration'),
      item('preflight', 'A preflight from that origin gets the allow-origin and allow-methods headers', preflight, 'Press Check after configuring CORS; it sends the preflight.', pfDetail),
      item('throttle', 'The `$default` stage limits to 1 request per second (burst 1)', throttled, 'Run update-stage with --default-route-settings ThrottlingBurstLimit=1,ThrottlingRateLimit=1.', limits ? `rate ${limits.ThrottlingRateLimit ?? '-'}, burst ${limits.ThrottlingBurstLimit ?? '-'}` : 'no limits set'),
      item('burst', 'Twelve simultaneous calls: some 200, the rest 429', burst, 'Press Check after setting the limit; it sends the burst.', burstDetail),
      item('breakit', 'You saw a 429 from the throttled stage', saw429, 'Press Check (it sends the burst) or press Send twice within a second in the probe.'),
    ]
  },
}
