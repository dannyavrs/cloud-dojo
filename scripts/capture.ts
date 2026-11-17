/**
 * Records the validation artifacts with Playwright against a running app (server and capture share CLOUD_DOJO_DATA_DIR/EMULATOR_* env):
 *   bun run capture   (builds, starts the server on a temp data dir, runs this file, cleans up)
 * Writes docs/*.png and docs/walkthrough.mp4 (needs ffmpeg). Stale screenshots are removed first.
 */
import './guard-data-dir'
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { chromium, type Page } from 'playwright'
import { lessonById } from '../shared/lessons'
import { M2_E2E } from './e2e-m2'
import { M3_E2E } from './e2e-m3'
import { capturePrelude, seedModule } from './capture-seed'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4747'
const DOCS = path.resolve(import.meta.dirname, '../docs')
const RAW = path.join(DOCS, 'raw')
await capturePrelude()
for (const f of readdirSync(DOCS)) if (f.endsWith('.png') || f.endsWith('.mp4') || f.endsWith('.webm')) rmSync(path.join(DOCS, f))
rmSync(RAW, { recursive: true, force: true })
mkdirSync(RAW, { recursive: true })
const shot = (p: Page, name: string) => p.screenshot({ path: path.join(DOCS, name) })

const C = (id: string, step: string, i = 0) => lessonById(id)!.steps.find((s) => s.id === step)!.commands![i]
const sub = (cmd: string, vars: Record<string, string>) => Object.entries(vars).reduce((c, [k, v]) => c.replaceAll(`<${k}>`, v), cmd)

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: RAW, size: { width: 1440, height: 900 } } })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('PAGEERR', e.message))

const pause = (ms: number) => page.waitForTimeout(ms)
async function cmd(p: Page, c: string, wait = 1500) {
  await p.fill('.termin input', '')
  await p.type('.termin input', c, { delay: 4 })
  await p.waitForTimeout(200)
  await p.press('.termin input', 'Enter')
  await p.waitForFunction(() => !document.querySelector('.termout')?.textContent?.endsWith('running…'), null, { timeout: 90000 })
  await p.waitForTimeout(wait)
}
const lastOutput = async (p: Page) => (await p.textContent('.termout')) ?? ''
async function openModule(p: Page, id: string) {
  await p.goto(`${BASE}/#/lesson/${id}`)
  await p.waitForSelector('text=Environment ready', { timeout: 180000 })
  await p.waitForTimeout(2600)
  await p.waitForSelector('text=Environment ready', { timeout: 60000 })
}
async function allGreen(p: Page, ms = 90000) {
  const n = lessonById(await p.evaluate(() => location.hash.split('/')[2]))!.checks.length
  await p.waitForFunction((t) => document.querySelectorAll('.checks li .status.pass').length === t, n, { timeout: ms })
}
/** Answer every predict question correctly (or wrongly for the ones in `wrong`) and lock them in. */
async function predict(p: Page, id: string, wrong: number[] = []) {
  const qs = lessonById(id)!.predict
  for (let i = 0; i < qs.length; i++) {
    const pick = wrong.includes(i) ? (qs[i].answer + 1) % qs[i].options.length : qs[i].answer
    const fs = p.locator('.predict fieldset').nth(i)
    await fs.locator('.opt').nth(pick).click()
    await p.waitForTimeout(250)
    await p.locator('.predict .qact button').first().click()
    await p.waitForTimeout(700)
  }
}
const scrollManual = (p: Page, sel: string) => p.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: 'start' }), sel)

// 1. About: the explainer is the first thing a visitor sees
await page.goto(`${BASE}/#/about`)
await pause(2400)
await shot(page, '01-about.png')
await page.mouse.move(800, 450); await page.mouse.wheel(0, 1500); await pause(1600)
await shot(page, '02-about-compare.png')
await page.mouse.wheel(0, 1400); await pause(1200)
await page.evaluate(() => [...document.querySelectorAll('h2')].find((h) => h.textContent?.startsWith('What the emulator enforces'))?.scrollIntoView({ block: 'start' }))
await pause(1800)
await shot(page, '03-honesty-capabilities.png')
await page.evaluate(() => document.querySelector('#emulator-gaps')?.scrollIntoView({ block: 'start' }))
await pause(1600)
await shot(page, '25-emulator-gaps.png')

// 2. Track grid
await page.goto(`${BASE}/#/`)
await pause(900)
await page.evaluate(() => document.querySelector('.main')?.scrollTo({ top: 0 }))
await pause(1200)
await shot(page, '04-track-grid.png')

