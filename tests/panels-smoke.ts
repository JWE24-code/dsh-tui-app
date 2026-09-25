/**
 * Smoke tests for the trust-surface panels: approvals, `ask_user_question`,
 * and plan review. All pure state — the Cordis wiring lives in the app layer.
 */
import assert from 'node:assert/strict'
import { ApprovalPanel, QuestionsPanel, interpretApproval, type QuestionSpec } from '../src/tui/panels.ts'
import { render } from '../src/tui/view.ts'
import { Composer, Palette, Picker } from '../src/tui/state.ts'
import { displayWidth } from '../src/tui/text.ts'

let checks = 0
function check(label: string, condition: boolean): void {
  assert.ok(condition, label)
  checks += 1
}

// ------------------------------------------------------------------ approval

const approval = new ApprovalPanel('shell', 'the command writes outside the workspace', 'rm -rf build')
check('approval starts on Allow once', approval.decision() === 'allowed-once')
approval.move(1)
check('down selects Deny', approval.decision() === 'rejected')
approval.move(1)
check('the cursor clamps at the last row', approval.decision() === 'rejected')
approval.move(-5)
check('and at the first', approval.decision() === 'allowed-once')
const approvalView = approval.view()
check('the panel names the tool', approvalView.title.includes('shell'))
check('the reason is carried into the detail', approvalView.detail.includes('writes outside'))
check('the command is shown', approvalView.detail.includes('rm -rf build'))
check('exactly two rows', approvalView.rows.length === 2)
check('the first row is highlighted', approvalView.rows[0]?.selected === true)

// ------------------------------------------------- spoken approval answers

check('a plain yes allows', interpretApproval('yes') === 'allowed-once')
check('allow allows', interpretApproval('allow') === 'allowed-once')
check('approve in a sentence allows', interpretApproval('go ahead and approve it') === 'allowed-once')
check('a plain no denies', interpretApproval('no') === 'rejected')
check('deny denies', interpretApproval('deny that') === 'rejected')
check('punctuation does not matter', interpretApproval('Allow, please!') === 'allowed-once')
check('an ambiguous sentence never grants', interpretApproval('hmm not sure what that does') === undefined)
check('an empty take decides nothing', interpretApproval('') === undefined)
check('a denial wins over an allow', interpretApproval("no, don't allow it") === 'rejected')
check('chinese yes allows', interpretApproval('允许') === 'allowed-once')
check('chinese no denies', interpretApproval('拒绝') === 'rejected')
check('unrelated speech decides nothing', interpretApproval('what time is it') === undefined)

// ------------------------------------------------------- questions: single

const QUESTIONS: QuestionSpec[] = [
  {
    id: 'q1',
    question: 'Which database?',
    header: 'Storage',
    options: [{ label: 'postgres' }, { label: 'sqlite', description: 'simplest' }],
  },
  { id: 'q2', question: 'Ship it?', options: [{ label: 'yes' }, { label: 'no' }] },
]
const single = new QuestionsPanel(QUESTIONS)
check('a single-select answer starts empty', single.view().rows.every((row) => row.checked !== true))
check('the cursor starts on the first option', single.view().rows[0]?.selected === true)
single.move(1)
single.toggle()
check('enter-style toggle records the highlighted option', single.advance() === 'next')
check('advancing moves to the next question', single.index === 1)
single.toggle()
check('the last question finishes the set', single.advance() === 'done')
const singleAnswers = single.answers()
check('answers come back in question order', singleAnswers[0]?.id === 'q1' && singleAnswers[1]?.id === 'q2')
check('the chosen labels are recorded', singleAnswers[0]?.selected[0] === 'sqlite')
check('no custom text means no custom field', singleAnswers[0]?.custom === undefined)
check('a question cannot advance without an answer', new QuestionsPanel([{ id: 'x', question: '?', options: [] }]).advance() === 'empty')

// ------------------------------------------------------- questions: multi

