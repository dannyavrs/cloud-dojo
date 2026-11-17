import { DescribeKeyCommand } from '@aws-sdk/client-kms'
import { REPORT_TXT } from '../../shared/lessons/kms-envelope'
import { item, ranFail, ranOk, type LessonServer } from '../lesson-kit'

/** Plaintext used by the module: base64 of "hello KMS". */
const PLAIN = 'aGVsbG8gS01T'

export const kmsEnvelope: LessonServer = {
  id: 'kms-envelope',
  files: { 'report.txt': REPORT_TXT },
  async check(ctx) {
    const h = ctx.history
    // State: the key behind alias/orders is a customer managed, enabled key.
    const meta = (await ctx.c.kms.send(new DescribeKeyCommand({ KeyId: 'alias/orders' })).catch(() => undefined))?.KeyMetadata
    const keyOk = meta?.KeyManager === 'CUSTOMER' && meta.KeyState === 'Enabled'
    // History: values are compared on the server and never returned (they can be plaintext keys).
    const roundtrip = ranOk(h, /kms encrypt .*--encryption-context/) && ranOk(h, /kms decrypt .*--encryption-context\s+app=orders/, (o) => o.trim() === PLAIN)
    const breakit = ranFail(h, /kms decrypt/, /InvalidCiphertextException/)
    const dk = h.find((r) => !r.rejected && r.exitCode === 0 && /kms generate-data-key\b/.test(r.command) && /AES_256/.test(r.command) && r.stdout.trim().split(/\s+/).length >= 2)
    const [dkPlain] = dk ? dk.stdout.trim().split(/\s+/) : ['']
    const datakey = Boolean(dk) && dkPlain.length === 44
    const unwrap = datakey && ranOk(h, /kms decrypt/, (o) => o.trim() === dkPlain)
    const reenc = h.find((r) => !r.rejected && r.exitCode === 0 && /kms re-encrypt/.test(r.command) && /destination-encryption-context\s+app=billing/.test(r.command) && r.stdout.trim().length > 40)
    const reencrypt = Boolean(reenc) && ranOk(h, /kms decrypt .*--encryption-context\s+app=billing/, (o) => o.trim() === PLAIN)
    return [
      item('key', 'Key `alias/orders` exists, is a customer managed key and Enabled', keyOk, 'Run the create-key and create-alias commands in step 2.', meta ? `${meta.KeyManager}, ${meta.KeyState}` : 'alias not found'),
      item('roundtrip', 'You encrypted `hello KMS` with a context and decrypted it back', roundtrip, 'Run the encrypt and decrypt steps with the same encryption context.'),
      item('breakit', 'You saw KMS refuse a decrypt with the wrong encryption context', breakit, 'Run the break-it command with app=billing.'),
      item('datakey', 'You generated a 256-bit data key (plaintext and encrypted copy)', datakey, 'Run generate-data-key with --key-spec AES_256.'),
      item('unwrap', 'You unwrapped the encrypted data key and got the same plaintext key', unwrap, 'Decrypt the data key ciphertext with --encryption-context app=orders.'),
      item('reencrypt', 'You re-encrypted a ciphertext to app=billing and decrypted it there', reencrypt, 'Run both commands in the last step.'),
    ]
  },
}
