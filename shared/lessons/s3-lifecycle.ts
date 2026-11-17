import type { LessonContent } from '../types'

export const s3Lifecycle: LessonContent = {
  id: 's3-lifecycle',
  n: '2.5',
  trackId: 's3',
  level: 'advanced',
  prereqs: ['s3-versioning'],
  estMinutes: 30,
  honesty: 'simulated',
  requires: ['s3-lifecycle-validation'],
  honestyNote: "The emulator stores lifecycle rules but never runs them, and it accepts transitions that real S3 rejects (it only catches an expiration that is not later than a transition). So this module validates your lifecycle.json against the real AWS rules inside the app. A rule that passes the app's validation is what real S3 would accept; the emulator's yes or no tells you nothing about that.",
  examTags: ['SAA:Cost', 'SAA:Resilient', 'DVA:Dev'],
  breakItCheck: 'breakit',
  editable: ['lifecycle.json'],
  title: 'Lifecycle rules and storage classes: what AWS accepts and what it bills',
  tagline: 'Fix a rule set the emulator happily stores but AWS would reject, and price in the minimum storage durations.',
  predict: [
    { id: 'p1', prompt: "A rule transitions objects from Standard to Standard-IA after 10 days. What does real S3 do when you save it?", options: ["Accepts it and transitions at day 10", "Rejects it: objects must be at least 30 days old before a lifecycle transition to Standard-IA or One Zone-IA", "Accepts it but transitions at day 30 instead", "Accepts it and bills a 30-day minimum from day 10"], answer: 1, explain: "Lifecycle transitions into S3 Standard-IA and One Zone-IA require the object to have been in Standard for at least 30 days. Real S3 returns InvalidArgument for a smaller Days value. (You can still upload directly into IA with `--storage-class STANDARD_IA`.)" },
    { id: 'p2', prompt: "An object transitions to S3 Glacier Flexible Retrieval at day 90 and your rule expires it at day 120. What is the billing consequence?", options: ["None", "An early-deletion charge: Glacier Flexible Retrieval has a 90-day minimum storage duration and the object stayed only 30 days", "The expiration is rejected", "Retrieval fees for 30 days"], answer: 1, explain: "Minimum storage durations: Standard-IA and One Zone-IA 30 days, Glacier Instant Retrieval and Flexible Retrieval 90 days, Deep Archive 180 days. Deleting or transitioning an object earlier than that is billed for the remaining days." },
    { id: 'p3', prompt: "By default, how does S3 treat objects smaller than 128 KB in a lifecycle transition rule?", options: ["It transitions them like any other object", "It does not transition them (the default minimum object size is 128 KB for all storage classes)", "It transitions them but charges 128 KB", "It deletes them"], answer: 1, explain: "Since 2024 the default is `all_storage_classes_128K`: smaller objects are not transitioned, because tiny objects cost more in IA or Glacier (per-object overhead and minimum billable size). You can override it per bucket with `TransitionDefaultMinimumObjectSize`, which is why the emulator echoes that attribute." },
  ],
  concept: [
    "A lifecycle configuration is a list of rules, each with a **filter** (prefix, tag, object size, or `And` of them) and **actions**: `Transitions` (change storage class after N days or on a date), `Expiration` (delete current objects, or in a versioned bucket add a delete marker), `NoncurrentVersionTransitions` and `NoncurrentVersionExpiration` (act on old versions), `ExpiredObjectDeleteMarker` (clean up orphaned markers) and `AbortIncompleteMultipartUpload`. Transitions only go **down the waterfall**: Standard, Standard-IA, Intelligent-Tiering, One Zone-IA, Glacier Instant Retrieval, Glacier Flexible Retrieval, Deep Archive. You cannot lifecycle-transition back up (restore, or copy the object, instead), and `Days` must increase from one transition to the next. S3 runs lifecycle asynchronously, roughly once a day at midnight UTC, and rounds the execution time to the next day boundary, so \"after 30 days\" is never to the hour.",
    "The rules that trip people, and that the real S3 API rejects: **IA and One Zone-IA transitions need at least 30 days** since creation; an **expiration must come later than the last transition** in the same rule; noncurrent-version transitions to IA also need 30 `NoncurrentDays`; `AbortIncompleteMultipartUpload` cannot be combined with tag or size filters; `ExpiredObjectDeleteMarker` cannot sit beside `Days` in the same expiration. A rule without any action, a duplicate rule `ID`, or a bad status are rejected too. Then there is **billing, which the API never warns about**: each class has a **minimum storage duration** (Standard-IA and One Zone-IA 30 days, Glacier Instant and Flexible 90, Deep Archive 180). If a rule moves an object to Glacier at day 90 and expires it at day 120, S3 accepts that and charges you the remaining 60 days. Objects under 128 KB are not transitioned by default.",
    "Versioning changes the arithmetic. In a versioned bucket, `Expiration` on the current version only adds a **delete marker**, and the old data stays (and is billed) as a noncurrent version until a `NoncurrentVersionExpiration` rule removes it (`NewerNoncurrentVersions` keeps the newest N). A bucket that only has an Expiration rule keeps every byte forever. Pair them. Know the alternatives too: **Intelligent-Tiering** moves objects between access tiers automatically for a small monitoring fee per object (no retrieval fees, no 30-day minimum for the frequent and infrequent tiers) and is the answer when access patterns are unknown; **Glacier Instant Retrieval** gives millisecond access for rarely read data (90-day minimum); Flexible Retrieval restores take minutes to hours (Expedited, Standard, Bulk) and Deep Archive 12 to 48 hours.",
    "This module is **Simulated**. On the emulator, `put-bucket-lifecycle-configuration` stores whatever you give it (apart from one check on expiration versus transition), the rules never run, and objects never change class by themselves. So the checker validates your `lifecycle.json` with the real AWS rules inside the app, and also checks that the emulator is holding the same rules. First you will apply a deliberately bad file to see the emulator say yes, then fix `lifecycle.json` until the app agrees it is valid, cost-sane and complete (abort rule, noncurrent expiration).",
  ],
  goal: "`archive-lab` holds a lifecycle configuration that passes the AWS rule check, has no early-deletion trap, expires old versions, and aborts stale multipart uploads.",
  steps: [
    { id: 'empty', title: 'Nothing is configured yet', body: "The fixture made a versioned bucket `archive-lab` with `logs/app.log`. There is no lifecycle configuration, and asking for it is an error (`NoSuchLifecycleConfiguration`), which is an expected failure here. Open `lifecycle.json` in the editor and read the two rules.", commands: ['aws s3api get-bucket-lifecycle-configuration --bucket archive-lab'] },
    { id: 'bad', title: 'Break it: the emulator accepts an invalid rule', body: "`bad-lifecycle.json` moves logs to Standard-IA after 10 days. Real S3 would reject that with `InvalidArgument`. The emulator says yes and stores it. Apply it, read it back, then press **Run checks**: the app flags the rule and quotes the AWS rule it breaks.", commands: ['aws s3api put-bucket-lifecycle-configuration --bucket archive-lab --lifecycle-configuration file://bad-lifecycle.json', 'aws s3api get-bucket-lifecycle-configuration --bucket archive-lab --query Rules[].ID'], breakIt: true },
    { id: 'fix', title: 'Fix lifecycle.json', body: "Edit `lifecycle.json` and Save. Press **Run checks** after each edit: the details under the first check list every problem. What has to be true:\n1. Transitions to Standard-IA need at least 30 days, and noncurrent transitions to IA need at least 30 noncurrent days.\n2. The `logs` expiration must be later than its last transition **and** leave at least the target class's minimum duration (90 days for Glacier) so there is no early-deletion charge.\n3. Old versions must eventually be deleted: add `NoncurrentVersionExpiration` to `versions`.\n4. Add a third rule that aborts incomplete multipart uploads after 7 days (snippet below).", code: { file: 'lifecycle.json', text: '{\n  "ID": "abort-mpu",\n  "Status": "Enabled",\n  "Filter": {},\n  "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 }\n}' } },
    { id: 'apply', title: 'Apply the corrected configuration', body: "Replace the stored (bad) configuration with your file and read the rule IDs back. Remember what this proves: the emulator stored it. The app's check is what tells you real S3 would too.", commands: ['aws s3api put-bucket-lifecycle-configuration --bucket archive-lab --lifecycle-configuration file://lifecycle.json', 'aws s3api get-bucket-lifecycle-configuration --bucket archive-lab --query Rules[].ID'] },
    { id: 'class', title: 'Write straight into a colder class', body: "Lifecycle is the only way to *move* objects over time, but you can choose the class at upload. `GLACIER` objects cannot be read until restored, which the emulator models, so the last command fails on purpose with InvalidObjectState.", commands: ['aws s3api put-object --bucket archive-lab --key logs/cold.log --body app.log --storage-class GLACIER', 'aws s3api head-object --bucket archive-lab --key logs/cold.log --query StorageClass', 'aws s3api get-object --bucket archive-lab --key logs/cold.log cold-copy.log'] },
  ],
  breakIt: {
    title: 'A 10-day transition to Standard-IA',
    command: 'aws s3api put-bucket-lifecycle-configuration --bucket archive-lab --lifecycle-configuration file://bad-lifecycle.json',
    explain: [
      "The emulator stores the rule and exits 0. Real S3 answers with an `InvalidArgument` error along the lines of \"'Days' in the Transition action for StorageClass 'STANDARD_IA' must be 30 or more\". The emulator never runs the rule either, so even a *valid* rule would do nothing here: no object changes class, none expires.",
      "This is the gap the badge is about. A green `put-bucket-lifecycle-configuration` on the emulator proves nothing about AWS acceptance. The app-side validator encodes the documented rules, so use it, and in real accounts read the error you get back and test rules on a small prefix first.",
    ],
  },
  realAws: {
    cost: [
      "Lifecycle rules are free to configure. Transition requests are billed per 1,000 objects moved (about $0.01 for IA, $0.02 for Glacier Instant, $0.03 for Flexible, $0.05 for Deep Archive, us-east-1, check the pricing page), which is why transitioning millions of tiny objects can cost more than it saves. Expiration of objects is free.",
      "Storage per GB-month falls from about $0.023 (Standard) to $0.0125 (Standard-IA), $0.004 (Glacier Instant), $0.0036 (Flexible) and $0.00099 (Deep Archive), but IA and Glacier add retrieval charges and the minimum storage durations from the lesson.",
    ],
    differences: [
      "Real S3 executes rules asynchronously (about daily, UTC) and expiry or transition dates are rounded to the next midnight. The emulator never executes them, so waiting changes nothing.",
      "Real S3 rejects invalid transitions at save time. The emulator accepts them, except when an expiration is not later than a transition. That is the entire reason this module validates in the app.",
      "The emulator does put an `Expiration` header on objects that match an expiration rule at upload time, as AWS does, but nothing is deleted when the date arrives.",
    ],
    asOf: '2026-11-13',
    sources: [{ label: 'Managing the lifecycle of objects', url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html' }, { label: 'Transitioning objects: constraints and considerations', url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-transition-general-considerations.html' }, { label: 'Amazon S3 storage classes', url: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-class-intro.html' }],
  },
  fidelity: [{ service: 'S3', pass: 1025, total: 1226 }],
  files: ['lifecycle.json', 'bad-lifecycle.json', 'app.log'],
  checks: [
    { id: 'valid', label: 'lifecycle.json passes the AWS rule check with no problems', hint: 'Press Run checks and read the problems listed in the details, then edit lifecycle.json.' },
    { id: 'breakit', label: 'You applied the 10-day Standard-IA rule that only the emulator accepts', hint: 'Apply bad-lifecycle.json, then press Run checks to see what the app says.' },
    { id: 'abort', label: 'lifecycle.json aborts incomplete multipart uploads', hint: 'Add the abort-mpu rule with DaysAfterInitiation 7.' },
    { id: 'noncurrent', label: 'lifecycle.json expires noncurrent versions', hint: 'Add NoncurrentVersionExpiration to the versions rule.' },
    { id: 'stored', label: 'The emulator holds the same valid rules as lifecycle.json', hint: 'Apply lifecycle.json with put-bucket-lifecycle-configuration after it validates.' },
    { id: 'class', label: 'You wrote an object into a colder storage class', hint: 'Run the put-object with --storage-class GLACIER.' },
  ],
}
