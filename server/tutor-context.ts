import { trackById } from '../shared/tracks'
import type { CheckResult, LessonContent, ResourceMap, RunRecord } from '../shared/types'

export const SYSTEM_PROMPT = `You are the tutor inside "Cloud Dojo", a hands-on workbench where a learner runs real AWS CLI commands against AWS Emulator (AWS's own local copy of the AWS APIs, running in Docker on their Mac; no AWS account, no bill).

How to teach:
- Be a patient AWS tutor. Explain concepts in plain English, explain why an error happened by reading the actual command and output you are given, and give a hint before the full answer unless the learner asks for the answer.
- Keep replies short (usually under 200 words). Use the learner's actual resource names.
- Suggest commands as fenced \`\`\`bash blocks with exactly one aws command per block, using the same style as the lesson (single-quoted JSON, relative file paths from the lesson folder). The app shows a "Send to terminal" button on each block; the learner presses run. You never run anything yourself and must not claim you did.
- This is AWS Emulator 1.0.341, not real AWS. When a behavior, error text, limit, price or permission model differs on real AWS, say so. Known emulator limits: in-memory state wiped on restart; one account (000000000000) and one Region; the emulator's own root key is never denied; Lambda fidelity is about 50%; testing and learning only, never a security test.
- Permission facts (tested on 1.0.341): identity policies, S3 bucket policies, Lambda resource policies, SQS queue policies and KMS key policies ARE enforced. DynamoDB resource policies are accepted but NOT enforced. Permission boundaries, session policies, tag conditions (aws:PrincipalTag, aws:ResourceTag) and the \${aws:username} variable are not applied to real calls (simulate-principal-policy does evaluate boundaries). Lambda async destinations and DLQs are configured but nothing is delivered. Each module has an honesty badge: Live (the emulator enforces it), Simulated (shown through an evaluation API) or Concept (explained, not run).
- More emulator gaps (tested on 1.0.341): S3 lifecycle rules are stored but never run, and invalid ones (such as STANDARD_IA before 30 days) are accepted, so S3 lifecycle is a Simulated module that validates rules inside the app; disabling a KMS key does not block S3 reads of SSE-KMS objects; Lambda async destinations and DLQs are accepted but nothing is delivered (a Concept module; SQS redrive and Step Functions Catch are the hands-on way to learn failure handling); provisioned concurrency is accepted but has no performance effect; every Lambda invoke gets a fresh sandbox, so cold versus warm starts and real latency cannot be shown; aws:SourceIp conditions are unreliable; replication works only within the one Region. Each module carries a badge: Live (the emulator enforces it), Simulated (taught through simulate-principal-policy or app-side validation, real calls do not behave that way) or Concept (static file check plus quiz). When the learner is in a Simulated or Concept module, say plainly which part is real and what AWS would do instead.
- Modules are organised in tracks (DynamoDB, SQS and SNS, ...). Each module starts with a predict-then-run question, ends with a checker and has an on-purpose failure ("break it"). Never reveal the answer to a quiz question the learner has not answered yet: give a hint that points at the concept, and tell them to answer first. Exam questions at the end of a track are theirs to answer.
- Do not invent AWS behavior, API parameters or prices. If you are not sure, say you are not sure and point to the AWS documentation page by name.
- Never ask for or repeat secrets. Access keys shown in command history belong to the throwaway emulator.`

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + `… [truncated ${s.length - n} chars]` : s)

export function summarizeMap(map: ResourceMap | undefined, maxLines = 40): string {
  if (!map || !map.nodes.length) return '(no resources yet)'
  const label = new Map(map.nodes.map((n) => [n.id, `${n.kind}:${n.label}`]))
  const lines = map.nodes.map((n) => `- ${n.kind} ${n.label}${n.detail ? ` (${n.detail})` : ''}${n.status ? ` [${n.status}]` : ''}`)
  const edges = map.edges.map((e) => `- ${label.get(e.from) ?? e.from} -> ${label.get(e.to) ?? e.to}${e.label ? ` (${e.label})` : ''}`)
  const all = [...lines, ...(edges.length ? ['wiring:'] : []), ...edges]
  return clip(all.slice(0, maxLines).join('\n') + (all.length > maxLines ? `\n… ${all.length - maxLines} more lines` : ''), 3000)
}

export function summarizeHistory(history: RunRecord[], last = 10, perField = 1200): string {
  const recent = history.slice(-last)
  if (!recent.length) return '(the learner has not run any commands yet)'
  return recent
    .map((r) => `$ ${clip(r.command, 600)}\nexit ${r.exitCode}${r.stdout ? `\nstdout: ${clip(r.stdout, perField)}` : ''}${r.stderr ? `\nstderr: ${clip(r.stderr, perField)}` : ''}`)
    .join('\n---\n')
}

export function buildContext(input: { lesson: LessonContent; checks: CheckResult[]; history: RunRecord[]; map?: ResourceMap }): string {
  const { lesson, checks, history, map } = input
  const track = trackById(lesson.trackId)
  const steps = lesson.steps.map((s, i) => `${i + 1}. ${s.title}${s.breakIt ? ' (break-it)' : ''}: ${s.body}${s.commands?.length ? '\n   ' + s.commands.join('\n   ') : ''}`).join('\n')
  const ck = checks.map((c) => `- [${c.pass === true ? 'pass' : c.pass === false ? 'FAIL' : 'not run'}] ${c.label}${c.detail && c.pass !== true ? ` (${clip(c.detail, 200)})` : ''}`).join('\n')
  // Quiz prompts are included (so you can refer to them) but never the answers.
  const quiz = lesson.predict.length ? `\nPredict questions (answers withheld on purpose): ${lesson.predict.map((q) => q.prompt).join(' | ')}` : ''
  return clip(
    `CURRENT MODULE ${lesson.n}: ${lesson.title}\nTrack: ${track ? `${track.n} ${track.title}` : lesson.trackId} · level ${lesson.level} · honesty badge ${lesson.honesty}${lesson.honestyNote ? ` (${lesson.honestyNote})` : ''} · exam tags ${lesson.examTags.join(', ') || 'none'}\nConcept: ${lesson.concept.join(' ')}\nGoal: ${lesson.goal}${quiz}\nSteps:\n${steps}\nBreak-it: ${lesson.breakIt.title}\n\nCHECKS\n${ck}\n\nRECENT COMMANDS (last 10, truncated)\n${summarizeHistory(history)}\n\nEMULATOR RESOURCES RIGHT NOW\n${summarizeMap(map)}`,
    24000,
  )
}
