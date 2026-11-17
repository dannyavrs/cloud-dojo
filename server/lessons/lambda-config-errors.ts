import { WARM_HANDLER } from '../../shared/lessons/lambda-config-errors'
import { item, ranOk, type LessonServer } from '../lesson-kit'
import { fnConfig, readJson, readWork, seedRole } from './lambda-kit'

const STARTER = WARM_HANDLER
  .replace('let calls = 0; // module scope: survives between invokes only if the sandbox is reused\n\n', '')
  .replace('  calls += 1;\n', '')
  .replace('    calls,\n', '')

export const lambdaConfigErrors: LessonServer = {
  id: 'lambda-config-errors',
  files: { 'handler.mjs': STARTER },
  zips: { 'handler.zip': { 'handler.mjs': STARTER } },
  async fixture(ctx) { await seedRole(ctx) },
  async check(ctx) {
    const h = ctx.history
    const fn = await fnConfig(ctx, 'cfg')
    const vars = fn?.Environment?.Variables ?? {}
    const ok = readJson(ctx, 'ok.json')
    const src = readWork(ctx, 'handler.mjs')
    return [
      item('fn', 'Function `cfg` is Active with 256 MB memory and the `GREETING` variable', fn?.State === 'Active' && fn?.MemorySize === 256 && 'GREETING' in vars, 'Run the create step with --memory-size 256 and --environment.', fn ? `${fn.State}, ${fn.MemorySize} MB, timeout ${fn.Timeout}s, env ${JSON.stringify(vars)}` : 'not created'),
      item('ok', 'You invoked it and the payload shows the env var and the 256 MB memory size', Boolean(ok && ok.memory === '256' && ok.greeting === 'hello'), 'Run the happy-path invoke and write the result to ok.json.', ok ? JSON.stringify(ok) : 'no ok.json yet'),
      item('unhandled', 'You saw FunctionError: Unhandled from a handler that throws', ranOk(h, /lambda invoke[\s\S]*"mode":"throw"/, (o) => /"FunctionError":\s*"Unhandled"/.test(o)), 'Invoke with the payload {"mode":"throw"}.'),
      item('env', 'The `GREETING` variable was updated to `hola`', vars.GREETING === 'hola', 'Run update-function-configuration with Variables={GREETING=hola}.'),
      item('logs', 'You read an invocation log tail with --log-type Tail', ranOk(h, /lambda invoke[\s\S]*--log-type Tail/), 'Run the log tail step.'),
      item('breakit', 'You triggered a timeout (handler slept 5 s with a 3 s timeout)', ranOk(h, /lambda invoke[\s\S]*"mode":"sleep"/, (o) => /"FunctionError":\s*"Unhandled"/.test(o)), 'Run the break-it invoke while the timeout is still 3 seconds.'),
      item('fixed', 'The timeout is 6 s or more and the slow invoke now succeeds', (fn?.Timeout ?? 0) >= 6 && ranOk(h, /lambda invoke[\s\S]*"mode":"sleep"/, (o) => !/FunctionError/.test(o)), 'Raise the timeout (step 9) and invoke the sleep payload again.', `timeout ${fn?.Timeout ?? '?'}s`),
      item('warm', 'You deployed the counter handler and invoked it (the emulator always reports calls = 1)', src.includes('let calls') && ranOk(h, /lambda update-function-code/) && ranOk(h, /lambda invoke[\s\S]*warm\d?\.json/), 'Edit handler.mjs, update-function-code, then invoke twice.'),
    ]
  },
}
