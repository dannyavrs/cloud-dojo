import type { LessonContent } from '../types'

export const s3Presigned: LessonContent = {
  id: 's3-presigned',
  n: '2.2',
  trackId: 's3',
  level: 'intermediate',
  prereqs: ['s3-versioning'],
  estMinutes: 20,
  honesty: 'live',
  examTags: ['SAA:Secure', 'DVA:Dev', 'DVA:Sec'],
  breakItCheck: 'breakit',
  httpProbe: true,
  title: 'Presigned URLs: time-boxed access without credentials',
  tagline: 'Hand out one private object for five minutes, then watch it stop working.',
  predict: [
    { id: 'p1', prompt: "You presign a GET for `report.txt`, then change only the key in the URL to `secret.txt` (same signer, same bucket, signer can read both). What does S3 return?", options: ["200 with secret.txt, because the signer is allowed to read both", "403 SignatureDoesNotMatch: the path is part of what was signed", "404 NoSuchKey", "A redirect to a new presigned URL"], answer: 1, explain: "The signature covers the HTTP method, host, canonical path and the signed query parameters. Change any of them and the signature S3 recomputes no longer matches. The URL grants exactly one operation on exactly one object." },
    { id: 'p2', prompt: "A Lambda function signs a presigned GET with `ExpiresIn` of 7 days using its execution-role credentials. Roughly how long does the URL really work?", options: ["7 days", "Until the role's temporary credentials expire, usually well under 7 days", "24 hours, the S3 maximum", "Until the first successful download"], answer: 1, explain: "A presigned URL is only as valid as the credentials that signed it. Role credentials come from STS and expire (often within hours), and the URL dies with them even though X-Amz-Expires says 7 days. Only long-term IAM user keys can sign for the full 7 days." },
    { id: 'p3', prompt: "What is the longest expiry a Signature Version 4 presigned URL can have when signed with an IAM user's access key?", options: ["1 hour", "12 hours", "7 days (604800 seconds)", "30 days"], answer: 2, explain: "SigV4 allows X-Amz-Expires from 1 to 604800 seconds. The CLI default is 3600 (1 hour). The console caps presigned URLs at 12 hours because it uses temporary credentials." },
  ],
  concept: [
    "A presigned URL is a **bearer token in query-string form**. The signer computes a SigV4 signature over the method, host, path and a few `X-Amz-*` parameters (`X-Amz-Credential` names the signer, `X-Amz-Date` and `X-Amz-Expires` bound the time window) and appends it to an ordinary S3 URL. S3 holds no record of the URL. On each request it recomputes the signature, checks the window, and then authorises the request **as the signer, at the moment of use**. If the signer's permissions shrink, the URL stops working immediately. If the signer never had access to the object, a perfectly well-formed URL still returns 403. Anyone holding the URL can use it, so treat it like a password with a lifetime and never write it to logs.",
    "The exam traps are about **whose credentials signed it**. With an IAM user's long-term key the maximum lifetime is 7 days (`604800` seconds). With STS credentials (an assumed role, an EC2 instance profile, a Lambda execution role, the console) the URL expires when the session token expires, whichever comes first, so \"my 12-hour presigned URL died after 40 minutes\" almost always means role credentials. Other traps: the CLI's `aws s3 presign` only creates **GET** URLs (uploads need an SDK to presign a PUT, and any `Content-Type` or checksum header you sign must be repeated by the uploader); for browser uploads with size and key-prefix constraints use a **presigned POST** policy; non-`us-east-1` buckets need the regional endpoint and SigV4; objects under SSE-KMS need the signer to hold `kms:Decrypt`; and bucket-policy conditions such as `aws:SourceIp`, `aws:SecureTransport` or `aws:SourceVpce` are still evaluated against the caller's network, not the signer's.",
    "Choosing between access patterns is the other half. Use a presigned URL for **one object, one operation, short time, no identity needed** (a download link in an email, a browser upload straight to S3 that skips your servers). Use a **bucket policy** for stable, identity-based or network-based access. Use **CloudFront signed URLs or cookies** when you need to restrict many objects with one policy, enforce an IP range or a start time, serve through a CDN, or revoke by rotating a key group. You cannot revoke a single presigned URL: your options are deleting or disabling the signing key, removing the signer's permission, or a bucket-policy Deny for that object. That is why short expiries matter more than clever secrecy.",
    "In this module the fixture gives you a private bucket `share-lab` with `report.txt` and `secret.txt`. You will presign `report.txt`, open the URL in the HTTP probe panel, strip the signature to see the bucket is private, tamper with the key to see the signature cover the path, then presign with a 1-second expiry and watch it expire. Two different failures are worth telling apart: an expired URL gets `AccessDenied: Request has expired`, while a modified one gets `SignatureDoesNotMatch`. A presigned PUT also works on the emulator (signed with an SDK, since the CLI cannot make one), but there is no CLI path to it, so it stays a note rather than a step.",
  ],
  goal: "You can create, use and expire a presigned URL, and you have seen the three ways S3 refuses one: no signature, wrong signature, expired.",
  steps: [
    { id: 'look', title: 'See that the bucket is private', body: "The fixture created `share-lab` with two objects and no bucket policy. Credentials from your CLI can read them, but nobody else can. List the bucket as yourself.", commands: ['aws s3 ls s3://share-lab'] },
    { id: 'presign', title: 'Presign report.txt for 5 minutes', body: "`aws s3 presign` signs locally, with no request to S3. Run it, copy the whole URL, then paste it into the **HTTP probe** panel with method GET and press Send. You should get **200** and the file body. Read the query string: `X-Amz-Credential` (who signed), `X-Amz-Date`, `X-Amz-Expires=300`, `X-Amz-Signature`.", commands: ['aws s3 presign s3://share-lab/report.txt --expires-in 300'] },
    { id: 'anon', title: 'Strip the signature', body: "In the probe panel delete everything from `?` onward and send the bare URL. The object is private, so an unsigned request gets **403 AccessDenied** with no hint about whether the key exists." },
    { id: 'other', title: 'Presign a second object and compare', body: "Presign `secret.txt` and put the two URLs side by side. The path and the signature differ, everything else is the same shape. Signatures are per method, per path, per time window.", commands: ['aws s3 presign s3://share-lab/secret.txt --expires-in 120'] },
    { id: 'tamper', title: 'Tamper with the key', body: "Take the valid `report.txt` URL from step 2 (still inside its 5 minutes), change `report.txt` to `secret.txt` in the path and nothing else, and send it from the probe panel. Your own credentials could read `secret.txt`, yet S3 answers **403 SignatureDoesNotMatch**: the signature covered the path." },
    { id: 'expire', title: 'Break it: let a URL expire', body: "Presign `report.txt` with a 1-second lifetime, wait three seconds, then send it from the probe panel. Same object, same signer, same signature: now **403 AccessDenied, Request has expired**. Real AWS checks the window against its own clock, so clock skew on the machine that signs also matters.", commands: ['aws s3 presign s3://share-lab/report.txt --expires-in 1'], breakIt: true },
    { id: 'put', title: 'Presigned PUT (read-only note)', body: "The CLI cannot presign uploads. With an SDK (for example `getSignedUrl` with `PutObjectCommand`) you sign a PUT and the holder uploads with `curl -T`. The emulator accepts that too (verified while building this module). The uploader must send exactly the headers that were signed, and the object is owned by the signer, not the uploader." },
  ],
  breakIt: {
    title: 'A URL that outlives its window',
    command: 'aws s3 presign s3://share-lab/report.txt --expires-in 1',
    explain: [
      "Three seconds after signing, the same URL gets `403 AccessDenied` with `Request has expired`, and the response even prints `Expires` and `ServerTime` so you can see the gap. Nothing about the object or the signer changed: only the clock.",
      "On AWS this is also what a leaked link looks like after its time is up, which is the whole point of short expiries. If the expiry is long and the link leaks, you cannot revoke that one URL: you would disable the signing key or add a bucket-policy Deny, which is why real systems presign for minutes, not days.",
    ],
  },
  realAws: {
    cost: [
      "Signing is a local computation and free. The requests made with the URL are billed as normal GET or PUT requests, plus data transfer out to the internet for the download (about $0.09 per GB after the free tier, us-east-1, check the pricing page).",
      "Presigned uploads are a cost tool: the bytes go straight to S3 instead of through an EC2, Lambda or API Gateway hop that would bill for payload size and time.",
    ],
    differences: [
      "On the emulator the signer is the single emulator user and its key never expires, so the 'role credentials expire first' trap (prediction 2) cannot be reproduced here. Know it from the docs.",
      "Real S3 returns `Request has expired` and `SignatureDoesNotMatch` with the same codes the emulator uses, and the emulator even echoes `StringToSign`, which AWS does too. Use that to debug clock and path-encoding problems.",
      "Real AWS also supports presigned POST (browser form uploads with a policy of conditions such as `content-length-range` and key prefix). Not part of this module's hands-on.",
    ],
    asOf: '2026-11-13',
    sources: [{ label: 'Sharing objects with presigned URLs', url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html' }, { label: 'Authenticating requests: query parameters (SigV4)', url: 'https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html' }],
  },
  fidelity: [{ service: 'S3', pass: 1025, total: 1226 }],
  files: [],
  probeNote: 'These checks read the calls you made from the HTTP probe panel in this module. Pressing Check sends nothing new.',
  checks: [
    { id: 'url', label: 'You created a presigned URL for report.txt', hint: 'Run `aws s3 presign s3://share-lab/report.txt --expires-in 300`.' },
    { id: 'get', label: 'The probe fetched report.txt with a presigned URL and got 200', hint: 'Paste the URL into the HTTP probe panel (GET) and send it before it expires.' },
    { id: 'anon', label: 'The unsigned URL was refused with 403', hint: 'Send the report.txt URL with the whole query string removed.' },
    { id: 'tamper', label: 'A URL with the key changed to secret.txt was refused with 403', hint: 'Edit a still-valid report.txt URL: replace report.txt with secret.txt in the path only.' },
    { id: 'breakit', label: 'A 1-second URL was refused with 403 after it expired', hint: 'Presign with --expires-in 1, wait three seconds, then send it from the probe panel.' },
  ],
}
