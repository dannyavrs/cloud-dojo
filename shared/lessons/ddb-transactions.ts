import type { LessonContent } from '../types'

const GET_BOTH = `aws dynamodb transact-get-items --transact-items '[{"Get":{"TableName":"Bank","Key":{"PK":{"S":"ACCT#alice"},"SK":{"S":"BAL"}}}},{"Get":{"TableName":"Bank","Key":{"PK":{"S":"ACCT#bob"},"SK":{"S":"BAL"}}}}]' --query 'Responses[].Item.bal.N' --output text`

export const ddbTransactions: LessonContent = {
  id: 'ddb-transactions',
  n: '3.5',
  trackId: 'dynamodb',
  level: 'advanced',
  prereqs: ['ddb-conditional'],
  estMinutes: 30,
  honesty: 'live',
  examTags: ['DVA:Dev', 'SAA:Resilient'],
  breakItCheck: 'breakit',
  editable: ['transfer.json'],
  title: 'Transactions and idempotency',
  tagline: 'Move money between two items all-or-nothing, and make a retry safe.',
  predict: [
    { id: 'p1', prompt: "A transaction debits alice (condition: balance >= amount) and credits bob. alice has too little money. What state are the two items in afterwards?", options: ["alice unchanged, bob credited", "Both unchanged: the whole transaction is cancelled", "alice debited to zero, bob credited the difference", "Both changed, and a compensating write is queued"], answer: 1, explain: "TransactWriteItems is all-or-nothing. One failed condition cancels every write in the request with TransactionCanceledException." },
    { id: 'p2', prompt: "You send the exact same TransactWriteItems request twice with the same ClientRequestToken, within the idempotency window. How many times is it applied?", options: ["Twice", "Once; the second call returns success without changing anything", "Once; the second call fails with an error", "It depends on the table's capacity mode"], answer: 1, explain: "The token makes the call idempotent for 10 minutes. A retry after a timeout therefore cannot double-apply the transfer." },
    { id: 'p3', prompt: "How much write capacity does a transactional write of a 1 KB item cost compared with a standard write?", options: ["The same", "Twice as much (two units)", "Half", "Ten times"], answer: 1, explain: "Transactions use a two-phase prepare and commit, so each item costs 2 write units (and transactional reads cost 2 read units)." },
  ],
  concept: [
    "`BatchWriteItem` sends many writes in one call but gives **no atomicity**: some can succeed while others fail. When items must change together (a transfer, an order plus its inventory decrement, a unique-username claim), use **transactions**. `TransactWriteItems` accepts up to 100 `Put`, `Update`, `Delete` and `ConditionCheck` actions across items and tables, and either **all** are applied or **none**, with serializable isolation.",
    "Each action can carry its own condition. In this module the debit has `bal >= :x`. If that fails the whole request is cancelled with `TransactionCanceledException`, and the error lists a **cancellation reason per item** (`ConditionalCheckFailed` for alice, `None` for bob), so you know which one blocked it.",
    "Networks fail. If a call times out you do not know whether it applied, and retrying could move the money twice. **Idempotency** solves that: pass a `ClientRequestToken` (a unique string you generate once per logical operation). DynamoDB remembers the token for 10 minutes. Replaying the same request with the same token returns success without re-applying, while the same token with a *different* request is rejected with `IdempotentParameterMismatch`. The pattern: generate the token before the first attempt and reuse it on every retry.",
    "Know the limits the exams like to ask about: 100 items and 4 MB per transaction, no two actions on the same item, all items in the same Region and account, and double the capacity cost. `TransactGetItems` gives you a consistent snapshot of several items, which a series of separate `GetItem` calls cannot.",
  ],
  goal: "alice 30 and bob 70: a 60 transfer, a 10 transfer replayed with the same token (applied once), a snapshot read, and an overdraw that was cancelled with both balances untouched.",
  steps: [
    { id: 'read', title: 'Read both balances as one snapshot', body: "The fixture created table `Bank` with `ACCT#alice` = 100 and `ACCT#bob` = 0. `transact-get-items` reads both in one consistent snapshot. Output order matches the request: alice first.", commands: [GET_BOTH] },
    { id: 'look', title: 'Read transfer.json', body: "Open `transfer.json` in Files. Two `Update` actions: debit alice with the condition `bal >= :x`, credit bob. The amount `:x` appears in both, so the two halves can never disagree." },
    { id: 'move60', title: 'Transfer 60 with an idempotency token', body: "Pass a token you generate yourself. After this alice has 40 and bob has 60.", commands: [`aws dynamodb transact-write-items --transact-items file://transfer.json --client-request-token t-60`] },
    { id: 'edit10', title: 'Change the amount to 10 and transfer again', body: "In the editor change **both** `\"N\": \"60\"` values to `\"10\"` and Save, then run it with a **new** token. alice 30, bob 70.", commands: [`aws dynamodb transact-write-items --transact-items file://transfer.json --client-request-token t-10`] },
    { id: 'replay', title: 'Replay it: the same token, the same request', body: "Pretend the response got lost and the client retries. It succeeds, but the balances do not move again. Read them to check: still 30 and 70.", commands: [`aws dynamodb transact-write-items --transact-items file://transfer.json --client-request-token t-10`, GET_BOTH] },
    { id: 'break', title: 'Break it: overdraw', body: "Edit the amount back to **60** (both places), Save, and use a new token. alice has only 30, so her condition fails and the whole transaction is cancelled. Read the balances: bob did **not** get 60.", commands: [`aws dynamodb transact-write-items --transact-items file://transfer.json --client-request-token t-over`, GET_BOTH], breakIt: true },
  ],
  breakIt: {
    title: 'Overdraw: one failed condition cancels both writes',
    command: `aws dynamodb transact-write-items --transact-items file://transfer.json --client-request-token t-over`,
    explain: [
      "`TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [ConditionalCheckFailed, None]`. The first reason belongs to alice's debit, the second (`None`) to bob's credit that would have been fine on its own. Neither write was applied: balances are still 30 and 70.",
      "Contrast `batch-write-item`: it would have applied the credit and rejected the debit, minting money. Whenever invariants span items, you want a transaction. And on real AWS, if the same token is reused with a different payload you get `IdempotentParameterMismatch`, not a silent success.",
    ],
  },
  realAws: {
    cost: [
      "Transactional operations cost twice as much: a transactional write of a 1 KB item is 2 write units, a transactional read of up to 4 KB is 2 read units. Failed transactions are billed too.",
      "At on-demand rates (about $0.625 per million write units, us-east-1) a 100-item transaction is 200 units at minimum. Use transactions for the few operations that need them, not as a default.",
    ],
    differences: [
      "The 10-minute idempotency window and the limits (100 actions, 4 MB, one action per item) are the real AWS rules. The emulator does not enforce every limit.",
      "On real AWS a transaction can also fail with `TransactionConflict` when another request touches the same item concurrently, and with throttling. The sequential commands here never conflict.",
      "`TransactionInProgressException` and `IdempotentParameterMismatch` exist on real AWS; whether the emulator raises them is not part of this lesson's checks.",
    ],
    asOf: '2026-11-13',
    sources: [{ label: 'Amazon DynamoDB Transactions', url: 'https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html' }, { label: 'DynamoDB on-demand pricing', url: 'https://aws.amazon.com/dynamodb/pricing/on-demand/' }],
  },
  fidelity: [{ service: 'DynamoDB', pass: 1057, total: 1481 }],
  files: ['transfer.json'],
  checks: [
    { id: 'seed', label: 'Table `Bank` has both accounts', hint: 'The fixture creates it. Press Reset module if it is missing.' },
    { id: 'applied', label: 'Balances are alice 30 and bob 70 (60 then 10, each applied once)', hint: 'Run the 60 transfer, then change the file to 10 and run it with a new token.' },
    { id: 'replay', label: 'You replayed a transfer with the same client request token', hint: 'Run the same command and token twice (step 5).' },
    { id: 'snapshot', label: 'You read the balances with transact-get-items', hint: 'Run step 1 or the read in step 5.' },
    { id: 'breakit', label: 'You saw TransactionCanceledException and the balances did not change', hint: 'Set the amount to 60 again and run the break-it command.' },
  ],
}
