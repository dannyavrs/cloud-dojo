import { CreateBucketCommand, GetBucketLifecycleConfigurationCommand, PutBucketVersioningCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { item, ranOk, type LessonServer } from '../lesson-kit'

/* ---------- app-side validation of a lifecycle configuration against the documented AWS rules ---------- */

export interface Problem { kind: 'error' | 'cost'; rule: string; msg: string }

/** Waterfall order. A transition may only go to a class later in this list. */
const ORDER = ['STANDARD', 'STANDARD_IA', 'INTELLIGENT_TIERING', 'ONEZONE_IA', 'GLACIER_IR', 'GLACIER', 'DEEP_ARCHIVE']
/** Minimum storage duration in days (billed even if the object leaves earlier). */
const MIN_DAYS: Record<string, number> = { STANDARD_IA: 30, ONEZONE_IA: 30, GLACIER_IR: 90, GLACIER: 90, DEEP_ARCHIVE: 180 }
const NEEDS_30 = new Set(['STANDARD_IA', 'ONEZONE_IA'])
const LABEL: Record<string, string> = { STANDARD_IA: 'Standard-IA', ONEZONE_IA: 'One Zone-IA', GLACIER_IR: 'Glacier Instant Retrieval', GLACIER: 'Glacier Flexible Retrieval', DEEP_ARCHIVE: 'Deep Archive' }

type Rec = Record<string, any>

export function validateLifecycle(cfg: unknown): Problem[] {
  const out: Problem[] = []
  const err = (rule: string, msg: string) => out.push({ kind: 'error', rule, msg })
  const cost = (rule: string, msg: string) => out.push({ kind: 'cost', rule, msg })
  const rules = (cfg as Rec | undefined)?.Rules
  if (!Array.isArray(rules) || rules.length === 0) { err('(file)', 'The file needs a top-level "Rules" array with at least one rule.'); return out }
  if (rules.length > 1000) err('(file)', 'A bucket can have at most 1,000 lifecycle rules.')
  const ids = new Set<string>()
  rules.forEach((r: Rec, i: number) => {
    const id = typeof r?.ID === 'string' && r.ID ? r.ID : `#${i + 1}`
    if (id.length > 255) err(id, 'Rule ID is longer than 255 characters.')
    if (ids.has(id)) err(id, 'Rule IDs must be unique within the configuration.')
    ids.add(id)
    if (r.Status !== 'Enabled' && r.Status !== 'Disabled') err(id, 'Status must be "Enabled" or "Disabled".')
    if (r.Filter === undefined && r.Prefix === undefined) err(id, 'Add a "Filter" ({} applies the rule to every object).')
    const f: Rec = r.Filter ?? {}
    const transitions: Rec[] = r.Transitions ?? []
    const nct: Rec[] = r.NoncurrentVersionTransitions ?? []
    const hasAction = transitions.length || nct.length || r.Expiration || r.NoncurrentVersionExpiration || r.AbortIncompleteMultipartUpload
    if (!hasAction) err(id, 'A rule needs at least one action (Transitions, Expiration, NoncurrentVersion..., or AbortIncompleteMultipartUpload).')

    // --- current-version transitions
    let prevClass = 'STANDARD'
    let prevDays = -1
    let lastDays: number | undefined
    let lastClass: string | undefined
    for (const t of transitions) {
      const cls = String(t.StorageClass)
      if (!ORDER.includes(cls) || cls === 'STANDARD') { err(id, `"${cls}" is not a valid transition target.`); continue }
      if (t.Days === undefined && t.Date === undefined) { err(id, `Transition to ${cls} needs Days or Date.`); continue }
      if (t.Days !== undefined && (!Number.isInteger(t.Days) || t.Days < 0)) { err(id, `Transition Days must be a whole number of 0 or more (got ${t.Days}).`); continue }
      if (ORDER.indexOf(cls) <= ORDER.indexOf(prevClass)) err(id, `Transition to ${cls} comes after ${prevClass}: lifecycle can only move down the waterfall (Standard, Standard-IA, Intelligent-Tiering, One Zone-IA, Glacier Instant, Glacier Flexible, Deep Archive).`)
      if (t.Days !== undefined) {
        if (NEEDS_30.has(cls) && t.Days < 30) err(id, `Transition to ${LABEL[cls]} after ${t.Days} days: AWS requires 'Days' of 30 or more for ${LABEL[cls]} (objects must be at least 30 days old).`)
        if (t.Days <= prevDays) err(id, `Transition days must increase from one transition to the next (${cls} at ${t.Days} follows ${prevClass} at ${prevDays}).`)
        const m = MIN_DAYS[prevClass]
        if (prevDays >= 0 && m && t.Days - prevDays < m) cost(id, `Early-deletion charge: the object stays in ${LABEL[prevClass]} for only ${t.Days - prevDays} days before moving to ${LABEL[cls]}, but ${LABEL[prevClass]} bills a ${m}-day minimum.`)
        prevDays = t.Days
        lastDays = t.Days
        lastClass = cls
      }
      prevClass = cls
    }
    // --- expiration
    const ex: Rec | undefined = r.Expiration
    if (ex) {
      const kinds = ['Days', 'Date', 'ExpiredObjectDeleteMarker'].filter((k) => ex[k] !== undefined)
      if (kinds.length !== 1) err(id, 'Expiration must set exactly one of Days, Date or ExpiredObjectDeleteMarker.')
      if (ex.ExpiredObjectDeleteMarker !== undefined && (f.Tag || f.And?.Tags)) err(id, 'ExpiredObjectDeleteMarker cannot be used with a tag filter.')
      if (ex.Days !== undefined) {
        if (!Number.isInteger(ex.Days) || ex.Days < 1) err(id, `Expiration Days must be a whole number of 1 or more (got ${ex.Days}).`)
        else if (lastDays !== undefined && ex.Days <= lastDays) err(id, `'Days' in the Expiration action (${ex.Days}) must be greater than 'Days' in the Transition action (${lastDays}).`)
        else if (lastDays !== undefined && lastClass && MIN_DAYS[lastClass] && ex.Days - lastDays < MIN_DAYS[lastClass]) cost(id, `Early-deletion charge: expiring at day ${ex.Days} leaves the object only ${ex.Days - lastDays} days in ${LABEL[lastClass]}, which bills a ${MIN_DAYS[lastClass]}-day minimum. Expire at day ${lastDays + MIN_DAYS[lastClass]} or later.`)
      }
    }
    // --- noncurrent versions
    let nPrev = 'STANDARD'
    let nPrevDays = -1
    let nLastDays: number | undefined
    let nLastClass: string | undefined
    for (const t of nct) {
      const cls = String(t.StorageClass)
      if (!ORDER.includes(cls) || cls === 'STANDARD') { err(id, `"${cls}" is not a valid noncurrent transition target.`); continue }
      if (!Number.isInteger(t.NoncurrentDays) || t.NoncurrentDays < 0) { err(id, 'NoncurrentDays must be a whole number of 0 or more.'); continue }
      if (NEEDS_30.has(cls) && t.NoncurrentDays < 30) err(id, `Noncurrent transition to ${LABEL[cls]} after ${t.NoncurrentDays} days: AWS requires NoncurrentDays of 30 or more for ${LABEL[cls]}.`)
      if (ORDER.indexOf(cls) <= ORDER.indexOf(nPrev)) err(id, `Noncurrent transition to ${cls} comes after ${nPrev}: transitions only move down the waterfall.`)
      if (t.NoncurrentDays <= nPrevDays) err(id, 'NoncurrentDays must increase from one noncurrent transition to the next.')
      const m = MIN_DAYS[nPrev]
      if (nPrevDays >= 0 && m && t.NoncurrentDays - nPrevDays < m) cost(id, `Early-deletion charge: noncurrent versions stay in ${LABEL[nPrev]} only ${t.NoncurrentDays - nPrevDays} days (minimum ${m}).`)
      nPrev = cls; nPrevDays = t.NoncurrentDays; nLastDays = t.NoncurrentDays; nLastClass = cls
    }
    const nx: Rec | undefined = r.NoncurrentVersionExpiration
    if (nx) {
      if (!Number.isInteger(nx.NoncurrentDays) || nx.NoncurrentDays < 1) err(id, 'NoncurrentVersionExpiration needs NoncurrentDays of 1 or more.')
      else if (nLastDays !== undefined && nLastClass && nx.NoncurrentDays <= nLastDays) err(id, `NoncurrentDays in the expiration (${nx.NoncurrentDays}) must be greater than in the noncurrent transition (${nLastDays}).`)
      else if (nLastDays !== undefined && nLastClass && MIN_DAYS[nLastClass] && nx.NoncurrentDays - nLastDays < MIN_DAYS[nLastClass]) cost(id, `Early-deletion charge: noncurrent versions are deleted ${nx.NoncurrentDays - nLastDays} days after moving to ${LABEL[nLastClass]} (minimum ${MIN_DAYS[nLastClass]}).`)
    }
    // --- multipart abort
    const ab: Rec | undefined = r.AbortIncompleteMultipartUpload
    if (ab) {
      if (!Number.isInteger(ab.DaysAfterInitiation) || ab.DaysAfterInitiation < 1) err(id, 'AbortIncompleteMultipartUpload needs DaysAfterInitiation of 1 or more.')
      if (f.Tag || f.And?.Tags || f.ObjectSizeGreaterThan !== undefined || f.ObjectSizeLessThan !== undefined || f.And?.ObjectSizeGreaterThan !== undefined) err(id, 'AbortIncompleteMultipartUpload cannot be combined with a tag or object-size filter.')
    }
  })
  return out
}

export const lifecycleHas = (cfg: unknown, pick: (r: Rec) => boolean) => ((cfg as Rec)?.Rules ?? []).some((r: Rec) => r?.Status === 'Enabled' && pick(r))
const hasAbort = (cfg: unknown) => lifecycleHas(cfg, (r) => Number(r.AbortIncompleteMultipartUpload?.DaysAfterInitiation) >= 1)
const hasNoncurrentExp = (cfg: unknown) => lifecycleHas(cfg, (r) => Number(r.NoncurrentVersionExpiration?.NoncurrentDays) >= 1)

const STARTER = {
  Rules: [
    { ID: 'logs', Status: 'Enabled', Filter: { Prefix: 'logs/' }, Transitions: [{ Days: 10, StorageClass: 'STANDARD_IA' }, { Days: 60, StorageClass: 'GLACIER' }], Expiration: { Days: 70 } },
    { ID: 'versions', Status: 'Enabled', Filter: {}, NoncurrentVersionTransitions: [{ NoncurrentDays: 7, StorageClass: 'STANDARD_IA' }] },
  ],
}
const BAD = { Rules: [{ ID: 'logs', Status: 'Enabled', Filter: { Prefix: 'logs/' }, Transitions: [{ Days: 10, StorageClass: 'STANDARD_IA' }] }] }

const fmt = (ps: Problem[]) => ps.map((p) => `[${p.rule}] ${p.msg}`).join(' | ')

export const s3Lifecycle: LessonServer = {
  id: 's3-lifecycle',
  files: {
    'lifecycle.json': JSON.stringify(STARTER, null, 2),
    'bad-lifecycle.json': JSON.stringify(BAD, null, 2),
    'app.log': 'GET /health 200\nGET /notes 200\n',
  },
  async fixture(ctx) {
    await ctx.c.s3.send(new CreateBucketCommand({ Bucket: 'archive-lab' }))
    await ctx.c.s3.send(new PutBucketVersioningCommand({ Bucket: 'archive-lab', VersioningConfiguration: { Status: 'Enabled' } }))
    await ctx.c.s3.send(new PutObjectCommand({ Bucket: 'archive-lab', Key: 'logs/app.log', Body: 'GET /health 200\n' }))
  },
  async check(ctx) {
    const h = ctx.history
    let file: unknown
    let fileErr = ''
    try { file = JSON.parse(readFileSync(path.join(ctx.workdir, 'lifecycle.json'), 'utf8')) } catch (e) { fileErr = `lifecycle.json is not valid JSON (${e instanceof Error ? e.message : e})` }
    const problems = fileErr ? [{ kind: 'error' as const, rule: '(file)', msg: fileErr }] : validateLifecycle(file)
    const valid = problems.length === 0
    const stored = await ctx.c.s3.send(new GetBucketLifecycleConfigurationCommand({ Bucket: 'archive-lab' })).catch(() => undefined)
    const storedCfg = stored ? { Rules: stored.Rules } : undefined
    const idsOf = (c: unknown) => ((c as Rec | undefined)?.Rules ?? []).map((r: Rec) => r.ID).sort().join(',')
    const storedOk = Boolean(storedCfg) && valid && validateLifecycle(storedCfg).length === 0 && idsOf(storedCfg) === idsOf(file)
    const badApplied = ranOk(h, /put-bucket-lifecycle-configuration[\s\S]*bad-lifecycle\.json/)
    const badProblems = validateLifecycle(BAD)
    return [
      item('valid', 'lifecycle.json passes the AWS rule check with no problems', valid, 'Press Run checks and read the problems listed in the details, then edit lifecycle.json.', valid ? undefined : fmt(problems)),
      item('breakit', 'You applied the 10-day Standard-IA rule that only the emulator accepts', badApplied, 'Apply bad-lifecycle.json, then press Run checks to see what the app says.', badApplied ? `The emulator stored it, but AWS would refuse it: ${fmt(badProblems)}` : undefined),
      item('abort', 'lifecycle.json aborts incomplete multipart uploads', !fileErr && hasAbort(file), 'Add the abort-mpu rule with DaysAfterInitiation 7.'),
      item('noncurrent', 'lifecycle.json expires noncurrent versions', !fileErr && hasNoncurrentExp(file), 'Add NoncurrentVersionExpiration to the versions rule.'),
      item('stored', 'The emulator holds the same valid rules as lifecycle.json', storedOk, 'Apply lifecycle.json with put-bucket-lifecycle-configuration after it validates.', stored ? `emulator has: ${idsOf(storedCfg) || 'no rules'}` : 'no configuration stored yet'),
      item('class', 'You wrote an object into a colder storage class', ranOk(h, /s3api put-object[\s\S]*--storage-class\s+(GLACIER|GLACIER_IR|DEEP_ARCHIVE|STANDARD_IA|ONEZONE_IA)/), 'Run the put-object with --storage-class GLACIER.'),
    ]
  },
}
