import type { LessonContent } from '../types'

export const REPORT_TXT = `Q3 invoice export (pretend this file is 2 GB)
customer,amount
acme,1200
globex,980
initech,455
`

export const kmsEnvelope: LessonContent = {
  id: 'kms-envelope',
  n: '11.1',
  trackId: 'security',
  level: 'intermediate',
  prereqs: ['s3-data-protection'],
  estMinutes: 30,
  honesty: 'live',
  honestyNote: 'The emulator runs real KMS semantics for symmetric keys: aliases, encrypt/decrypt, data keys, re-encrypt and the encryption-context check are all enforced, and a wrong context fails exactly like AWS. Key material never leaves the emulator, as on AWS.',
  examTags: ['SAA:Secure', 'DVA:Sec'],
  breakItCheck: 'breakit',
  editable: [],
  title: 'KMS basics and envelope encryption: keys, aliases, data keys, encryption context',
  tagline: 'Encrypt a secret with a customer managed key, watch a wrong encryption context fail, then do what AWS services do: wrap a data key.',
  predict: [
    { id: 'p1', prompt: 'You call `kms encrypt` with `--encryption-context app=orders` and later `kms decrypt` with `--encryption-context app=billing` on the same ciphertext. What happens?', options: ['It decrypts, the context is only a log label', 'It fails with InvalidCiphertextException: the context is part of the authenticated data and must match exactly', 'It decrypts but returns the context in the response so you can compare', 'It fails with AccessDeniedException'], answer: 1, explain: 'The encryption context is additional authenticated data (AAD). Decrypt must present the same key/value pairs or KMS cannot verify the ciphertext and returns InvalidCiphertextException. It is not secret (it appears in CloudTrail), but it binds a ciphertext to its purpose.' },
    { id: 'p2', prompt: 'You need to encrypt a 2 GB file with KMS. Which statement is correct?', options: ['kms encrypt accepts up to 5 GB per call', 'kms encrypt accepts at most 4,096 bytes of plaintext, so generate a data key, encrypt the file locally with it and store the encrypted data key beside the file', 'Split the file into 4 KB pieces and call kms encrypt for each', 'Upload the file to S3: KMS has no way to encrypt data of this size'], answer: 1, explain: 'Direct Encrypt is limited to 4,096 bytes. Envelope encryption is the pattern for everything bigger: GenerateDataKey returns a plaintext key (use it, then discard it) and the same key encrypted under your KMS key (store it). S3, EBS, RDS and friends do exactly this.' },
    { id: 'p3', prompt: '`generate-data-key` returns both Plaintext and CiphertextBlob. What do you persist next to the encrypted data?', options: ['Only the Plaintext key', 'Both, so you can decrypt without calling KMS', 'Only the CiphertextBlob (the encrypted data key); the plaintext key is used once in memory and discarded', 'Neither: KMS stores data keys for you'], answer: 2, explain: 'KMS does not store data keys. You keep the encrypted copy; to read the data later you call kms decrypt on that blob to get the plaintext key back (and KMS checks key policy and context again). Persisting the plaintext key defeats the purpose.' },
  ],
  concept: [
    "A **KMS key** (formerly CMK) is a logical key that never leaves AWS KMS in plaintext. You use it through API calls: `Encrypt`, `Decrypt`, `GenerateDataKey`, `ReEncrypt`. **AWS managed keys** (`alias/aws/s3`, `alias/aws/ssm`, ...) are created for you by a service, free to hold, rotated yearly and cannot have their policy edited. **Customer managed keys** cost about 1 USD per month each plus per-request fees, but you control the key policy, grants, rotation, aliases, disabling and deletion, and every use shows up in CloudTrail. An **alias** (`alias/orders`) is a friendly, repointable name: applications reference the alias, and you can swap the target key without a code change. An alias is not an ARN of the key and carries no permissions of its own.",
    "`Encrypt` is only meant for small secrets: the limit is **4,096 bytes** of plaintext. Anything larger uses **envelope encryption**. You ask KMS for a **data key** (`GenerateDataKey`, AES_256 by default). KMS returns the key twice: in plaintext, and encrypted under your KMS key. You encrypt the big payload locally (for example with AES-GCM), keep only the encrypted data key next to the ciphertext, and wipe the plaintext key from memory. To decrypt you send the encrypted data key to `Decrypt`, get the plaintext key back and decrypt locally. Benefits the exam asks about: the payload never travels to KMS (no size or throughput limit), each object can have its own data key (small blast radius), and revoking or deleting the KMS key makes every wrapped data key unreadable. `GenerateDataKeyWithoutPlaintext` is for keys you will only need later, and the AWS Encryption SDK packages the whole pattern.",
    "The **encryption context** is a set of non-secret key-value pairs you pass to Encrypt/GenerateDataKey. KMS binds it cryptographically to the ciphertext as additional authenticated data, so Decrypt must supply the identical pairs or it fails with `InvalidCiphertextException`. Use it to tie a ciphertext to its purpose (`app=orders`, `tenant=42`): a blob copied to another tenant's record will not decrypt. It is logged in plaintext in CloudTrail, which makes it useful for audit and for conditions (`kms:EncryptionContext:app` in key policies), and it also means you must never put a secret in it. `ReEncrypt` moves a ciphertext to a new key or a new context inside KMS, without your code ever seeing the plaintext.",
    "In this module you create a key and alias, round-trip a short value, break decryption with the wrong context, generate a data key and recover it, and re-encrypt a blob under a new context. Output in this module contains a plaintext data key. That is fine for a lab key on an emulator; on real AWS a plaintext key printed to a terminal or log is a leak, which is why SDKs keep it in memory only. The checker compares values from your command history on the server and never echoes them back to the page.",
  ],
  goal: 'A customer managed key with alias `alias/orders`, a short value encrypted and decrypted with an encryption context, the context mismatch seen, a data key generated and unwrapped, and a blob re-encrypted under a new context.',
  steps: [
    { id: 'look', title: 'Look at the key landscape', body: "A fresh emulator already knows the AWS managed aliases. Your own keys are the customer managed ones. List the aliases: you will add `alias/orders` in a moment.", commands: ["aws kms list-aliases --query 'Aliases[].AliasName' --output text"] },
    { id: 'key', title: 'Create a key and an alias', body: 'Create a symmetric key and note the key id in the output. Point `alias/orders` at it, then describe it through the alias. `KeyManager` is `CUSTOMER`, the state is `Enabled`.', commands: ['aws kms create-key --description "orders data key" --query KeyMetadata.KeyId --output text', 'aws kms create-alias --alias-name alias/orders --target-key-id <KEY_ID>', "aws kms describe-key --key-id alias/orders --query 'KeyMetadata.[KeyState,KeyManager,KeySpec]' --output text"] },
    { id: 'enc', title: 'Encrypt a small value with an encryption context', body: "`aGVsbG8gS01T` is the base64 of `hello KMS` (the CLI sends blobs as base64). The output is the ciphertext, also base64. Copy it: later commands use it as `<CIPHERTEXT>`.", commands: ['aws kms encrypt --key-id alias/orders --plaintext aGVsbG8gS01T --encryption-context app=orders --query CiphertextBlob --output text'] },
    { id: 'dec', title: 'Decrypt it with the same context', body: 'Decrypt needs no key id for a symmetric key: the ciphertext knows which key made it. With the right context you get `aGVsbG8gS01T` back.', commands: ['aws kms decrypt --ciphertext-blob <CIPHERTEXT> --encryption-context app=orders --query Plaintext --output text'] },
    { id: 'break', title: 'Break it: decrypt with the wrong encryption context', body: 'Same ciphertext, different context. KMS cannot verify the authenticated data and refuses. Leaving the context off entirely fails the same way.', commands: ['aws kms decrypt --ciphertext-blob <CIPHERTEXT> --encryption-context app=billing'], breakIt: true },
    { id: 'dk', title: 'Generate a data key (the envelope)', body: 'The output is two values on one line: the plaintext data key (44 base64 characters = 32 bytes, AES-256) and the same key encrypted under `alias/orders`. Copy them as `<DATA_KEY_PLAINTEXT>` and `<DATA_KEY_CIPHERTEXT>`.', commands: ["aws kms generate-data-key --key-id alias/orders --key-spec AES_256 --encryption-context app=orders --query '[Plaintext,CiphertextBlob]' --output text"] },
    { id: 'seal', title: 'What you would do with it locally', body: 'On a real machine you would encrypt the big file with the plaintext key, store the encrypted file together with `<DATA_KEY_CIPHERTEXT>`, and discard the plaintext key. The runner here only starts `aws`, so this is the shape of that step. `report.txt` stands in for the large payload.', code: { file: 'envelope.sh', text: `# local, with the plaintext data key in a variable (never written to disk)
openssl enc -aes-256-cbc -pbkdf2 -in report.txt -out report.txt.enc -pass pass:"$DATA_KEY_PLAINTEXT"
unset DATA_KEY_PLAINTEXT
# store: report.txt.enc + the encrypted data key (DATA_KEY_CIPHERTEXT)` } },
    { id: 'unwrap', title: 'Unwrap the data key later', body: "To read the file you send only the encrypted data key to KMS with the same context. The result must equal the plaintext key you saw in the previous step. KMS enforced the key policy and the context again; nothing about the file went to KMS.", commands: ['aws kms decrypt --ciphertext-blob <DATA_KEY_CIPHERTEXT> --encryption-context app=orders --query Plaintext --output text'] },
    { id: 'reenc', title: 'Re-encrypt under a new context', body: 'Change the binding of the first ciphertext from `app=orders` to `app=billing` without ever seeing the plaintext. The output is a new ciphertext, `<NEW_CIPHERTEXT>`. Decrypt it with the new context.', commands: ['aws kms re-encrypt --ciphertext-blob <CIPHERTEXT> --source-encryption-context app=orders --destination-key-id alias/orders --destination-encryption-context app=billing --query CiphertextBlob --output text', 'aws kms decrypt --ciphertext-blob <NEW_CIPHERTEXT> --encryption-context app=billing --query Plaintext --output text'] },
  ],
  breakIt: {
    title: 'Decrypting with the wrong encryption context',
    command: 'aws kms decrypt --ciphertext-blob <CIPHERTEXT> --encryption-context app=billing',
    explain: [
      "`InvalidCiphertextException`. The message is deliberately empty: KMS does not tell you whether the blob, the key or the context was wrong. The encryption context is authenticated data, so a mismatch is indistinguishable from tampering.",
      "Use this on purpose in real systems: put `tenant=<id>` or `table=<name>` in the context and a ciphertext copied into the wrong row will not decrypt. Remember the context is not secret and shows up in CloudTrail.",
    ],
  },
  realAws: {
    cost: [
      "A customer managed key is about 1 USD per month (prorated hourly) plus roughly 0.03 USD per 10,000 requests after a monthly free tier of 20,000 requests. AWS managed keys have no monthly fee. List prices as of 2026-11-15; check the KMS pricing page before relying on them.",
      "Envelope encryption is also a cost tool: one GenerateDataKey call protects an arbitrary amount of data, and S3 Bucket Keys cut KMS requests by up to 99%.",
    ],
    differences: [
      "KMS has per-account, per-Region request quotas (shared across all keys in the account) and throttles with ThrottlingException; the emulator does not throttle. Cache data keys or use the AWS Encryption SDK's caching.",
      "Real KMS keys can be multi-Region, imported (BYOK), backed by CloudHSM (custom key store) or asymmetric. This module uses a symmetric key only.",
      "Every call is logged to CloudTrail with the encryption context in plaintext. The emulator has no CloudTrail.",
    ],
    asOf: '2026-11-15',
    sources: [
      { label: 'AWS KMS concepts', url: 'https://docs.aws.amazon.com/kms/latest/developerguide/concepts.html' },
      { label: 'Encryption context', url: 'https://docs.aws.amazon.com/kms/latest/developerguide/encrypt_context.html' },
      { label: 'Envelope encryption', url: 'https://docs.aws.amazon.com/kms/latest/developerguide/kms-cryptography.html#enveloping' },
    ],
  },
  fidelity: [{ service: 'KMS', pass: 291, total: 310 }],
  files: ['report.txt'],
  checks: [
    { id: 'key', label: 'Key `alias/orders` exists, is a customer managed key and Enabled', hint: 'Run the create-key and create-alias commands in step 2.' },
    { id: 'roundtrip', label: 'You encrypted `hello KMS` with a context and decrypted it back', hint: 'Run the encrypt and decrypt steps with the same encryption context.' },
    { id: 'breakit', label: 'You saw KMS refuse a decrypt with the wrong encryption context', hint: 'Run the break-it command with app=billing.' },
    { id: 'datakey', label: 'You generated a 256-bit data key (plaintext and encrypted copy)', hint: 'Run generate-data-key with --key-spec AES_256.' },
    { id: 'unwrap', label: 'You unwrapped the encrypted data key and got the same plaintext key', hint: 'Decrypt the data key ciphertext with --encryption-context app=orders.' },
    { id: 'reencrypt', label: 'You re-encrypted a ciphertext to app=billing and decrypted it there', hint: 'Run both commands in the last step.' },
  ],
}
