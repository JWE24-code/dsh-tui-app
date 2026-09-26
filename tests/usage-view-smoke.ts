/**
 * `/usage` pane smoke: the colored dashboard drawn from usage.ts's own data.
 */

import { recordUsage, deepSeekPeakStatus, type UsageLedger } from '../src/usage.ts'
import { UsageView, renderUsagePane } from '../src/tui/usage-view.ts'
import { stripAnsi, displayWidth } from '../src/tui/text.ts'

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

// ------------------------------------------------------------------- empty

const empty = new UsageView()
const emptyLines = renderUsagePane(empty, 80).map(stripAnsi)
check('an empty view says nothing is recorded yet', emptyLines.some((line) => line.includes('Nothing recorded yet')))
check('an empty view still carries the heading', emptyLines.some((line) => line.includes('Usage')))
check('an empty view carries no section headings', !emptyLines.some((line) => line.includes('Session (5h)')))

// -------------------------------------------------------------- with data

let anthropic: UsageLedger = {}
anthropic = recordUsage(anthropic, 'anthropic', 2000, 300)
let zai: UsageLedger = {}
zai = recordUsage(zai, 'zai', 500, 100)
const lifetime: UsageLedger = { ...anthropic, ...zai }

const view = new UsageView()
view.setData(anthropic, lifetime, lifetime, undefined, 0)
const raw = renderUsagePane(view, 80)
const lines = raw.map(stripAnsi)

check('all three sections are headed', ['Session (5h)', 'Week (7d)', 'Lifetime'].every((label) => lines.some((line) => line.includes(label))))
check('a provider absent from the session window is not listed there', (() => {
  const sessionStart = lines.findIndex((line) => line.includes('Session (5h)'))
  const weekStart = lines.findIndex((line) => line.includes('Week (7d)'))
  const sessionBlock = lines.slice(sessionStart, weekStart).join('\n')
  return sessionBlock.includes('anthropic') && !sessionBlock.includes('zai')
})())
check('a provider present in a wider window is listed there', (() => {
  const weekStart = lines.findIndex((line) => line.includes('Week (7d)'))
  const lifetimeStart = lines.findIndex((line) => line.includes('Lifetime'))
  const weekBlock = lines.slice(weekStart, lifetimeStart).join('\n')
  return weekBlock.includes('anthropic') && weekBlock.includes('zai')
})())
check('token counts are grouped with commas', lines.some((line) => line.includes('2,300')))
check('no rendered line exceeds the requested width', raw.every((line) => displayWidth(stripAnsi(line)) <= 80))

// Providers keep the same color across sections: the ANSI prefix immediately
// before the literal name "anthropic" is byte-identical everywhere it appears
// (week and lifetime both list it; session does not).
const anthropicPrefixes = raw
  .filter((line) => line.includes('anthropic'))
  .map((line) => line.slice(0, line.indexOf('anthropic')))
check('anthropic appears in more than one section, so this check exercises something', anthropicPrefixes.length >= 2)
check('a provider keeps the same color in every section it appears in', new Set(anthropicPrefixes).size === 1)

// -------------------------------------------------------------- narrow width

const narrow = renderUsagePane(view, 40).map(stripAnsi)
check('a narrow width is respected, not just the default 80', narrow.every((line) => displayWidth(line) <= 40))

// ------------------------------------------------------- DeepSeek peak strip

const peakMoment = Date.UTC(2024, 0, 3, 2, 0, 0) // Wednesday, inside a peak window
const peakStatus = deepSeekPeakStatus(peakMoment)
const withPeak = new UsageView()
withPeak.setData({}, {}, { deepseek: { promptTokens: 10, completionTokens: 5, turns: 1 } }, peakStatus, peakMoment)
const peakLines = renderUsagePane(withPeak, 80).map(stripAnsi)
check('a peak status shows the peak warning', peakLines.some((line) => line.includes('peak pricing now')))
check('the peak line carries a countdown to off-peak', peakLines.some((line) => /in \d+h \d+m|in \d+m/.test(line)))

const offPeakMoment = Date.UTC(2024, 0, 3, 5, 0, 0) // the gap between the two peak windows
const offPeakStatus = deepSeekPeakStatus(offPeakMoment)
const withOffPeak = new UsageView()
withOffPeak.setData({}, {}, { deepseek: { promptTokens: 10, completionTokens: 5, turns: 1 } }, offPeakStatus, offPeakMoment)
const offPeakLines = renderUsagePane(withOffPeak, 80).map(stripAnsi)
check('an off-peak status shows the off-peak line', offPeakLines.some((line) => line.includes('off-peak now')))

const noPeakInfo = new UsageView()
noPeakInfo.setData({}, {}, { deepseek: { promptTokens: 10, completionTokens: 5, turns: 1 } }, undefined, 0)
const noPeakLines = renderUsagePane(noPeakInfo, 80).map(stripAnsi)
check('no peak status at all means no peak line is drawn', !noPeakLines.some((line) => line.includes('peak')))

if (failed > 0) {
  console.error(`${String(failed)} usage-view checks failed`)
  process.exit(1)
}
console.log(`ok - ${String(passed)} usage-view checks passed`)
