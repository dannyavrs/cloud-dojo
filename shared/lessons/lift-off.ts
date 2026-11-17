import type { LessonContent } from '../types'

export const liftOff: LessonContent = {
  id: 'lift-off',
  n: '0.1',
  trackId: 'foundations',
  level: 'core',
  prereqs: [],
  estMinutes: 10,
  honesty: 'live',
  examTags: ["SAA:Secure"],
  predict: [{"id": "p1", "prompt": "You run `aws sts get-caller-identity` with an access key that the emulator never issued. What happens?", "options": ["It succeeds and shows account 000000000000", "It fails with an authentication error such as InvalidClientTokenId", "It succeeds but returns an empty account", "It silently falls back to the default credentials"], "answer": 1, "explain": "Every request is signed and the service checks the key. An unknown key never reaches your resources: you get an authentication error, not a fallback."}],
  breakItCheck: 'denied',

  title: 'Lift-off: endpoints, credentials, accounts',
  tagline: 'Prove you are talking to AWS Emulator, and learn who AWS thinks you are.',
  concept: [
    'Every AWS tool (the CLI, the SDKs, Terraform) does the same three things: pick an **endpoint** (the URL of the API), sign the request with **credentials** (an access key pair), and name a **Region**. Real AWS fills these in from your account. Here the runner points the CLI at AWS Emulator on `https://127.0.0.1:9297`, with keys the emulator generated when it started.',
    'The emulator has one account, `000000000000`, and one Region. `sts get-caller-identity` is the "who am I" call: it works with any valid credentials, needs no permissions, and is the first thing to run when something confuses you.',
  ],
  goal: 'Run get-caller-identity, see the account and ARN, then make AWS reject you on purpose.',
  steps: [
    { id: 'whoami', title: 'Ask who you are', body: 'The ARN ends in `user/emulator`: the emulator\'s own admin identity. Note the 12-digit account.', commands: ['aws sts get-caller-identity'] },
    { id: 'config', title: 'See where the settings come from', body: '`configure list` shows each setting and its source (env, config file). The runner builds this environment from scratch, so your real `~/.aws` and any real keys are never involved.', commands: ['aws configure list'] },
    { id: 'break', title: 'Break it: bad credentials', body: 'Prefix the command with a made-up key. Only keys starting with `EMULATOR` are accepted by the runner, and the emulator will refuse this one with an authentication error.', commands: ['AWS_ACCESS_KEY_ID=EMULATORBOGUSKEY0000 AWS_SECRET_ACCESS_KEY=nope aws sts get-caller-identity'], breakIt: true },
  ],
  breakIt: {
    title: 'Sign with a key AWS has never heard of',
    command: 'AWS_ACCESS_KEY_ID=EMULATORBOGUSKEY0000 AWS_SECRET_ACCESS_KEY=nope aws sts get-caller-identity',
    explain: [
      'The request was signed (SigV4) with a key that does not exist in this run, so the emulator refuses it. You should see `InvalidClientTokenId: The security token included in the request is invalid`, the same error real AWS returns for an access key it does not know.',
      'Lesson: an authentication failure (who are you?) is different from an authorization failure (are you allowed?). You will meet the second one in lesson 1.',
    ],
  },
  realAws: {
    cost: ['STS and `get-caller-identity` are free.'],
    differences: [
      'Real AWS has many Regions, and most resources live in exactly one of them. The emulator has one account and does not separate Regions.',
      'On real AWS you should not use the account root user\'s keys day to day. Use IAM Identity Center (SSO) or an IAM role, so credentials are short-lived.',
      'The emulator regenerates its keys and certificate every time it starts. Real access keys are long-lived until you rotate them.',
    ],
    asOf: '2026-11-13',
    sources: [{ label: 'AWS Emulator: pointing the SDK at the emulator', url: 'https://docs.aws.amazon.com/emulator/latest/userguide/point-sdk-to-emulator.html' }],
  },
  fidelity: [{ service: 'STS', pass: 94, total: 171 }],
  files: [],
  checks: [
    { id: 'reach', label: 'The emulator answers and you are account 000000000000', hint: 'The emulator may still be booting: look at the lamp in the header.' },
    { id: 'whoami', label: 'You ran `aws sts get-caller-identity` successfully', hint: 'Run step 1 in the terminal.' },
    { id: 'config', label: 'You ran `aws configure list`', hint: 'Run step 2 in the terminal.' },
    { id: 'denied', label: 'You triggered a rejected sign-in on purpose', hint: 'Run the break-it command (the one with the bogus key).' },
  ],
}
