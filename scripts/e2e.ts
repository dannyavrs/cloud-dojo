/**
 * End-to-end: for every core lesson, start it on a fresh emulator, assert the checker is
 * not fully green, replay the lesson's real commands through the real runner, then assert green.
 *   bun scripts/e2e.ts [lessonId ...]
 */
import './guard-data-dir'
import { Dojo } from '../server/app'
import { SERVER_LESSONS } from '../server/lessons'
import { lessonById, LESSONS } from '../shared/lessons'
import { TRACKS } from '../shared/tracks'
import { solution } from '../server/lessons/capstone'
import { makeKit, A, q, sleep, log } from './e2e-kit'
import { M2_E2E } from './e2e-m2'
import { M3_E2E } from './e2e-m3'

const app = new Dojo(() => ({ enabled: false, model: '', source: 'none' }))
const only = process.argv.slice(2)
const { sh, C, code, edit, json, sub } = makeKit(app)
const kit = makeKit(app)

const scripts: Record<string, (id: string) => Promise<void>> = {
  ...Object.fromEntries(Object.entries({ ...M2_E2E, ...M3_E2E }).map(([k, f]) => [k, (id: string) => f(id, kit)])),
  'ddb-single-table': async (id) => {
    for (const s of ['load', 'orders', 'collection', 'newest']) await sh(id, C(id, s))
    await sh(id, C(id, 'break'), true)
  },
  'ddb-indexes': async (id) => {
    edit(id, 'table.json', (t) => { const j = JSON.parse(t); j.LocalSecondaryIndexes = JSON.parse(`{${code(id, 'edit')}}`).LocalSecondaryIndexes; return JSON.stringify(j, null, 2) })
    await sh(id, C(id, 'create', 0)); await sh(id, C(id, 'create', 1))
    for (const s of ['load', 'gsi', 'lsi']) await sh(id, C(id, s))
    await sh(id, C(id, 'late', 0))
    for (let i = 0; i < 20; i++) { if ((await sh(id, C(id, 'late', 1))).stdout.includes('ACTIVE')) break; await sleep(500) }
    await sh(id, C(id, 'late', 2))
    await sh(id, C(id, 'break'), true)
  },
  'ddb-conditional': async (id) => {
    await sh(id, C(id, 'read')); await sh(id, C(id, 'a')); await sh(id, C(id, 'b'), true)
    await sh(id, C(id, 'retry', 0)); await sh(id, C(id, 'retry', 1))
    await sh(id, C(id, 'counter')); await sh(id, C(id, 'counter')); await sh(id, C(id, 'init'))
  },
  'ddb-transactions': async (id) => {
    log('   balances:', (await sh(id, C(id, 'read'))).stdout.trim())
    await sh(id, C(id, 'move60'))
    edit(id, 'transfer.json', (t) => t.replaceAll('"60"', '"10"'))
    await sh(id, C(id, 'edit10'))
    await sh(id, C(id, 'replay', 0))
    log('   balances after replay:', (await sh(id, C(id, 'replay', 1))).stdout.trim())
    edit(id, 'transfer.json', (t) => t.replaceAll('"10"', '"60"'))
    await sh(id, C(id, 'break', 0), true)
    log('   balances after cancelled overdraw:', (await sh(id, C(id, 'break', 1))).stdout.trim())
  },
  'ddb-streams-ttl': async (id) => {
    const arn = json(await sh(id, C(id, 'look')))[0] as string
    await sh(id, C(id, 'fn', 0)); await sh(id, C(id, 'fn', 1))
    await sh(id, sub(C(id, 'esm'), { STREAM_ARN: arn }))
    await sleep(10000)
    for (let i = 0; i < 3; i++) await sh(id, C(id, 'writes', i))
    await sleep(10000)
    log('   logs:', (await sh(id, C(id, 'logs'))).stdout.trim().replace(/\s+/g, ' ').slice(0, 220))
    await sh(id, C(id, 'ttl'))
    await sh(id, C(id, 'expire', 0)); await sh(id, C(id, 'expire', 1))
    await sleep(25000)
    log('   items left:', (await sh(id, C(id, 'verify'))).stdout.trim())
  },
  'ddb-query-scan': async (id) => {
    for (const s of ['count', 'filter', 'scan']) log('  ', (await sh(id, C(id, s))).stdout.replace(/\s+/g, ' ').trim())
    const p1 = json(await sh(id, C(id, 'page1')))
    log('   page1 count', p1.count, 'has key', Boolean(p1.LastEvaluatedKey))
    const p2 = json(await sh(id, sub(C(id, 'page2'), { LAST_KEY: JSON.stringify(p1.LastEvaluatedKey) })))
    log('   page2 count', p2.count, 'key', p2.LastEvaluatedKey)
    for (let i = 0; i < 2; i++) log('  ', (await sh(id, C(id, 'cap', i))).stdout.replace(/\s+/g, ' ').trim())
    await sh(id, C(id, 'partiql'))
    await sh(id, C(id, 'break'), true)
  },
  'sqs-visibility': async (id) => {
    const handle = (r: { stdout: string }) => json(r).Messages[0].ReceiptHandle as string
    await sh(id, C(id, 'first'))
    log('   hidden:', JSON.stringify((await sh(id, C(id, 'hidden'))).stdout.trim()))
    await sleep(9500)
    const again = await sh(id, C(id, 'again'))
    log('   again:', again.stdout.replace(/\s+/g, ' ').slice(0, 200))
    await sh(id, sub(C(id, 'delete'), { RECEIPT_HANDLE: handle(again) }))
    await sh(id, C(id, 'extend', 0))
    const r2 = await sh(id, C(id, 'extend', 1))
    await sh(id, sub(C(id, 'extend', 2), { RECEIPT_HANDLE: handle(r2) }))
    log('   long poll while extended:', JSON.stringify((await sh(id, C(id, 'extend', 3))).stdout.trim()))
    await sh(id, C(id, 'delayq', 0)); await sh(id, C(id, 'delayq', 1))
    log('   immediate receive on delay queue:', JSON.stringify((await sh(id, C(id, 'delayq', 2))).stdout.trim()))
    log('   long poll:', (await sh(id, C(id, 'long'))).stdout.trim())
  },
  'sqs-dlq-redrive': async (id) => {
    edit(id, 'redrive.json', (t) => t.replace('\\"maxReceiveCount\\":\\"5\\"', '\\"maxReceiveCount\\":\\"2\\"'))
    await sh(id, C(id, 'edit', 0)); await sh(id, C(id, 'edit', 1))
    await sh(id, C(id, 'send'))
    for (let i = 0; i < 3; i++) log(`   receive ${i + 1}:`, (await sh(id, C(id, 'fail'))).stdout.replace(/\s+/g, ' ').slice(0, 120) || '(nothing)')
    log('   dlq peek:', (await sh(id, C(id, 'peek', 0))).stdout.replace(/\s+/g, ' ').slice(0, 160))
    await sh(id, C(id, 'peek', 1))
    await sh(id, C(id, 'redrive', 0)); await sleep(4000)
    log('   move tasks:', (await sh(id, C(id, 'redrive', 1))).stdout.replace(/\s+/g, ' ').slice(0, 200))
    log('   orders now:', (await sh(id, C(id, 'verify'))).stdout.replace(/\s+/g, ' '))
  },
  'sqs-fifo': async (id) => {
    await sh(id, C(id, 'create'))
    for (let i = 0; i < 4; i++) await sh(id, C(id, 'send', i))
    log('   order:', (await sh(id, C(id, 'receive'))).stdout.trim())
    for (let i = 0; i < 4; i++) await sh(id, C(id, 'groups', i))
    log('   first:', (await sh(id, C(id, 'lane', 0))).stdout.trim(), '| rest:', (await sh(id, C(id, 'lane', 1))).stdout.trim())
    await sh(id, C(id, 'break'), true)
  },
  'sns-filter-fanout': async (id) => {
    for (let i = 0; i < 3; i++) await sh(id, C(id, 'subscribe', i))
    const arns = (await sh(id, C(id, 'arns'))).stdout.trim().split('\n').map((l) => l.split(/\s+/))
    const arnOf = (q: string) => arns.find((r) => r[0].endsWith(`:${q}`))![1]
    edit(id, 'filter-shipping.json', () => code(id, 'fix'))
    const v = { BILLING_SUB_ARN: arnOf('billing'), SHIPPING_SUB_ARN: arnOf('shipping') }
    await sh(id, sub(C(id, 'attach', 0), v)); await sh(id, sub(C(id, 'attach', 1), v))
    for (let i = 0; i < 3; i++) await sh(id, C(id, 'publish', i))
    await sleep(1500)
    for (let i = 0; i < 3; i++) log(`   ${['billing', 'shipping', 'audit'][i]}:`, (await sh(id, C(id, 'read', i))).stdout.trim().replace(/\s+/g, ' | '))
    await sh(id, C(id, 'body', 0))
    const arns2 = (await sh(id, C(id, 'arns'))).stdout.trim().split('\n').map((l) => l.split(/\s+/))
    const bodyArn = arns2.find((r) => r[0].endsWith(':bodyq'))![1]
    await sh(id, sub(C(id, 'body', 1), { BODYQ_SUB_ARN: bodyArn })); await sh(id, sub(C(id, 'body', 2), { BODYQ_SUB_ARN: bodyArn }))
    await sh(id, C(id, 'body', 3)); await sh(id, C(id, 'body', 4)); await sleep(1500)
    log('   bodyq:', (await sh(id, C(id, 'body', 5))).stdout.trim().replace(/\s+/g, ' | '))
    await sh(id, C(id, 'break', 0)); await sh(id, C(id, 'break', 1)); await sleep(1500)
    log('   quarantine:', JSON.stringify((await sh(id, C(id, 'break', 2))).stdout.trim()))
  },
  'sqs-lambda-batch': async (id) => {
    log('   rebuilt zips:', edit(id, 'handler.mjs', () => code(id, 'edit').replace(/^```.*$/gm, '')).join(','))
    await sh(id, C(id, 'fn', 0)); await sh(id, C(id, 'fn', 1))
    await sh(id, C(id, 'break'), true)
    await sh(id, C(id, 'vis')); await sh(id, C(id, 'esm'))
    await sleep(5000)
    await sh(id, C(id, 'send'))
    await sleep(30000)
    log('   dlq:', (await sh(id, C(id, 'dlq'))).stdout.trim())
  },
  'lift-off': async (id) => {
    await sh(id, 'aws sts get-caller-identity')
    await sh(id, 'aws configure list')
    await sh(id, 'AWS_ACCESS_KEY_ID=EMULATORBOGUSKEY0000 AWS_SECRET_ACCESS_KEY=nope aws sts get-caller-identity', true)
  },
  'iam-intern': async (id) => {
    await sh(id, 'aws iam create-user --user-name intern')
    await sh(id, 'aws iam put-user-policy --user-name intern --policy-name read-only-photos --policy-document file://intern-read-only.json')
    const k = (await sh(id, "aws iam create-access-key --user-name intern --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text")).stdout.trim().split(/\s+/)
    const as = `AWS_ACCESS_KEY_ID=${k[0]} AWS_SECRET_ACCESS_KEY=${k[1]}`
    await sh(id, `${as} aws s3api get-object --bucket snap-photos --key hello.txt hello-copy.txt`)
    await sh(id, `${as} aws s3api delete-object --bucket snap-photos --key hello.txt`, true)
    await sh(id, 'aws iam simulate-principal-policy --policy-source-arn arn:aws:iam::000000000000:user/intern --action-names s3:GetObject s3:DeleteObject --resource-arns arn:aws:s3:::snap-photos/hello.txt --query "EvaluationResults[].[EvalActionName,EvalDecision]" --output text')
  },
  's3-versioning': async (id) => {
    await sh(id, 'aws s3api create-bucket --bucket snap-photos')
    await sh(id, 'aws s3api put-bucket-versioning --bucket snap-photos --versioning-configuration Status=Enabled')
    await sh(id, 'aws s3 cp v1.txt s3://snap-photos/note.txt')
    await sh(id, 'aws s3 cp v2.txt s3://snap-photos/note.txt')
    const out = (await sh(id, "aws s3api list-object-versions --bucket snap-photos --prefix note.txt --query 'Versions[].[VersionId,IsLatest]' --output text")).stdout.trim().split('\n').map((l) => l.split(/\s+/))
    const old = out.find((r) => r[1] === 'False')![0]
    await sh(id, `aws s3api get-object --bucket snap-photos --key note.txt --version-id ${old} restored.txt`)
    await sh(id, 'aws s3api create-bucket --bucket AB', true)
  },
  'dynamodb-notes': async (id) => {
    await sh(id, 'aws dynamodb create-table --table-name Notes --attribute-definitions AttributeName=pk,AttributeType=S AttributeName=sk,AttributeType=S --key-schema AttributeName=pk,KeyType=HASH AttributeName=sk,KeyType=RANGE --billing-mode PAY_PER_REQUEST')
    await sh(id, 'aws dynamodb wait table-exists --table-name Notes')
    for (const [pk, sk, t] of [['user#danny', 'note#001', 'learn IAM'], ['user#danny', 'note#002', 'learn S3'], ['user#sam', 'note#001', 'hello']]) {
      await sh(id, `aws dynamodb put-item --table-name Notes --item '{"pk":{"S":"${pk}"},"sk":{"S":"${sk}"},"text":{"S":"${t}"}}'`)
    }
    await sh(id, `aws dynamodb query --table-name Notes --key-condition-expression "pk = :p" --expression-attribute-values '{":p":{"S":"user#danny"}}' --query 'Items[].text.S'`)
    await sh(id, `aws dynamodb put-item --table-name Notes --item '{"pk":{"S":"user#danny"},"sk":{"S":"note#001"},"text":{"S":"overwritten!"}}' --condition-expression "attribute_not_exists(pk)"`, true)
  },
  'lambda-roles': async (id) => {
    await sh(id, 'aws iam create-role --role-name lambda-exec --assume-role-policy-document file://trust.json')
    await sh(id, 'aws lambda create-function --function-name hello --runtime nodejs22.x --handler index.handler --role arn:aws:iam::000000000000:role/lambda-exec --zip-file fileb://function.zip')
    await sh(id, 'aws lambda wait function-active-v2 --function-name hello')
    await sh(id, `aws lambda invoke --function-name hello --cli-binary-format raw-in-base64-out --payload '{"name":"Danny"}' out.json`)
    const lg = await sh(id, `aws lambda invoke --function-name hello --log-type Tail --cli-binary-format raw-in-base64-out --payload '{"name":"Danny"}' --query LogResult --output text out.json`)
    log('   logs:', lg.stdout.trim().slice(-160).replace(/\n/g, ' | '))
    await sh(id, 'aws lambda create-function --function-name writer --runtime nodejs22.x --handler writer.handler --role arn:aws:iam::000000000000:role/lambda-exec --zip-file fileb://writer.zip')
    await sh(id, 'aws lambda wait function-active-v2 --function-name writer')
    const r = await sh(id, `aws lambda invoke --function-name writer --cli-binary-format raw-in-base64-out --payload '{"text":"from lambda"}' writer-out.json`)
    log('   invoke (before policy):', r.stdout.replace(/\s+/g, ' ').slice(0, 120), '|', (await Bun.file(`${app.ctx(id).workdir}/writer-out.json`).text()).slice(0, 200))
    await sh(id, 'aws iam put-role-policy --role-name lambda-exec --policy-name notes-put --policy-document file://writer-policy.json')
    await sleep(1000)
    await sh(id, `aws lambda invoke --function-name writer --cli-binary-format raw-in-base64-out --payload '{"text":"from lambda"}' writer-out.json`)
    log('   invoke (after policy):', (await Bun.file(`${app.ctx(id).workdir}/writer-out.json`).text()).slice(0, 200))
  },
  'sns-sqs': async (id) => {
    const t = `arn:aws:sns:us-east-1:${A}:order-events`
    await sh(id, 'aws sqs create-queue --queue-name orders-a')
    await sh(id, 'aws sqs create-queue --queue-name orders-b')
    await sh(id, 'aws sns create-topic --name order-events')
    for (const n of ['a', 'b']) await sh(id, `aws sns subscribe --topic-arn ${t} --protocol sqs --notification-endpoint arn:aws:sqs:us-east-1:${A}:orders-${n} --attributes RawMessageDelivery=true`)
    await sh(id, `aws sns publish --topic-arn ${t} --message '{"order":1}'`)
    const e = await sh(id, `aws sqs receive-message --queue-url ${q('orders-a')} --wait-time-seconds 2`)
    log('   receive before policy (expect empty):', JSON.stringify(e.stdout.trim()))
    for (const n of ['a', 'b']) await sh(id, `aws sqs set-queue-attributes --queue-url ${q('orders-' + n)} --attributes file://attrs-${n}.json`)
    await sh(id, `aws sns publish --topic-arn ${t} --message '{"order":2}'`)
    for (const n of ['a', 'b']) log('   queue', n, (await sh(id, `aws sqs receive-message --queue-url ${q('orders-' + n)} --wait-time-seconds 2 --query 'Messages[].Body' --output text`)).stdout.trim())
  },
  's3-sqs-lambda': async (id) => {
    await sh(id, 'aws s3api put-bucket-notification-configuration --bucket snap-photos --notification-configuration file://notification.json', true)
    await sh(id, `aws sqs set-queue-attributes --queue-url ${q('photo-jobs')} --attributes file://queue-policy.json`)
    await sh(id, 'aws s3api put-bucket-notification-configuration --bucket snap-photos --notification-configuration file://notification.json')
    await sh(id, `aws lambda create-event-source-mapping --function-name photo-worker --event-source-arn arn:aws:sqs:us-east-1:${A}:photo-jobs --batch-size 1`, true)
    await sh(id, 'aws iam attach-role-policy --role-name lambda-exec --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaSQSQueueExecutionRole')
    await sleep(1500)
    await sh(id, `aws lambda create-event-source-mapping --function-name photo-worker --event-source-arn arn:aws:sqs:us-east-1:${A}:photo-jobs --batch-size 1`)
    await sleep(4000)
    await sh(id, 'aws s3 cp photo.txt s3://snap-photos/uploads/photo.txt')
    await sleep(8000)
    log('   logs:', (await sh(id, `aws logs filter-log-events --log-group-name /aws/lambda/photo-worker --query 'events[].message' --output text`)).stdout.trim().slice(0, 200))
  },
  'http-api': async (id) => {
    await sh(id, 'aws lambda add-permission --function-name hello-api --statement-id apigw --action lambda:InvokeFunction --principal apigateway.amazonaws.com')
    const out = JSON.parse((await sh(id, `aws apigatewayv2 create-api --name notes-api --protocol-type HTTP --target arn:aws:lambda:us-east-1:${A}:function:hello-api`)).stdout)
    const get = await app.ctx(id).httpGet(out.ApiEndpoint + '/')
    log('   GET', out.ApiEndpoint, get.status, get.body.slice(0, 100))
    const br = JSON.parse((await sh(id, `aws apigatewayv2 create-api --name broken-api --protocol-type HTTP --target arn:aws:lambda:us-east-1:${A}:function:broken-api`)).stdout)
    const get2 = await app.ctx(id).httpGet(br.ApiEndpoint + '/')
    log('   GET broken-api:', get2.status, get2.body.slice(0, 100))
  },
  capstone: async () => {
    for (let i = 0; i < solution.length; i++) { const r = await app.showMe(); log(`  show-me ${r.step}/${r.total}: ${r.title}`) }
    await sleep(4000)
    for (const r of await app.checks('capstone', true)) for (const x of r.sub ?? []) if (!x.pass) log(`     sub ✘ ${r.id}: ${x.label}`)
  },
}

const failures: string[] = []
const summary: string[] = []
for (const sl of SERVER_LESSONS) {
  if (only.length && !only.includes(sl.id)) continue
  const content = lessonById(sl.id)!
  log(`\n=== ${content.n} ${content.title}`)
  try {
    const t0 = Date.now()
    await app.startLesson(sl.id, { fresh: true })
    log(`  fresh cloud + fixture in ${Date.now() - t0} ms`)
    const before = await app.checks(sl.id, true)
    log('  BEFORE:', before.map((c) => (c.pass ? '✔' : '✘') + c.id).join(' '))
    if (before.every((c) => c.pass)) throw new Error('checker already green before doing anything')
    await scripts[sl.id](sl.id)
    let after = await app.checks(sl.id, true)
    if (!after.every((c) => c.pass)) { await sleep(5000); after = await app.checks(sl.id, true) }
    log('  AFTER: ', after.map((c) => (c.pass ? '✔' : '✘') + c.id).join(' '))
    for (const c of after.filter((c) => !c.pass)) log(`     ✘ ${c.label} :: ${c.detail ?? ''}`)
    if (!after.every((c) => c.pass)) throw new Error('checker not green after solution')
    summary.push(`PASS ${sl.id}`)
  } catch (e) {
    failures.push(sl.id)
    summary.push(`FAIL ${sl.id}: ${e instanceof Error ? e.message : e}`)
    log('  !!', e instanceof Error ? e.message : e)
  }
}
// quizzes grade locally and deterministically, with no emulator
try {
  for (const l of LESSONS) for (const q of l.predict) {
    if (app.predict(l.id, q.id, q.answer)?.correct !== true) throw new Error(`${l.id}/${q.id}: right answer graded wrong`)
    if (app.predict(l.id, q.id, (q.answer + 1) % q.options.length)?.correct !== false) throw new Error(`${l.id}/${q.id}: wrong answer graded right`)
  }
  for (const t of TRACKS.filter((x) => x.exam)) {
    const right = app.exam(t.id, Object.fromEntries(t.exam!.map((q) => [q.id, q.answer])))!
    const wrong = app.exam(t.id, {})!
    if (right.score !== right.total || wrong.score !== 0) throw new Error(`${t.id}: exam grading is off`)
    app.exam(t.id, Object.fromEntries(t.exam!.map((q) => [q.id, q.answer]))) // leave the right answers recorded
  }
  summary.push('PASS quizzes grade correctly (predict + exam)')
} catch (e) { failures.push('quizzes'); summary.push(`FAIL quizzes: ${e instanceof Error ? e.message : e}`) }
const view = app.progressView()
log('\nprogress:', view.tracks.filter((t) => t.done).map((t) => `${t.id} ${t.done}/${t.total}`).join(', '))
log('capabilities:', (app.capabilities?.capabilities ?? []).map((c) => `${c.key}=${c.enforced ? 'yes' : 'NO'}`).join(' '))
log('\n' + summary.join('\n'))
await app.emu.stop()
process.exit(failures.length ? 1 : 0)
