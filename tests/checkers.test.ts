import { describe, expect, test } from 'bun:test'
import { LESSONS } from '../shared/lessons'
import { SERVER_LESSONS } from '../server/lessons'
import { hasWildcardAction, policyAllows, sendPolicy } from '../server/lessons/kit2'
import { historyHas } from '../server/lesson-kit'
import { makeZip } from '../server/zip'
import { parseCredentialsFile } from '../server/env'

describe('lesson registry', () => {
  test('every lesson has a server fixture/checker with matching check ids', () => {
    for (const l of LESSONS) {
      const s = SERVER_LESSONS.find((x) => x.id === l.id)
      expect(s, l.id).toBeDefined()
      expect(l.checks.length).toBeGreaterThan(0)
      if (l.honesty !== 'concept') expect(l.breakIt.command.length).toBeGreaterThan(0)
      expect(l.realAws.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
})

describe('policy helpers', () => {
  const t = 'arn:aws:sns:us-east-1:000000000000:order-events'
  test('policyAllows matches service and source', () => {
    const p = sendPolicy('sns.amazonaws.com', 'arn:aws:sqs:us-east-1:000000000000:q', 'ArnEquals', t)
    expect(policyAllows(p, 'sns.amazonaws.com', t)).toBe(true)
    expect(policyAllows(p, 'sns.amazonaws.com', 'arn:aws:sns:us-east-1:000000000000:other')).toBe(false)
    expect(policyAllows(p, 's3.amazonaws.com', t)).toBe(false)
    expect(policyAllows(undefined, 'sns.amazonaws.com', t)).toBe(false)
    expect(policyAllows('not json', 'sns.amazonaws.com', t)).toBe(false)
  })
  test('hasWildcardAction', () => {
    const doc = (a: string | string[]) => encodeURIComponent(JSON.stringify({ Statement: [{ Effect: 'Allow', Action: a, Resource: '*' }] }))
    expect(hasWildcardAction(doc('*'))).toBe(true)
    expect(hasWildcardAction(doc('dynamodb:*'))).toBe(true)
    expect(hasWildcardAction(doc(['dynamodb:PutItem']))).toBe(false)
  })
  test('historyHas', () => {
    const h = [{ command: 'aws sts get-caller-identity', exitCode: 0, stdout: '', stderr: '', ms: 1, at: 1 }]
    expect(historyHas(h, /get-caller-identity/, 'command', 'ok')).toBe(true)
    expect(historyHas(h, /get-caller-identity/, 'command', 'fail')).toBe(false)
  })
})

describe('helpers', () => {
  test('zip has local header, central directory and end record', () => {
    const z = makeZip({ 'index.mjs': 'export const handler = async () => 1' })
    const dv = new DataView(z.buffer, z.byteOffset)
    expect(dv.getUint32(0, true)).toBe(0x04034b50)
    expect(dv.getUint32(z.length - 22, true)).toBe(0x06054b50)
  })
  test('credentials file parsing', () => {
    expect(parseCredentialsFile('[default]\naws_access_key_id = EMULATORAB\naws_secret_access_key = s3cr3t+/x\n')).toEqual({ accessKeyId: 'EMULATORAB', secretAccessKey: 's3cr3t+/x' })
    expect(() => parseCredentialsFile('nothing')).toThrow()
  })
})