const stdoutOf = (p: Page) => p.evaluate(() => { const runs = document.querySelectorAll('.termout .run'); return runs[runs.length - 1]?.querySelector('pre:not(.err):not(.rej)')?.textContent?.trim() ?? '' })
const kv = (c: string, vars: Record<string, string>) => sub(c, vars)
const bench = (p: Page) => p.evaluate(() => document.querySelector('.bench')?.scrollTo({ top: 0 }))

// 3. IAM 1.2 policy evaluation: predict, a real AccessDenied, the simulator table, green checker
{
  const id = 'iam-evaluation'
  await openModule(page, id)
  await scrollManual(page, '.predict'); await pause(700)
  await predict(page, id, [0])
  await scrollManual(page, '.predict'); await pause(900)
  await shot(page, '05-iam-predict.png')
  await scrollManual(page, '.steps'); await pause(600)
  await cmd(page, C(id, 'allow'))
  await cmd(page, C(id, 'key'), 900)
  const [KEY_ID, SECRET] = (await stdoutOf(page)).split(/\s+/)
  const as = { KEY_ID, SECRET }
  await cmd(page, kv(C(id, 'before'), as))
  await cmd(page, C(id, 'deny'), 1500)
  await cmd(page, kv(C(id, 'break'), as), 2400)
  await cmd(page, kv(C(id, 'read'), as))
  await cmd(page, C(id, 'sim', 0), 1200)
  await cmd(page, C(id, 'sim', 1), 1800)
  await allGreen(page, 40000)
  await pause(1500)
  await shot(page, '06-iam-policy-evaluation-green.png')
}

// 4. Simulated badge: IAM 1.6 permission boundaries
{
  const id = 'iam-boundaries'
  await openModule(page, id)
  await page.evaluate(() => document.querySelector('.manual')?.scrollTo({ top: 0 })); await pause(900)
  await shot(page, '07-simulated-boundaries-badge.png')
  await scrollManual(page, '.steps'); await pause(500)
  for (const s of ['devpol', 'policy', 'attach']) await cmd(page, C(id, s), 1000)
  await pause(1200)
  await cmd(page, C(id, 'sim', 0), 1200)
  await cmd(page, C(id, 'sim', 1), 2200)
  await shot(page, '08-simulated-boundaries-simulator.png')
}

// 7. S3 2.2 presigned URL opened in the HTTP probe, then the tampered copy
{
  const id = 's3-presigned'
  await openModule(page, id)
  await scrollManual(page, '.steps'); await pause(500)
  await cmd(page, C(id, 'look'), 900)
  await cmd(page, C(id, 'presign'), 1000)
  const url = (await stdoutOf(page)).split('\n')[0]
  await page.fill('#probe-url', url); await page.click('.probe button:has-text("Send")'); await pause(1800); await page.locator('.probe-res').scrollIntoViewIfNeeded(); await pause(500)
  await shot(page, '09-s3-presigned-probe-200.png')
  await page.fill('#probe-url', url.replace('report.txt', 'secret.txt')); await page.click('.probe button:has-text("Send")'); await pause(1800); await page.locator('.probe-res').scrollIntoViewIfNeeded(); await pause(500)
  await shot(page, '10-s3-presigned-tampered-403.png')
}


// 5. M3 modules: the learner's real commands are replayed through the server API (same runner, same checker),
//    then the module page is opened and Run checks pressed so the screenshot shows the real green state.
async function greenModule(id: string, file: string, opts: { scroll?: string; after?: () => Promise<void> } = {}) {
  await openModule(page, id)
  await seedModule(id, { ...M2_E2E, ...M3_E2E })
  await page.click('button:has-text("Run checks")')
  await allGreen(page, 120000).catch(() => undefined)
  await pause(1200)
  if (opts.after) await opts.after()
  if (opts.scroll) { await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: 'start' }), opts.scroll); await pause(700) }
  await shot(page, file)
}
await greenModule('sfn-retry', '11-stepfunctions-retry-green.png')
await greenModule('apigw-jwt-cognito', '12-apigw-jwt-authorizer-green.png', { scroll: '.probe' })
await greenModule('eb-targets-sfn', '13-eventbridge-targets-green.png')
await greenModule('cw-alarms-sns', '14-cloudwatch-alarm-green.png')
await greenModule('cw-dashboards', '15-cloudwatch-mini-dashboard.png')
await greenModule('kms-policies-grants', '16-kms-green.png')

// 6. Capstone v2: "Show me" builds it, then the Well-Architected review
{
  const id = 'capstone'
  await openModule(page, id)
  for (let i = 0; i < 8; i++) {
    const r = await fetch(`${BASE}/api/lessons/capstone/showme`, { method: 'POST' }).then((x) => x.json()) as { done: boolean }
    if (r.done) break
  }
  await pause(3000)
  await page.click('button:has-text("Run checks")')
  await page.waitForFunction(() => !document.querySelector('.checks')?.textContent?.includes('Checking'), null, { timeout: 120000 }).catch(() => undefined)
  await pause(2500)
  const first = page.locator('.checks details, .checks .pillar button, .checks li button').first()
  if (await first.count()) await first.click().catch(() => undefined)
  await pause(1200)
  await shot(page, '17-capstone-v2-review.png')
}

