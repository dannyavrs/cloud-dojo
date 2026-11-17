import { expect, test } from 'bun:test'
import { LESSONS } from '../shared/lessons'
import { TRACKS } from '../shared/tracks'

const VALID = new Set(['SAA:Secure', 'SAA:Resilient', 'SAA:Performant', 'SAA:Cost', 'DVA:Dev', 'DVA:Sec', 'DVA:Deploy', 'DVA:Troubleshoot'])

test('every exam-domain tag on modules, tracks and exam questions is a known SAA/DVA domain', () => {
  const tags = [
    ...LESSONS.flatMap((l) => l.examTags.map((t) => `${l.id}: ${t}`)),
    ...LESSONS.flatMap((l) => l.predict.flatMap((q) => (q.tag ? [`${l.id}/${q.id}: ${q.tag}`] : []))),
    ...TRACKS.flatMap((t) => t.exams.map((x) => `${t.id}: ${x}`)),
    ...TRACKS.flatMap((t) => (t.exam ?? []).map((q) => `${t.id}/${q.id}: ${q.tag}`)),
  ]
  for (const t of tags) expect(VALID.has(t.split(': ')[1]), t).toBe(true)
})