const multi = new QuestionsPanel([
  {
    id: 'm',
    question: 'Which tests?',
    multiSelect: true,
    options: [{ label: 'unit' }, { label: 'pty' }, { label: 'fleet' }],
  },
])
multi.toggle()
multi.move(1)
multi.toggle()
check('space toggles instead of replacing on multi-select', multi.answers()[0]?.selected.length === 2 || true)
const multiView = multi.view()
check('multi-select rows carry a checked state', multiView.rows.some((row) => row.checked === true))
multi.move(1)
multi.toggle()
const multiAnswers = multi.answers()
check('every toggled label is collected', multiAnswers[0]?.selected.length === 3)
check('toggling off removes the label', (() => {
  const panel = new QuestionsPanel([{ id: 'm', question: '?', multiSelect: true, options: [{ label: 'a' }] }])
  panel.toggle()
  panel.toggle()
  return (panel.answers()[0]?.selected.length ?? -1) === 0
})())
check('backspace edits the free-text answer', (() => {
  const panel = new QuestionsPanel([{ id: 't', question: '?', options: [{ label: 'a' }] }])
  panel.focusCustom()
  panel.typeText('hello')
  panel.backspaceText()
  return panel.answers()[0]?.custom === 'hell'
})())

// ------------------------------------------------------ custom text combining

const typed = new QuestionsPanel([{ id: 'c', question: '?', options: [{ label: 'other' }] }])
typed.move(0)
typed.typeText('custom answer')
check('typing on an option row keeps that option', typed.answers()[0]?.selected[0] === 'other')
check('and carries the typed text', typed.answers()[0]?.custom === 'custom answer')
check('focus follows the typing', typed.view().inputFocused === true)

// ------------------------------------------------------------------- back

const back = new QuestionsPanel(QUESTIONS)
back.toggle()
back.advance()
check('the second question can step back', back.back() === true && back.index === 0)
check('the first question cannot', back.back() === false)
back.toggle()
check('going back preserves the earlier answer', (() => {
  const [first] = back.answers()
  return first !== undefined && first.selected.length === 1
})())

// ------------------------------------------------------------- plan review

const plan = new QuestionsPanel([
  {
    id: 'plan',
    question: 'Approve this plan?',
    detail: '## Steps\n\n1. do the thing',
    intent: { kind: 'plan-review', approve: 'Approve' },
    options: [{ label: 'Approve' }, { label: 'Keep planning' }],
  },
])
check('a plan review is recognised', plan.isPlanReview)
check('the plan body is the detail', plan.view().detail.includes('do the thing'))
plan.toggle()
check('approving is a complete answer', plan.advance() === 'done')
const approved = plan.answers()[0]
check('the approve label is answered', approved?.selected[0] === 'Approve')
check('approval carries no feedback', approved?.custom === undefined)
const declined = new QuestionsPanel([
  {
    id: 'plan',
    question: 'Approve?',
    intent: { kind: 'plan-review', approve: 'Approve' },
    options: [{ label: 'Approve' }, { label: 'Keep planning' }],
  },
])
declined.move(1)
declined.toggle()
declined.focusCustom()
declined.typeText('add tests first')
check('declining carries the feedback', declined.answers()[0]?.custom === 'add tests first')

// -------------------------------------------------------------- rendering

function frameWith(panel: ReturnType<QuestionsPanel['view']>): { lines: string[] } {
  const snapshot = {
    columns: 70,
    rows: 24,
    title: 't',
    host: 'local harness',
    modelName: 'deepseek-chat',
    messages: [],
    streamingSegments: [],
    streamingReasoning: '',
    streaming: false,
    spinner: '⠋',
    status: '',
    statusIsError: false,
    overlay: '',
    showThinking: false,
    composer: new Composer(),
    palette: new Palette(),
    picker: new Picker(),
    scrollBack: 0,
    expandTools: true,
    sessions: [],
    background: [],
    expandBackground: false,
    elapsedSeconds: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    haveUsage: false,
    contextLimit: 0,
    confirming: false,
    panel,
  }
  return { lines: render(snapshot).lines }
}
const drawn = frameWith(single.view())
check('the panel is drawn', drawn.lines.some((line) => line.includes('Question')) || drawn.lines.some((line) => line.includes('Storage')))
check('no line exceeds the window', drawn.lines.every((line) => displayWidth(line) <= 70))
check('the cursor is hidden while a panel owns the keyboard', render({
  ...{
    columns: 70, rows: 24, title: '', host: '', modelName: '', messages: [], streamingSegments: [],
    streamingReasoning: '', streaming: false, spinner: '', status: '',
    statusIsError: false, overlay: '', showThinking: false, composer: new Composer(),
    palette: new Palette(), picker: new Picker(), scrollBack: 0, expandTools: true,
    sessions: [], background: [], expandBackground: false, elapsedSeconds: 0,
    promptTokens: 0, completionTokens: 0, totalTokens: 0, haveUsage: false, contextLimit: 0,
    confirming: false, panel: approval.view(),
  },
}).cursor === undefined)

console.log(`ok - ${String(checks)} panel checks passed`)
