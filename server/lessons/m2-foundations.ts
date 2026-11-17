import { CreateBucketCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { DescribeTableCommand } from '@aws-sdk/client-dynamodb'
import { item, ranOk, type LessonServer } from '../lesson-kit'

const KEYS: Record<string, number> = { 'data/c.csv': 40, 'data/d.csv': 90, 'data/e.csv': 15, 'logs/a.txt': 220, 'logs/b.txt': 60 }

export const cliFluency: LessonServer = {
  id: 'cli-fluency',
  async fixture(ctx) {
    await ctx.c.s3.send(new CreateBucketCommand({ Bucket: 'cli-lab' }))
    for (const [Key, n] of Object.entries(KEYS)) await ctx.c.s3.send(new PutObjectCommand({ Bucket: 'cli-lab', Key, Body: 'x'.repeat(n) }))
  },
  async check(ctx) {
    const h = ctx.history
    const on = (re: RegExp, out?: (s: string) => boolean) => ranOk(h, re, out)
    const formats = new Set(h.filter((r) => r.exitCode === 0 && !r.rejected).map((r) => r.command.match(/--output\s+(json|yaml|text|table)/)?.[1]).filter(Boolean))
    const tableGone = await ctx.c.ddb.send(new DescribeTableCommand({ TableName: 'cli-orders' })).then(() => false, (e) => (e as { name?: string }).name === 'ResourceNotFoundException')
    return [
      item('filter', 'You filtered a list with a JMESPath predicate ([?...])', on(/list-objects-v2[\s\S]*--query\s+\S*\[\?/, (o) => o.includes('data/')), 'Run step 3: --query "Contents[?starts_with(Key, \'data/\')].Key".'),
      item('shape', 'You reshaped output with a multiselect hash and a function (sort_by, length or max_by)', on(/--query\s+"?'?Contents\[\]\.\{/) && on(/--query\s+\S*(sort_by|length|max_by)\(/), 'Run step 2 (the {Key:Key,Size:Size} projection) and step 4.'),
      item('formats', 'You used at least two different --output formats (table, yaml, text, json)', formats.size >= 2, 'Steps 2, 3 and 4 use table, text and yaml.', [...formats].join(', ')),
      item('paginate', 'You ran --page-size, --no-paginate and --max-items against the same bucket', on(/list-objects-v2[\s\S]*--page-size\s+\d/) && on(/list-objects-v2[\s\S]*--no-paginate/) && on(/list-objects-v2[\s\S]*--max-items\s+\d/), 'Run the three commands of step 5.'),
      item('resume', 'You resumed a listing with --starting-token', on(/list-objects-v2[\s\S]*--starting-token\s+eyJ/, (o) => o.includes('"Key"')), 'Copy the NextToken from step 6, first command, into the second.'),
      item('waiter', 'You created a table, waited for it with `wait table-exists`, and it is gone again', on(/dynamodb create-table[\s\S]*cli-orders/) && on(/dynamodb wait table-exists[\s\S]*cli-orders/) && on(/dynamodb wait table-not-exists[\s\S]*cli-orders/) && tableGone, 'Run step 7 completely: create, wait, describe, delete, wait.'),
      item('quirk', 'You saw the paginator print None', on(/list-objects-v2[\s\S]*--max-items\s+\d[\s\S]*--query[\s\S]*--output\s+text/, (o) => /(^|\n)None\s*$/.test(o.trim())), 'Run the break-it command: --max-items 2 with a text-mode --query.'),
    ]
  },
}
export const FOUNDATIONS_SERVER_LESSONS: LessonServer[] = [cliFluency]
