import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { buildChildEnv, type EmuInfo } from '../server/env'
import { parseCommand, runAws, tokenize } from '../server/runner'

const emu: EmuInfo = { endpoint: 'https://127.0.0.1:9297', caPath: '/tmp/ca.pem', credsPath: '/tmp/creds', accessKeyId: 'EMULATORKEY', secretAccessKey: 'secret' }
const wd = mkdtempSync(path.join(tmpdir(), 'aa-wd-'))

describe('env scrubbing', () => {
  const saved = { ...process.env }
  beforeAll(() => {
    process.env.AWS_PROFILE = 'danny-prod'
    process.env.AWS_ACCESS_KEY_ID = 'AKIAREALLOOKINGKEY123'
    process.env.AWS_SECRET_ACCESS_KEY = 'real-looking-secret-value'
    process.env.AWS_SESSION_TOKEN = 'real-session-token'
    process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-should-never-leak'
    process.env.AWS_ENDPOINT_URL = 'https://evil.example.com'
  })
  afterAll(() => { for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k]; Object.assign(process.env, saved) })

  test('buildChildEnv never contains parent secrets', () => {
    const env = buildChildEnv(emu)
    const blob = JSON.stringify(env)
    for (const bad of ['danny-prod', 'AKIAREAL', 'real-looking-secret', 'real-session-token', 'sk-ant', 'evil.example.com']) expect(blob).not.toContain(bad)
    expect(env.AWS_ENDPOINT_URL).toBe(emu.endpoint)
    expect(env.AWS_PROFILE).toBeUndefined()
  })

  test('a real child process does not see the parent AWS_* or ANTHROPIC_* vars', async () => {
    const fake = path.join(wd, 'fake-aws')
    writeFileSync(fake, '#!/bin/sh\nenv\n')
    chmodSync(fake, 0o755)
    const r = await runAws('aws sts get-caller-identity', emu, wd, fake)
    expect(r.exitCode).toBe(0)
    for (const bad of ['danny-prod', 'AKIAREAL', 'real-looking-secret', 'real-session-token', 'sk-ant', 'evil.example.com', 'ANTHROPIC']) expect(r.stdout).not.toContain(bad)
    expect(r.stdout).toContain('AWS_ENDPOINT_URL=https://127.0.0.1:9297')
    expect(r.stdout).not.toContain('AWS_PROFILE')
  })

  test('inline emulator keys are passed, real-looking keys are refused', async () => {
    expect(parseCommand('AWS_ACCESS_KEY_ID=AKIAREALLOOKINGKEY123 AWS_SECRET_ACCESS_KEY=x aws s3 ls', wd).ok).toBe(false)
    const ok = parseCommand('AWS_ACCESS_KEY_ID=EMULATORABC AWS_SECRET_ACCESS_KEY=x aws s3 ls', wd)
    expect(ok.ok && ok.env.AWS_ACCESS_KEY_ID).toBe('EMULATORABC')
  })
})

describe('command parsing', () => {
  const bad = (cmd: string) => { const p = parseCommand(cmd, wd); expect(p.ok).toBe(false) }
  test('only aws is allowed', () => { bad('ls -la'); bad('curl https://example.com'); bad('') })
  test('no shell syntax', () => { bad('aws s3 ls | head'); bad('aws s3 ls && echo hi'); bad('aws s3 ls; rm -rf /'); bad('aws s3 ls > out'); bad('aws s3 ls $(whoami)'); bad('aws s3 ls `id`') })
  test('--profile and endpoint overrides are rejected', () => {
    bad('aws s3 ls --profile prod'); bad('aws s3 ls --profile=prod'); bad('aws s3 ls --endpoint-url https://s3.amazonaws.com')
    bad('aws s3 ls --endpoint-url=https://s3.amazonaws.com'); bad('aws s3 ls --no-verify-ssl'); bad('aws s3 ls --ca-bundle /etc/x')
  })
  test('configure/sso/login are blocked', () => { bad('aws configure set aws_access_key_id x'); bad('aws sso login'); bad('aws login'); bad('aws help') })
  test('paths stay inside the lesson folder', () => { bad('aws s3 cp ../../.aws/credentials s3://b/k'); bad('aws lambda create-function --zip-file fileb:///etc/passwd'); bad('aws s3 cp ~/x s3://b/k') })
  test('normal commands pass and quotes group', () => {
    const p = parseCommand(`aws dynamodb put-item --table-name Notes --item '{"pk":{"S":"a b"}}' --query "Items[].x"`, wd)
    expect(p.ok && p.argv).toEqual(['dynamodb', 'put-item', '--table-name', 'Notes', '--item', '{"pk":{"S":"a b"}}', '--query', 'Items[].x'])
    expect(parseCommand('aws logs filter-log-events --log-group-name /aws/lambda/hello', wd).ok).toBe(true)
    expect(parseCommand('aws s3 cp v1.txt s3://snap-photos/note.txt', wd).ok).toBe(true)
    expect(parseCommand('aws lambda create-function --zip-file fileb://function.zip', wd).ok).toBe(true)
    expect(parseCommand('aws configure list', wd).ok).toBe(true)
  })
  test('tokenizer reports unclosed quotes', () => { expect('error' in tokenize("aws s3 ls 'x")).toBe(true) })
})
