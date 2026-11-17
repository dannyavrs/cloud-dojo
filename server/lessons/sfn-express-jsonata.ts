import { JSONATA_ASL } from '../../shared/lessons/sfn-express-jsonata'
import { item, ranFail, ranOk, type LessonServer } from '../lesson-kit'
import { definition, seedSfnRoles } from './sfn-kit'

export const sfnExpressJsonata: LessonServer = {
  id: 'sfn-express-jsonata',
  files: { 'workflow.asl.json': JSONATA_ASL },
  async fixture(ctx) { await seedSfnRoles(ctx) },
  async check(ctx) {
    const h = ctx.history
    const quote = await definition(ctx, 'quote')
    const std = await definition(ctx, 'quote-std')
    const syncOn = (word: string) => ranOk(h, /start-sync-execution[\s\S]*:stateMachine:quote(\s|$)/, (o) => /SUCCEEDED/.test(o) && o.includes(word))
    return [
      item('express', 'An Express state machine `quote` exists and uses JSONata', quote?.type === 'EXPRESS' && quote.def?.QueryLanguage === 'JSONata', 'Run the create-state-machine step with --type EXPRESS.'),
      item('sync', 'A synchronous run returned SUCCEEDED with the `small` branch', syncOn('small'), 'Run start-sync-execution with the first input before changing the limit.'),
      item('large', 'After lowering the limit, a synchronous run took the `large` branch', syncOn('large'), 'Edit the limit to 3, update the machine and run the sync call again.'),
      item('teststate', 'test-state returned SUCCEEDED for a JSONata state', ranOk(h, /test-state/, (o) => /SUCCEEDED/.test(o) && /"output": "2"/.test(o)) && ranOk(h, /test-state/, (o) => /"nextState": "Large"/.test(o)), 'Run the two test-state commands.'),
      item('breakit', 'You saw start-sync-execution refused on a Standard machine', std?.type === 'STANDARD' && ranFail(h, /start-sync-execution[\s\S]*quote-std/, /StateMachineTypeNotSupported/), 'Create quote-std and run the synchronous call on it.'),
    ]
  },
}
