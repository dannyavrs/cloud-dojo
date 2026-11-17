import { CreateBucketCommand, CreateMultipartUploadCommand, GetBucketLifecycleConfigurationCommand, HeadObjectCommand, ListMultipartUploadsCommand, UploadPartCommand } from '@aws-sdk/client-s3'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { item, ranFail, ranOk, type LessonServer } from '../lesson-kit'

const BUCKET = 'big-uploads'
const MiB = 1024 * 1024

/** Deterministic non-text bytes so the files are clearly binary. */
const bytes = (n: number) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * 31 + (i >> 8)) & 0xff; return b }

export const s3Multipart: LessonServer = {
  id: 's3-multipart',
  files: {
    'tiny.txt': 'a tiny part, far below the 5 MiB minimum\n',
    'abort-rule.json': JSON.stringify({ Rules: [{ ID: 'abort-incomplete-uploads', Status: 'Enabled', Filter: {}, AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 } }] }, null, 2),
  },
  async fixture(ctx) {
    // Text of 5 MiB is too large for the starter `files` map, so this module writes its binary parts itself.
    writeFileSync(path.join(ctx.workdir, 'part1.bin'), bytes(5 * MiB))
    writeFileSync(path.join(ctx.workdir, 'part2.bin'), bytes(1 * MiB))
    await ctx.c.s3.send(new CreateBucketCommand({ Bucket: BUCKET }))
    const up = await ctx.c.s3.send(new CreateMultipartUploadCommand({ Bucket: BUCKET, Key: 'abandoned.bin' }))
    await ctx.c.s3.send(new UploadPartCommand({ Bucket: BUCKET, Key: 'abandoned.bin', UploadId: up.UploadId, PartNumber: 1, Body: Buffer.from('left behind by a crashed client') }))
  },
  async check(ctx) {
    const h = ctx.history
    const head = await ctx.c.s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: 'video.bin' })).catch(() => undefined)
    const etag = head?.ETag?.replaceAll('"', '') ?? ''
    const completeOk = /-2$/.test(etag) && head?.ContentLength === 6 * MiB
    const open = await ctx.c.s3.send(new ListMultipartUploadsCommand({ Bucket: BUCKET })).catch(() => undefined)
    const lc = await ctx.c.s3.send(new GetBucketLifecycleConfigurationCommand({ Bucket: BUCKET })).catch(() => undefined)
    const rule = (lc?.Rules ?? []).some((r) => r.Status === 'Enabled' && Number(r.AbortIncompleteMultipartUpload?.DaysAfterInitiation ?? 0) > 0)
    return [
      item('complete', 'video.bin exists, is 6 MiB and its ETag ends in -2', completeOk, 'Create the upload, upload part1.bin and part2.bin, then complete with both ETags.', head ? `ETag ${etag}, ${head.ContentLength} bytes` : 'no video.bin yet'),
      item('parts', 'You inspected the parts with list-parts', ranOk(h, /s3api list-parts/), 'Run list-parts with your UploadId before completing.'),
      item('breakit', 'You saw EntityTooSmall on a complete', ranFail(h, /complete-multipart-upload/, /EntityTooSmall/), 'Upload tiny.txt as parts 1 and 2 of small.bin and complete it.'),
      item('abort', 'No multipart uploads remain open in big-uploads', Boolean(open) && (open?.Uploads ?? []).length === 0 && ranOk(h, /abort-multipart-upload/), 'Abort the abandoned upload and the failed small.bin upload.', `${open?.Uploads?.length ?? '?'} open`),
      item('rule', 'A lifecycle rule aborts incomplete multipart uploads', rule, 'Apply abort-rule.json with put-bucket-lifecycle-configuration.'),
    ]
  },
}
