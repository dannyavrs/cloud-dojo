import { CreateBucketCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { item, type LessonServer } from '../lesson-kit'

const sigOf = (u: string) => u.match(/X-Amz-Signature=([0-9a-f]+)/i)?.[1]
const pathOf = (u: string) => { try { return new URL(u).pathname } catch { return '' } }
const expiresOf = (u: string) => Number(u.match(/X-Amz-Expires=(\d+)/i)?.[1] ?? NaN)

export const s3Presigned: LessonServer = {
  id: 's3-presigned',
  async fixture(ctx) {
    await ctx.c.s3.send(new CreateBucketCommand({ Bucket: 'share-lab' }))
    await ctx.c.s3.send(new PutObjectCommand({ Bucket: 'share-lab', Key: 'report.txt', Body: 'Q3 revenue: 42 (internal)\n' }))
    await ctx.c.s3.send(new PutObjectCommand({ Bucket: 'share-lab', Key: 'secret.txt', Body: 'top secret launch date\n' }))
  },
  async check(ctx) {
    const h = ctx.history
    const probes = ctx.probes
    // signatures the learner really produced for report.txt (so a "tampered" probe must start from one of them)
    const reportSigs = new Set(h.filter((r) => r.exitCode === 0 && /s3 presign s3:\/\/share-lab\/report\.txt/.test(r.command)).map((r) => sigOf(r.stdout)).filter(Boolean) as string[])
    const signed = probes.filter((p) => p.method === 'GET' && Boolean(sigOf(p.url)))
    const get = signed.some((p) => p.status === 200 && pathOf(p.url) === '/share-lab/report.txt' && p.body.includes('Q3 revenue'))
    const anon = probes.some((p) => p.method === 'GET' && !sigOf(p.url) && pathOf(p.url) === '/share-lab/report.txt' && p.status === 403)
    const tamper = signed.some((p) => p.status === 403 && pathOf(p.url) === '/share-lab/secret.txt' && reportSigs.has(sigOf(p.url)!))
    const expired = signed.some((p) => p.status === 403 && expiresOf(p.url) <= 2 && /expired/i.test(p.body))
    return [
      item('url', 'You created a presigned URL for report.txt', reportSigs.size > 0, 'Run `aws s3 presign s3://share-lab/report.txt --expires-in 300`.'),
      item('get', 'The probe fetched report.txt with a presigned URL and got 200', get, 'Paste the URL into the HTTP probe panel (GET) and send it before it expires.'),
      item('anon', 'The unsigned URL was refused with 403', anon, 'Send the report.txt URL with the whole query string removed.'),
      item('tamper', 'A URL with the key changed to secret.txt was refused with 403', tamper, 'Edit a still-valid report.txt URL: replace report.txt with secret.txt in the path only.'),
      item('breakit', 'A 1-second URL was refused with 403 after it expired', expired, 'Presign with --expires-in 1, wait three seconds, then send it from the probe panel.'),
    ]
  },
}
