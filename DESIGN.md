# Design

## World

A modern AWS-adjacent developer product: the AWS Management Console and Cloudscape's information architecture (top bar, breadcrumbs, service side-nav, containers, tables, status indicators, key-value panels, split panes) with the polish of Vercel, Linear and Stripe docs. Dark first, because it is used in long sittings next to a terminal; a crisp light theme exists for reading. Orange is the only accent. An assistant panel (like Amazon Q in the console) is docked on the right and is a first-class part of the workspace.

The earlier pine/kraft "field manual" direction was rejected by the user (see PRODUCT.md, Design history). Do not reintroduce its palette, Big Shoulders, Schibsted Grotesk, paper textures or sticky notes.

Unofficial: no AWS logo and no AWS icon artwork. Service tiles use original glyphs (lucide) on flat fills taken from the public AWS architecture *category colors* (compute orange, storage green, database magenta, networking violet, app-integration pink, security red). "Unofficial, built on AWS Emulator, not affiliated with AWS" stays visible in the top bar and side nav.

## Color (dark, default)

- Canvas `#0b1521`; top bar `#0f1b2a`→`#101c2c`; surface (containers) `#111f31`; raised `#16273b`; hairline `rgba(160,185,215,.14)`.
- Text `#e6edf6`; secondary `#9db0c6`; faint `#6f849c`. Secondary text is blue-tinted gray, never neutral gray.
- Accent AWS orange `#ff9900` (hover `#ffac31`, on-accent text `#16100a`): primary buttons, progress, active nav marker, focus ring.
- Info/link blue `#5aa9ff`. Status only: success `#2ea664`/text `#58c98a`, danger `#ee5a5a`, warning `#e9b44c`.
- Light theme: canvas `#f2f4f8`, surface `#fff`, text `#0f1b2a`, link `#0b63ce`, accent button stays `#ff9900` with dark text.
- Service tiles: S3/EBS storage `#6b9a1c`, DynamoDB database `#b43fc4`, Lambda compute `#e8700f`, SQS/SNS app-integration `#d6246f`, API Gateway networking `#7f4de8`, IAM/STS security `#d33a4c`, CloudWatch Logs mgmt `#d6246f`.

## Type

Geist (UI, 14px base, scale 12/13/14/16/20/28) and Geist Mono (terminal, commands, ARNs, JSON; 12.5-13px). Headings are Geist 600, tracking -0.01em, never above 1.75rem in the app shell. Tabular numerals on counts and timings. Not Inter.

## Components

- Top bar 48px: logo mark (original), service-style title, emulator status pill, unofficial notice, theme toggle.
- Breadcrumbs under the bar: `Cloud Dojo > Lessons > S3: buckets, objects, versioning`; page actions right-aligned on the same row.
- Side navigation: lessons listed like console services, each with a service tile, number and a status glyph; collapses to an icon rail; drawer on narrow screens.
- Containers: 1px hairline, 8px radius, header row with title + actions. No nested containers, no colored side stripes.
- Status indicators: icon + word (Passed, Failed, Not checked, In progress, Completed). Never color alone.
- Key-value panel at the top of each lesson (services, checks, status, fidelity).
- Command block: dark code surface, language label, Copy and Send to terminal.
- Terminal: Geist Mono on `#070d15`, traffic-free header with cwd chips, prompt glyph, exit-code and ms meta, history on up-arrow.
- Resource map: architecture-diagram tiles per service (category-color glyph tile + name + detail), orthogonal-ish connectors with arrowheads and edge labels, grouped left to right in flow order.
- Split panes: resize handle between map and terminal (pointer and arrow keys).
- Assistant panel: docked right; header (name, model, state: Ready / Thinking / Streaming / Off), context chips (Lesson, Checks n/n, Last N commands, N resources), suggested prompts, markdown with code blocks that offer Send to terminal, composer with Enter to send.

## Motion

Quiet. 120ms color/background transitions on controls; one authored moment: a new map tile eases in (ease-out-expo 240ms) and a streaming caret in the assistant. Honors reduced motion.

## M1 additions (tracks, badges, quizzes, editor)

- **Track grid** (Read): console containers in a two-column grid. Each card carries real content, not decoration: a service tile, track number chip and name, a **segmented meter** with one segment per module (orange = done, half orange = started, hairline = todo; segments say more than a ring would), the module list with number chip, title, honesty badge and minutes or status, exam-domain chips, and one primary action (Start, Continue, Review). A second action opens the track exam when the track has one. No eyebrow labels above headings.
- **Exam readiness**: two columns (SAA, DVA), one slim meter per exam domain with a percentage, below the grid. Meters use the orange accent.
- **Honesty badge**: pill with glyph and word, never colour alone. Live = ok green with a radio glyph, Simulated = warn amber with a flask, Concept = link blue with a book. 22px, or 19px compact in lists and the nav. The legend sits above the grid and on About.
- **Side nav**: grouped by track with collapsible headers (chevron, service tile, number and name, done/total). The track you are in stays open. The active module expands its steps as a quiet sub-list with the current step marked (scroll-spy); the same step feeds the breadcrumb (Track › Module › Step).
- **Predict, then run**: a container at the top of the manual, one fieldset per question, numbered like steps. Options are full-width rows with a custom radio mark (orange when selected). After "Lock in my prediction" the right option turns green with "Correct answer", a wrong pick turns red with "Your answer", and an explanation panel follows. Keyboard: native radio group, 2px orange focus ring.
- **Exam**: single column, each question in its own container with a domain chip, a sticky footer with the answered count and Submit. Results show per-domain meters at the top and explanations under every question.
- **Editor**: a drawer in the terminal pane (Geist Mono 12px on the terminal surface), line-number gutter, "Editable / Unsaved changes / Read only" state, Save (also Cmd/Ctrl+S) and Revert, and a status line such as "Saved. handler.zip rebuilt from your source." Editable files show a pencil in the Files strip. Snippets that the learner should paste are display-only blocks with a filename caption.
