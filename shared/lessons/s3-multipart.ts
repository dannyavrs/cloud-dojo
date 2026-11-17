import type { LessonContent } from '../types'

export const s3Multipart: LessonContent = {
  id: 's3-multipart',
  n: '2.3',
  trackId: 's3',
  level: 'intermediate',
  prereqs: ['s3-versioning'],
  estMinutes: 30,
  honesty: 'live',
  examTags: ['SAA:Performant', 'SAA:Cost', 'DVA:Dev'],
  breakItCheck: 'breakit',
  title: 'Multipart upload: parts, ETags and orphans',
  tagline: 'Upload a 6 MiB object in two parts, trip the 5 MiB rule, then clean up the parts nobody can see.',
  predict: [
    { id: 'p1', prompt: "You complete a multipart upload of two parts. What does the finished object's ETag look like?", options: ["The MD5 of the whole object", "The MD5 of the concatenated binary part MD5s, followed by `-2`", "A random UUID", "The upload id"], answer: 1, explain: "A multipart ETag is not a content hash. S3 hashes each part, concatenates the binary digests, hashes that, and appends `-<number of parts>`. That is why you cannot verify a multipart object against a plain `md5sum`." },
    { id: 'p2', prompt: "A part other than the last one is only 1 MiB. When does S3 complain?", options: ["On `upload-part`", "On `complete-multipart-upload` with EntityTooSmall", "Never, small parts are merged", "On `create-multipart-upload`"], answer: 1, explain: "S3 accepts any part size when you upload it, because it does not know which part will be last. The 5 MiB minimum for every part except the last is enforced when you complete the upload." },
    { id: 'p3', prompt: "A multipart upload is started and some parts are uploaded, but it is never completed or aborted. Which statement is true?", options: ["The parts expire after 24 hours", "The parts are stored and billed until you abort the upload, and they do not show in the console object list or `aws s3 ls`", "Only the completed parts are billed", "S3 completes the upload automatically after 7 days"], answer: 1, explain: "Uploaded parts of an incomplete upload are billed storage. They are invisible to normal listings, so the bill grows silently. Use `list-multipart-uploads` and a lifecycle rule with `AbortIncompleteMultipartUpload`." },
  ],
  concept: [
    "A multipart upload is three API phases: `CreateMultipartUpload` returns an **UploadId**, `UploadPart` stores numbered parts and returns an **ETag** for each, and `CompleteMultipartUpload` stitches the parts together in part-number order. The limits are the exam material: part size 5 MiB to 5 GiB (the **last part may be smaller**), up to **10,000 parts**, object size up to **5 TiB**, and a single `PutObject` tops out at 5 GiB. AWS recommends multipart above roughly 100 MiB and the CLI does it automatically above 8 MiB (`multipart_threshold`). The wins are throughput (parts upload in parallel and from different connections), resilience (retry only the failed part), and the ability to start before you know the total size. Part numbers need not be contiguous, re-uploading a part number overwrites that part, and `Complete` needs every ETag you want kept.",
    "The 5 MiB rule is checked at **Complete**, not at `UploadPart`: you can upload a 1 KiB part number 1 without a murmur, and the failure arrives later as `EntityTooSmall`. You will reproduce that. The ETag is the second surprise: for a multipart object it is the MD5 of the concatenated part MD5s plus `-N`, never the object's MD5, and with SSE-KMS even a single-part ETag is not an MD5 at all. If you need integrity, use the additional checksums (CRC32, CRC32C, SHA-1, SHA-256, or the full-object CRC64NVME that the emulator reports) which can be requested per upload. Copying objects over 5 GiB also needs multipart: `UploadPartCopy` copies byte ranges server-side with no download.",
    "The cost trap is **orphans**. Parts of an upload you never complete or abort remain stored and billed, and they do not appear in `ls`, the console object list, or Storage Lens object counts. Two defences: audit with `list-multipart-uploads` and `abort-multipart-upload`, and add a lifecycle rule `AbortIncompleteMultipartUpload` with `DaysAfterInitiation` (7 is the usual value). That rule cannot use object tag filters. A failed `Complete` like the one you will cause leaves the upload open, so cleanup is on you. Permissions are separate too: `s3:AbortMultipartUpload` and `s3:ListMultipartUploadParts` are their own actions, and the initiator or the bucket owner can abort.",
    "The fixture gives you `big-uploads`, two binary parts in your folder (`part1.bin` is exactly 5 MiB, `part2.bin` is 1 MiB, which is fine as the final part), a tiny text file for the failure, and one **abandoned upload** that someone started earlier. The module is done when the object exists with a `-2` ETag, you have seen EntityTooSmall, every open upload is aborted, and the bucket has the abort rule.",
  ],
  goal: "`video.bin` (6 MiB) exists with a `-2` ETag, EntityTooSmall has been seen, no multipart uploads remain open, and a lifecycle rule aborts future orphans.",
  steps: [
    { id: 'audit', title: 'Look for open uploads first', body: "Before uploading anything, ask S3 what is already in flight. The fixture left one abandoned upload behind. Note its key and UploadId for later.", commands: ["aws s3api list-multipart-uploads --bucket big-uploads --query 'Uploads[].[Key,UploadId]' --output text"] },
    { id: 'start', title: 'Start the upload', body: "Open Files and look at `part1.bin` (5 MiB) and `part2.bin` (1 MiB). Create the upload and copy the UploadId it prints, you will paste it into every following command.", commands: ['aws s3api create-multipart-upload --bucket big-uploads --key video.bin --query UploadId --output text'] },
    { id: 'parts', title: 'Upload the two parts', body: "Replace `<UPLOAD_ID>` with your UploadId. Each call prints the part's ETag including the quotes, keep both.", commands: ['aws s3api upload-part --bucket big-uploads --key video.bin --part-number 1 --body part1.bin --upload-id <UPLOAD_ID> --query ETag --output text', 'aws s3api upload-part --bucket big-uploads --key video.bin --part-number 2 --body part2.bin --upload-id <UPLOAD_ID> --query ETag --output text'] },
    { id: 'list', title: 'List what S3 holds', body: "The object does not exist yet, only parts. `list-parts` shows each part's number, size and ETag.", commands: ["aws s3api list-parts --bucket big-uploads --key video.bin --upload-id <UPLOAD_ID> --query 'Parts[].[PartNumber,Size,ETag]' --output text"] },
    { id: 'complete', title: 'Complete the upload', body: "Paste both ETags exactly as printed (with their quotes) into the parts list. Then read the finished object's ETag: it ends in `-2` and its size is 6291456.", commands: ["aws s3api complete-multipart-upload --bucket big-uploads --key video.bin --upload-id <UPLOAD_ID> --multipart-upload 'Parts=[{ETag=<ETAG_1>,PartNumber=1},{ETag=<ETAG_2>,PartNumber=2}]'", "aws s3api head-object --bucket big-uploads --key video.bin --query '[ETag,ContentLength]' --output text"] },
    { id: 'break', title: 'Break it: two parts that are too small', body: "Start a second upload for `small.bin`, upload the tiny text file as part 1 and as part 2 (S3 accepts both), then complete. Part 1 is not the last part and is far below 5 MiB, so the complete fails with **EntityTooSmall**. The upload stays open. Copy the new UploadId into the next commands, and the tiny file's ETag (it is the same for both parts) into the last one.", commands: ['aws s3api create-multipart-upload --bucket big-uploads --key small.bin --query UploadId --output text', 'aws s3api upload-part --bucket big-uploads --key small.bin --part-number 1 --body tiny.txt --upload-id <UPLOAD_ID_2> --query ETag --output text', 'aws s3api upload-part --bucket big-uploads --key small.bin --part-number 2 --body tiny.txt --upload-id <UPLOAD_ID_2> --query ETag --output text', "aws s3api complete-multipart-upload --bucket big-uploads --key small.bin --upload-id <UPLOAD_ID_2> --multipart-upload 'Parts=[{ETag=<TINY_ETAG>,PartNumber=1},{ETag=<TINY_ETAG>,PartNumber=2}]'"], breakIt: true },
    { id: 'abort', title: 'Abort every orphan', body: "List again: now two uploads are open (the abandoned one and `small.bin`). Neither would ever show in `aws s3 ls`. Abort both, then list a third time to confirm the bucket is clean.", commands: ["aws s3api list-multipart-uploads --bucket big-uploads --query 'Uploads[].[Key,UploadId]' --output text", 'aws s3api abort-multipart-upload --bucket big-uploads --key abandoned.bin --upload-id <ABANDONED_ID>', 'aws s3api abort-multipart-upload --bucket big-uploads --key small.bin --upload-id <UPLOAD_ID_2>'] },
    { id: 'rule', title: 'Stop it happening again', body: "`abort-rule.json` holds a lifecycle rule that aborts incomplete uploads 7 days after they start. Apply it and read it back.", commands: ['aws s3api put-bucket-lifecycle-configuration --bucket big-uploads --lifecycle-configuration file://abort-rule.json', 'aws s3api get-bucket-lifecycle-configuration --bucket big-uploads --query Rules'] },
  ],
  breakIt: {
    title: 'Complete an upload whose first part is under 5 MiB',
    command: "aws s3api complete-multipart-upload --bucket big-uploads --key small.bin --upload-id <UPLOAD_ID_2> --multipart-upload 'Parts=[{ETag=<TINY_ETAG>,PartNumber=1},{ETag=<TINY_ETAG>,PartNumber=2}]'",
    explain: [
      "S3 answers `EntityTooSmall: Your proposed upload is smaller than the minimum allowed size`. Both `upload-part` calls succeeded, the rule is checked only at completion, and only for parts that are not last. A single small part would have completed fine.",
      "The upload is still open, and its two stored parts are billed. In production this is the usual way orphans pile up: a client crashes or gets the part size wrong and never aborts. The fix is the lifecycle rule from the last step, plus a periodic audit with `list-multipart-uploads`.",
    ],
  },
  realAws: {
    cost: [
      "Parts are stored (and billed at the object's storage class rate, about $0.023 per GB-month for Standard in us-east-1, check the pricing page) from the moment each is uploaded until the upload is completed or aborted. The requests (`UploadPart`, `Complete`) are billed like PUTs, so very small parts mean many billed requests.",
      "A lifecycle `AbortIncompleteMultipartUpload` rule is free and is the standard guard against paying for abandoned parts.",
    ],
    differences: [
      "Real S3 also supports `UploadPartCopy`, checksum algorithms per part, and Transfer Acceleration (`s3-accelerate` endpoint) for far-away uploaders. Only the basic flow is hands-on here.",
      "The emulator lets you complete a one-part upload with a part smaller than 5 MiB, as real S3 does, because a sole part is also the last part.",
      "Real AWS lists in-progress uploads in Storage Lens and the console's Multipart uploads view for Standard buckets. The CLI audit shown here is the portable way.",
    ],
    asOf: '2026-11-13',
    sources: [{ label: 'Uploading and copying objects using multipart upload', url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html' }, { label: 'Multipart upload limits', url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html' }, { label: 'Configuring a lifecycle rule to abort incomplete uploads', url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpu-abort-incomplete-mpu-lifecycle-config.html' }],
  },
  fidelity: [{ service: 'S3', pass: 1025, total: 1226 }],
  files: ['part1.bin', 'part2.bin', 'tiny.txt', 'abort-rule.json'],
  checks: [
    { id: 'complete', label: 'video.bin exists, is 6 MiB and its ETag ends in -2', hint: 'Create the upload, upload part1.bin and part2.bin, then complete with both ETags.' },
    { id: 'parts', label: 'You inspected the parts with list-parts', hint: 'Run list-parts with your UploadId before completing.' },
    { id: 'breakit', label: 'You saw EntityTooSmall on a complete', hint: 'Upload tiny.txt as parts 1 and 2 of small.bin and complete it.' },
    { id: 'abort', label: 'No multipart uploads remain open in big-uploads', hint: 'Abort the abandoned upload and the failed small.bin upload.' },
    { id: 'rule', label: 'A lifecycle rule aborts incomplete multipart uploads', hint: 'Apply abort-rule.json with put-bucket-lifecycle-configuration.' },
  ],
}