// 7. Exam mode: a mixed timed exam, then the per-domain readiness view and the review of wrong answers
await page.goto(`${BASE}/#/exam-mode`)
await pause(1500)
await page.locator('.seg2 label', { hasText: /^20 questions$/ }).first().click().catch(() => undefined)
await pause(500)
await shot(page, '18-exam-mode-picker.png')
await page.locator('button:has-text("question exam")').click()
await pause(1200)
for (let i = 0; i < 40; i++) {
  const opts = page.locator('.runq .opt')
  if (!(await opts.count())) break
  await opts.nth(i % 3 === 0 ? 0 : 1).click()
  await page.waitForTimeout(120)
  const next = page.locator('button:has-text("Next")')
  if (await next.isDisabled()) break
  await next.click()
  await page.waitForTimeout(120)
}
await page.click('button:has-text("Submit exam")')
await pause(1200)
const confirm = page.locator('button:has-text("Submit anyway"), button:has-text("Submit with")')
if (await confirm.count()) await confirm.first().click()
await pause(2200)
await shot(page, '19-exam-mode-readiness.png')
await page.evaluate(() => document.querySelector('.main')?.scrollBy({ top: 700 })); await pause(1200)
await shot(page, '20-exam-mode-review.png')

// 8. The grid again, now with progress, readiness and "Continue where you left off"
await page.goto(`${BASE}/#/`); await pause(1500)
await page.evaluate(() => document.querySelector('.main')?.scrollTo({ top: 0 })); await pause(1200)
await shot(page, '21-track-grid-progress.png')
await ctx.close()

// stills in a separate context (no video): BYOK settings (no key), light theme, narrow widths
const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const p2 = await c2.newPage()
await p2.goto(`${BASE}/#/`); await p2.waitForTimeout(1200)
await p2.click('button[aria-label="Tutor settings"]'); await p2.waitForTimeout(800)
await p2.getByText('OpenRouter', { exact: false }).first().click().catch(() => undefined)
await p2.waitForTimeout(500)
await shot(p2, '22-byok-settings.png')
await p2.keyboard.press('Escape'); await p2.waitForTimeout(300)
await p2.click('button[aria-label="Switch to light theme"]'); await p2.waitForTimeout(700)
await shot(p2, '23-light-theme.png')
await p2.click('button[aria-label="Switch to dark theme"]'); await p2.waitForTimeout(400)
await p2.setViewportSize({ width: 420, height: 860 }); await p2.waitForTimeout(700)
await shot(p2, '24-narrow-tracks.png')
// 420px: the exam picker sits inside the page and the side nav opens above it
await p2.goto(`${BASE}/#/exam-mode`); await p2.waitForTimeout(1200)
await shot(p2, '26-narrow-420-exam-picker.png')
await p2.click('button[aria-label="Tracks menu"]'); await p2.waitForTimeout(600)
await shot(p2, '27-narrow-420-nav-open.png')
const covered = await p2.evaluate(() => { let n = 0; for (let y = 100; y < 800; y += 20) for (let x = 10; x < 270; x += 30) { const el = document.elementFromPoint(x, y); if (el && !el.closest('.sidenav')) n++ } return n })
if (covered) throw new Error(`420px: ${covered} points of the side nav are covered by the page`)
await p2.keyboard.press('Escape'); await p2.click('.scrim').catch(() => undefined)
await p2.setViewportSize({ width: 1440, height: 900 }); await p2.goto(`${BASE}/#/`); await p2.waitForTimeout(800)
await p2.click('.sitefoot summary'); await p2.waitForTimeout(500)
await shot(p2, '28-footer-disclaimer.png')
await browser.close()

const webm = readdirSync(RAW).find((f) => f.endsWith('.webm'))!
renameSync(path.join(RAW, webm), path.join(DOCS, 'walkthrough.webm'))
const ff = Bun.spawnSync(['ffmpeg', '-y', '-i', path.join(DOCS, 'walkthrough.webm'), '-c:v', 'libx264', '-crf', '30', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', path.join(DOCS, 'walkthrough.mp4')])
console.log('ffmpeg exit', ff.exitCode)
rmSync(path.join(DOCS, 'walkthrough.webm'), { force: true })
rmSync(RAW, { recursive: true, force: true })
console.log('done')
void lastOutput; void bench
