/** End-to-end solutions for the S3 track (modules 2.2 to 2.7): replay the learner's real commands. */
import type { E2EScript } from './e2e-kit'

const must = (cond: unknown, msg: string) => { if (!cond) throw new Error(msg) }

export const S3_E2E: Record<string, E2EScript> = {
  's3-presigned': async (id, k) => {
    const { sh, C, app, log, sleep } = k
    const probe = (url: string) => app.probeHttp(id, { url })
    await sh(id, C(id, 'look'))
    const url = (await sh(id, C(id, 'presign'))).stdout.trim()
    const ok = await probe(url)
    log('   presigned GET:', ok.status, ok.body.trim())
    must(ok.status === 200 && ok.body.includes('Q3 revenue'), 'presigned GET should be 200')
    const anon = await probe(url.split('?')[0])
    log('   unsigned:', anon.status)
    must(anon.status === 403, 'unsigned should be 403')
    await sh(id, C(id, 'other'))
    const tam = await probe(url.replace('report.txt', 'secret.txt'))
    log('   tampered key:', tam.status, tam.body.match(/<Code>(\w+)</)?.[1])
    must(tam.status === 403, 'tampered should be 403')
    const short = (await sh(id, C(id, 'expire'))).stdout.trim()
    await sleep(3000)
    const exp = await probe(short)
    log('   expired:', exp.status, exp.body.match(/<Message>([^<]+)</)?.[1])
    must(exp.status === 403, 'expired should be 403')
  },

  's3-multipart': async (id, k) => {
    const { sh, C, sub, log } = k
    const lines = (r: { stdout: string }) => r.stdout.trim().split('\n').filter(Boolean)
    const open = lines(await sh(id, C(id, 'audit')))
    log('   open uploads:', open.join(' | '))
    const abandonedId = open.find((l) => l.startsWith('abandoned.bin'))!.split(/\s+/)[1]
    const up = (await sh(id, C(id, 'start'))).stdout.trim()
    const v = { UPLOAD_ID: up }
    const e1 = (await sh(id, sub(C(id, 'parts', 0), v))).stdout.trim()
    const e2 = (await sh(id, sub(C(id, 'parts', 1), v))).stdout.trim()
    log('   parts:', (await sh(id, sub(C(id, 'list'), v))).stdout.trim().replace(/\s+/g, ' '))
    await sh(id, sub(C(id, 'complete', 0), { ...v, ETAG_1: e1, ETAG_2: e2 }))
    log('   object:', (await sh(id, C(id, 'complete', 1))).stdout.trim().replace(/\s+/g, ' '))
    const up2 = (await sh(id, C(id, 'break', 0))).stdout.trim()
    const t1 = (await sh(id, sub(C(id, 'break', 1), { UPLOAD_ID_2: up2 }))).stdout.trim()
    await sh(id, sub(C(id, 'break', 2), { UPLOAD_ID_2: up2 }))
    await sh(id, sub(C(id, 'break', 3), { UPLOAD_ID_2: up2, TINY_ETAG: t1 }), true)
    log('   open after the failure:', lines(await sh(id, C(id, 'abort', 0))).length)
    await sh(id, sub(C(id, 'abort', 1), { ABANDONED_ID: abandonedId }))
    await sh(id, sub(C(id, 'abort', 2), { UPLOAD_ID_2: up2 }))
    log('   open after aborts:', (await sh(id, C(id, 'abort', 0))).stdout.trim())
    await sh(id, C(id, 'rule', 0)); await sh(id, C(id, 'rule', 1))
  },

  's3-notifications': async (id, k) => {
    const { sh, C, edit, log, sleep } = k
    await sh(id, C(id, 'break'), true)
    edit(id, 'queue-policy.json', (t) => t.replaceAll('snap-intake', 'photo-intake'))
    await sh(id, C(id, 'policy', 0)); await sh(id, C(id, 'policy', 1))
    edit(id, 'notification.json', (t) => {
      const j = JSON.parse(t)
      j.QueueConfigurations[0].Filter = { Key: { FilterRules: [{ Name: 'prefix', Value: 'uploads/' }, { Name: 'suffix', Value: '.jpg' }] } }
      return JSON.stringify(j, null, 2)
    })
    await sh(id, C(id, 'filter', 0)); await sh(id, C(id, 'filter', 1))
    for (let i = 0; i < 4; i++) await sh(id, C(id, 'upload', i))
    await sleep(2000)
    const r = await sh(id, C(id, 'receive'))
    const keys = [...r.stdout.matchAll(/"key":"([^"]+)"/g)].map((m) => m[1])
    log('   queue holds keys:', keys.join(', '), '| test event:', r.stdout.includes('s3:TestEvent'))
    must(keys.length === 1 && keys[0] === 'uploads/cat.jpg', 'only uploads/cat.jpg should arrive')
  },

  's3-lifecycle': async (id, k) => {
    const { sh, C, edit, app, log } = k
    await sh(id, C(id, 'empty'), true)
    const before = (await app.checks(id, true)).find((c) => c.id === 'valid')
    log('   starter file problems:', before?.detail)
    await sh(id, C(id, 'bad', 0)); await sh(id, C(id, 'bad', 1))
    const mid = (await app.checks(id, true)).find((c) => c.id === 'breakit')
    log('   app verdict on the bad file:', mid?.detail)
    edit(id, 'lifecycle.json', (t) => {
      const j = JSON.parse(t)
      const logs = j.Rules.find((r: { ID: string }) => r.ID === 'logs')
      logs.Transitions = [{ Days: 30, StorageClass: 'STANDARD_IA' }, { Days: 90, StorageClass: 'GLACIER' }]
      logs.Expiration = { Days: 365 }
      const vers = j.Rules.find((r: { ID: string }) => r.ID === 'versions')
      vers.NoncurrentVersionTransitions = [{ NoncurrentDays: 30, StorageClass: 'STANDARD_IA' }]
      vers.NoncurrentVersionExpiration = { NoncurrentDays: 90 }
      j.Rules.push(JSON.parse('{"ID":"abort-mpu","Status":"Enabled","Filter":{},"AbortIncompleteMultipartUpload":{"DaysAfterInitiation":7}}'))
      return JSON.stringify(j, null, 2)
    })
    await sh(id, C(id, 'apply', 0)); await sh(id, C(id, 'apply', 1))
    await sh(id, C(id, 'class', 0)); await sh(id, C(id, 'class', 1)); await sh(id, C(id, 'class', 2), true)
  },

  's3-data-protection': async (id, k) => {
    const { sh, C, edit, sub, log } = k
    for (let i = 0; i < 3; i++) log('  ', (await sh(id, C(id, 'sse', i))).stdout.trim().replace(/\s+/g, ' ').slice(0, 160))
    edit(id, 'encryption.json', () => JSON.stringify({ Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'aws:kms', KMSMasterKeyID: 'alias/vault' }, BucketKeyEnabled: true }] }, null, 2))
    await sh(id, C(id, 'default', 0)); await sh(id, C(id, 'default', 1))
    log('   default applied:', (await sh(id, C(id, 'default', 2))).stdout.trim().replace(/\s+/g, ' ').slice(0, 160))
    await sh(id, C(id, 'bpa', 0)); await sh(id, C(id, 'bpa', 1))
    await sh(id, C(id, 'public'), true)
    await sh(id, C(id, 'lock', 0)); await sh(id, C(id, 'lock', 1))
    const vid = (await sh(id, C(id, 'lock', 2))).stdout.trim()
    await sh(id, C(id, 'lock', 3))
    await sh(id, sub(C(id, 'denied'), { VERSION_ID: vid }), true)
    await sh(id, sub(C(id, 'bypass'), { VERSION_ID: vid }))
  },

  's3-replication-conditional': async (id, k) => {
    const { sh, C, edit, sub, log, sleep } = k
    await sh(id, C(id, 'early'), true)
    await sh(id, C(id, 'versioning', 0)); await sh(id, C(id, 'versioning', 1))
    edit(id, 'replication.json', (t) => t.replaceAll('orders-dest', 'orders-dst'))
    await sh(id, C(id, 'config', 0)); await sh(id, C(id, 'config', 1))
    await sh(id, C(id, 'copy', 0)); await sh(id, C(id, 'copy', 1))
    await sleep(3000)
    log('   dst versions:', (await sh(id, C(id, 'copy', 2))).stdout.trim().replace(/\s+/g, ' '))
    log('   status:', (await sh(id, C(id, 'copy', 3))).stdout.trim())
    await sh(id, C(id, 'old'), true)
    await sh(id, C(id, 'once'))
    await sh(id, C(id, 'break'), true)
    const etag = (await sh(id, C(id, 'ifmatch', 0))).stdout.trim()
    await sh(id, sub(C(id, 'ifmatch', 1), { ETAG: etag }))
    await sh(id, sub(C(id, 'ifmatch', 2), { ETAG: etag }), true)
  },
}
