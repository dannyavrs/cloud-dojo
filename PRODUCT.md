# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Bun runtime and package manager; Vite + React + TypeScript SPA with Tailwind and shadcn/ui; a Bun HTTP server that owns the AWS Emulator container. (Set by the repo's AGENTS.md; init answers inferred from the build brief, not interviewed — the session was non-interactive.)

## Users

Danny, a single learner who says "I don't fully know how to use AWS properly." Sits at a Mac, wants to type real `aws` commands and watch real state change, without an AWS account, a bill, or the fear of leaving something running. Secondary audience: anyone cloning the repo to learn the same way.

## Product Purpose

Cloud Dojo is a hands-on course for the core of AWS, organised as tracks of independent modules (credentials, IAM, S3, DynamoDB, Lambda, SQS+SNS, event wiring, API Gateway, and a capstone). The DynamoDB and SQS+SNS tracks go to an intermediate and advanced, SAA/DVA exam-aligned depth and end with a track exam. Every lesson runs real AWS CLI/SDK commands against AWS Emulator (AWS's own local copy of the AWS APIs) in Docker. Success: the learner finishes a lesson with a green checker, has seen the real AWS error on purpose, and knows what the same thing costs and does on real AWS.

## Positioning

The cloud that can't bill you, with AWS's real error messages and a live map of what you built. Neighbouring tools (LocalStack, moto) are fakes written by third parties; this one is AWS's own emulator generated from the SDK API models, and the app is honest about where it falls short (in-memory, one account/region, no enforcement of DynamoDB resource policies, permission boundaries or tag conditions on real calls, Lambda ~50% parity) and labels every module Live, Simulated or Concept.

## Constraints

- Learning/testing only; never a security test. State is in memory and wiped on restart.
- The command runner executes only `aws`, with an environment built from scratch, so real AWS credentials can never reach a lesson.
- The tutor is bring-your-own-key and provider-agnostic. The key lives in the browser's localStorage (or optionally `.env.local` LLM_* vars), is sent per request to the local server, and is never logged, stored or echoed.
- Never claim precise real-AWS prices that were not verified against AWS pricing pages.

## Voice

Patient, plain-English, console-literate. Names the action on controls; errors name the problem and the recovery. Status words are the console's own: Passed, Failed, In progress, Not checked.

## Design history

The first build used a pine-green / kraft-paper "field manual" look (Big Shoulders Display, Schibsted Grotesk, crayon marks, sticky-note resource map). Danny rejected it: "I don't like this design, it should look more modern, like tech companies' design, and way more similar to AWS. Make it modern and AI-ready." Why it failed: it was a craft-world metaphor for a product whose users already live in the AWS console and modern dev tools; the metaphor made the app look like a toy next to the thing it teaches. That palette and those faces are rejected for this app and must not come back. The replacement is an AWS-console-adjacent developer product (see DESIGN.md).

## Surfaces

- Track grid (tracks, modules, honesty badges, progress, exam readiness), About/docs: Read.
- Module workspace (manual with predict questions, checker, terminal, starter-file editor, resource map, tutor): Operate.
- Track exam: Operate (a task: answer, submit, learn from the explanations).
