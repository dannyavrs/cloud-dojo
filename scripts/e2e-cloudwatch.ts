/** End-to-end solutions for the CloudWatch track: replay the learner's real commands. */
import type { E2EScript } from './e2e-kit'
import { dashboardView } from '../server/dashboard-api'

export const CW_E2E: Record<string, E2EScript> = {
  'cw-metrics': async (id, k) => {
    const { sh, C, log } = k
    await sh(id, C(id, 'put'))
    log('   Errors:', (await sh(id, C(id, 'read'))).stdout.replace(/\s+/g, ' ').slice(0, 200))
    await sh(id, C(id, 'batch', 0))
    await sh(id, C(id, 'batch', 1))
    log('   percentiles:', (await sh(id, C(id, 'batch', 2))).stdout.replace(/\s+/g, ' ').slice(0, 200))
    await sh(id, C(id, 'dims', 0))
    log('   metrics:', k.json(await sh(id, C(id, 'dims', 1))).Metrics.length)
    await sh(id, C(id, 'dims', 2))
    log('   math:', (await sh(id, C(id, 'math'))).stdout.replace(/\s+/g, ' ').slice(0, 260))
    log('   empty:', (await sh(id, C(id, 'break'))).stdout.replace(/\s+/g, ' '))
    await sh(id, C(id, 'limits', 0), true)
    await sh(id, C(id, 'limits', 1), true)
  },

  'cw-alarms-sns': async (id, k) => {
    const { sh, C, log, sleep } = k
    await sh(id, C(id, 'look', 0)); await sh(id, C(id, 'look', 1))
    await sh(id, C(id, 'alarm', 0))
    await sleep(12000)
    log('   idle alarm:', (await sh(id, C(id, 'alarm', 1))).stdout.replace(/\s+/g, ' ').slice(0, 160))
    await sh(id, C(id, 'subscribe'))
    await sh(id, C(id, 'fire', 0))
    const t0 = Date.now()
    let state = ''
    while (Date.now() - t0 < 60000) {
      state = (await sh(id, C(id, 'fire', 1))).stdout
      if (state.includes('ALARM')) break
      await sleep(2000)
    }
    log(`   alarm tripped after ${((Date.now() - t0) / 1000).toFixed(1)} s:`, state.replace(/\s+/g, ' ').slice(0, 200))
    await sh(id, C(id, 'fire', 2))
    const empty = await sh(id, C(id, 'break', 0))
    log('   inbox before the fix:', JSON.stringify(empty.stdout.trim()))
    log('   action history:', (await sh(id, C(id, 'break', 1))).stdout.replace(/\s+/g, ' ').slice(0, 160))
    for (let i = 0; i < 3; i++) await sh(id, C(id, 'policy', i))
    await sleep(1000)
    const mail = await sh(id, C(id, 'receive'))
    log('   inbox after the fix:', mail.stdout.replace(/\s+/g, ' ').slice(0, 220))
    for (let i = 0; i < 3; i++) await sh(id, C(id, 'missing', i))
    await sleep(15000)
    log('   missing data:', (await sh(id, C(id, 'missing', 3))).stdout.replace(/\s+/g, ' '))
  },

  'cw-logs-insights': async (id, k) => {
    const { sh, C, log, sleep, sub, json } = k
    await sh(id, C(id, 'look', 0))
    log('   old errors:', (await sh(id, C(id, 'look', 1))).stdout.replace(/\s+/g, ' '))
    await sh(id, C(id, 'retention', 0)); await sh(id, C(id, 'retention', 1))
    await sh(id, C(id, 'test'))
    log('   wrong case:', (await sh(id, C(id, 'break'))).stdout.replace(/\s+/g, ' '))
    await sh(id, C(id, 'filter', 0))
    log('   before new events:', (await sh(id, C(id, 'filter', 1))).stdout.replace(/\s+/g, ' '))
    await sh(id, C(id, 'emit', 0))
    let out = ''
    for (let i = 0; i < 20; i++) { await sleep(1500); out = (await sh(id, C(id, 'emit', 1))).stdout; if (out.includes('"Sum"')) break }
    log('   after new events:', out.replace(/\s+/g, ' ').slice(0, 200))
    for (const step of ['insights', 'stats']) {
      const qid = json(await sh(id, C(id, step, 0))).queryId as string
      let res = ''
      for (let i = 0; i < 20; i++) { await sleep(1000); res = (await sh(id, sub(C(id, step, 1), { QUERY_ID: qid }))).stdout; if (res.includes('"Complete"')) break }
      log(`   ${step}:`, res.replace(/\s+/g, ' ').slice(0, 260))
    }
  },

  'cw-dashboards': async (id, k) => {
    const { sh, C, log, edit, code, read } = k
    await sh(id, C(id, 'look', 0)); await sh(id, C(id, 'look', 1))
    await sh(id, C(id, 'break'), true)
    edit(id, 'dashboard.json', (t) => {
      const d = JSON.parse(t)
      for (const w of d.widgets) if (w.type === 'metric') w.properties.region = 'us-east-1'
      return JSON.stringify(d, null, 2)
    })
    await sh(id, C(id, 'fix'))
    const v1 = await dashboardView(k.app.c, 'checkout')
    log('   drawn after fix:', v1.widgets.map((w) => w.kind).join(', '))
    await sh(id, C(id, 'get', 0)); await sh(id, C(id, 'get', 1))
    edit(id, 'dashboard.json', () => code(id, 'extend'))
    await sh(id, C(id, 'extend'))
    const v2 = await dashboardView(k.app.c, 'checkout')
    for (const w of v2.widgets) {
      if (w.kind === 'metric') log(`   ${w.title}: ${w.series.map((s) => `${s.label}[${s.points.length}]`).join(' ')}${w.error ? ' ERROR ' + w.error : ''}`)
      if (w.kind === 'alarm') log(`   ${w.title}: ${w.alarms.map((a) => `${a.name}=${a.state}`).join(' ')}`)
    }
    log('   file kept:', read(id, 'dashboard.json').length, 'bytes')
  },
}
