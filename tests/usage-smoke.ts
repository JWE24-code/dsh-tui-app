/**
 * Usage-ledger smoke: folding turns into per-provider totals, and rendering
 * the `/usage` overlay from them.
 */

import { recordUsage, renderUsage, totalUsage, type UsageLedger } from '../src/usage.ts'

let passed = 0
let failed = 0
function check(name: string, condition: boolean): void {
  if (condition) {
    passed += 1
  } else {
    failed += 1
    console.error(`FAIL: ${name}`)
  }
}

// ------------------------------------------------------------- recordUsage

let ledger: UsageLedger = {}
ledger = recordUsage(ledger, 'anthropic', 1200, 300)
check('a fresh provider gets a row', ledger['anthropic']?.promptTokens === 1200)
check('completion tokens land too', ledger['anthropic']?.completionTokens === 300)
check('one turn is counted', ledger['anthropic']?.turns === 1)

ledger = recordUsage(ledger, 'anthropic', 800, 150)
check('a second turn accumulates rather than overwrites', ledger['anthropic']?.promptTokens === 2000)
check('turns keeps counting', ledger['anthropic']?.turns === 2)

ledger = recordUsage(ledger, 'openai-codex', 500, 100)
check('a second provider gets its own row', ledger['openai-codex']?.promptTokens === 500)
check('the first provider is untouched by the second', ledger['anthropic']?.promptTokens === 2000)

const before = ledger
const after = recordUsage(ledger, 'anthropic', 0, 0)
check('a turn with no measured usage records nothing', after === before)
check('and does not inflate the turn count', after['anthropic']?.turns === 2)

const negative = recordUsage(ledger, 'anthropic', -50, -10)
check('a negative delta is clamped rather than subtracted', negative === ledger)

const unnamed = recordUsage({}, '', 100, 50)
check('an empty provider id files under "unknown" rather than vanishing', unnamed['unknown']?.promptTokens === 100)

// ---------------------------------------------------------------- totalUsage

const total = totalUsage(ledger)
check('total sums every provider\'s prompt tokens', total.promptTokens === 2500)
check('total sums every provider\'s completion tokens', total.completionTokens === 550)
check('total sums every provider\'s turns', total.turns === 3)
check('an empty ledger totals to zero', totalUsage({}).promptTokens === 0)

// --------------------------------------------------------------- renderUsage

const empty = renderUsage({})
check('an empty ledger says so rather than printing an empty table', empty.includes('Nothing recorded yet'))
check('an empty ledger still carries the heading', empty.includes('Usage'))

const rendered = renderUsage(ledger)
check('the busier provider is listed', rendered.includes('anthropic'))
check('the quieter provider is listed too', rendered.includes('openai-codex'))
check('token counts are grouped with commas', rendered.includes('2,000'))
check('a total row sums every provider', rendered.includes('2,500'))
// anthropic (2000+300=2300 total) outranks openai-codex (500+100=600): the
// busier provider's row must come first.
check(
  'providers are sorted by total tokens, busiest first',
  rendered.indexOf('anthropic') < rendered.indexOf('openai-codex'),
)
check('renderUsage never fabricates a dollar figure', !rendered.includes('$'))

if (failed > 0) {
  console.error(`${String(failed)} usage checks failed`)
  process.exit(1)
}
console.log(`ok - ${String(passed)} usage checks passed`)
