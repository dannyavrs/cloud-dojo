import type { LessonContent } from '../types'

export const s3Versioning: LessonContent = {
  id: 's3-versioning',
  n: '2.1',
  trackId: 's3',
  level: 'core',
  prereqs: [],
  estMinutes: 15,
  honesty: 'live',
  examTags: ["SAA:Resilient", "SAA:Cost", "DVA:Dev"],
  predict: [{"id": "p1", "prompt": "Versioning is enabled and you upload two different files to the same key. How many versions of the key exist?", "options": ["1, the second upload replaced the first", "2, both are kept and the newest is current", "2, but the first becomes a delete marker", "It depends on the file size"], "answer": 1, "explain": "With versioning on, each PUT creates a new version id. The older version stays retrievable by its VersionId."}],
  breakItCheck: 'badname',

  title: 'S3: buckets, objects, versioning',
  tagline: 'Overwrite a file by accident, then get the old one back.',
  concept: [
    'S3 stores **objects** (files plus metadata) under **keys** inside **buckets**. Bucket names are unique across all of AWS, 3-63 lowercase characters. A key like `note.txt` or `uploads/a.jpg` is just a string; folders are a display trick.',
    'Normally an upload to an existing key replaces it. Turn on **versioning** and S3 keeps every older copy, each with a `VersionId`. That is how you recover from "I overwrote the wrong file".',
    'Your working folder has `v1.txt` ("first draft") and `v2.txt` ("second draft, oops"). Use the Files button to read them.',
  ],
  goal: 'A versioned bucket `snap-photos` where `note.txt` was overwritten, and `restored.txt` holds the first draft again.',
  steps: [
    { id: 'bucket', title: 'Make the bucket', body: 'In `us-east-1` no location constraint is needed.', commands: ['aws s3api create-bucket --bucket snap-photos'] },
    { id: 'ver', title: 'Turn versioning on first', body: 'Versioning only protects objects written after you enable it, so do it before uploading.', commands: ['aws s3api put-bucket-versioning --bucket snap-photos --versioning-configuration Status=Enabled'] },
    { id: 'upload', title: 'Upload, then overwrite', body: 'Same key twice.', commands: ['aws s3 cp v1.txt s3://snap-photos/note.txt', 'aws s3 cp v2.txt s3://snap-photos/note.txt'] },
    { id: 'list', title: 'List the versions', body: 'The older one has `IsLatest` false. Copy its VersionId.', commands: ["aws s3api list-object-versions --bucket snap-photos --prefix note.txt --query 'Versions[].[VersionId,IsLatest]' --output text"] },
    { id: 'restore', title: 'Fetch the old version', body: 'Then open `restored.txt` in Files: it should say "first draft".', commands: ['aws s3api get-object --bucket snap-photos --key note.txt --version-id <OLD_VERSION_ID> restored.txt'] },
    { id: 'break', title: 'Break it: an invalid bucket name', body: 'Uppercase letters and short names are not allowed.', commands: ['aws s3api create-bucket --bucket AB'], breakIt: true },
  ],
  breakIt: {
    title: 'Create a bucket called "AB"',
    command: 'aws s3api create-bucket --bucket AB',
    explain: [
      '`InvalidBucketName`: names must be 3-63 characters of lowercase letters, digits, dots and hyphens. S3 checks the name before doing anything else.',
      'Because bucket names are global on real AWS, `snap-photos` could already belong to someone else there. You would see `BucketAlreadyExists`. Real projects add the account id or a random suffix.',
    ],
  },
  realAws: {
    cost: [
      'S3 Standard storage is roughly two to three US cents per GB-month in us-east-1 (approximate: check the pricing page, the table did not render for automated lookup), plus a small fee per thousand requests.',
      'GET requests were $0.0004 per 1,000 in the S3 pricing page example for US East (N. Virginia). With versioning, every stored version is billed as its own object until you delete it or add a lifecycle rule.',
    ],
    differences: [
      'Bucket names are global on real AWS; the emulator has a single account so collisions never happen.',
      'Real S3 is strongly consistent for reads after writes, like the emulator.',
      'Lifecycle rules, replication and encryption options exist on real S3 and are mostly out of scope here.',
    ],
    asOf: '2026-11-13',
    sources: [{ label: 'S3 pricing', url: 'https://aws.amazon.com/s3/pricing/' }, { label: 'S3 versioning', url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/Versioning.html' }],
  },
  fidelity: [{ service: 'S3', pass: 1025, total: 1226 }],
  files: ['v1.txt', 'v2.txt'],
  checks: [
    { id: 'bucket', label: 'Bucket `snap-photos` exists', hint: 'Run step 1.' },
    { id: 'ver', label: 'Versioning is Enabled', hint: 'Run step 2 before uploading.' },
    { id: 'two', label: '`note.txt` has at least 2 versions', hint: 'Upload v1.txt then v2.txt to the same key after enabling versioning.' },
    { id: 'restored', label: '`restored.txt` contains the first draft', hint: 'Use get-object with the older VersionId (IsLatest = False).' },
    { id: 'badname', label: 'You triggered InvalidBucketName on purpose', hint: 'Run the break-it command.' },
  ],
}
