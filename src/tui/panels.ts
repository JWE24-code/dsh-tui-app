/**
 * Trust-surface panels: tool approval, `ask_user_question`, and plan review.
 *
 * These are the moments the agent stops and asks a human, so they own the
 * keyboard while open and answer through the Harness waterfall seams. Like the
 * rest of `tui/`, this module is pure state plus a view shape — the app layer
 * does the Cordis wiring and the renderer does the drawing.
 * @module
 */

/** One selectable row in a panel. */
export interface PanelRow {
  label: string
  description?: string
  /** Highlighted by the cursor. */
  selected: boolean
  /** Multi-select state; undefined for a single-select row. */
  checked?: boolean
}

/**
 * The panel the renderer draws in place of the transcript.
 *
 * `detail` is markdown: an approval's reason, a question's supporting text, or
 * a plan under review.
 */
export interface PanelView {
  kind: 'approval' | 'questions'
  title: string
  detail: string
  rows: PanelRow[]
  hint: string
  /** Extra lines under the rows: the free-text line and its draft. */
  inputLabel?: string
  inputText?: string
  inputFocused?: boolean
}

/** What the user decided about one approval request. */
export type ApprovalDecision = 'allowed-once' | 'rejected'

/**
 * One pending tool approval.
 *
 * There is no persistent grant in the protocol — "allow once" or deny — so the
 * panel offers exactly those two rows and no "always" temptation.
 */
export class ApprovalPanel {
  selected = 0
  readonly toolName: string
  readonly reason: string | undefined
  private readonly command: string | undefined

  constructor(toolName: string, reason: string | undefined, command: string | undefined) {
    this.toolName = toolName
    this.reason = reason
    this.command = command
  }

  move(delta: number): void {
    this.selected = this.selected + delta < 0 ? 0 : Math.min(this.selected + delta, 1)
  }

  decision(): ApprovalDecision {
    return this.selected === 0 ? 'allowed-once' : 'rejected'
  }

  view(): PanelView {
    const detail = [this.reason ?? '', this.command === undefined ? '' : `\`\`\`sh\n${this.command}\n\`\`\``]
      .filter((part) => part !== '')
      .join('\n\n')
    return {
      kind: 'approval',
      title: `Allow ${this.toolName}?`,
      detail,
      rows: [
        { label: 'Allow once', description: 'run this one call', selected: this.selected === 0 },
        { label: 'Deny', description: 'the agent is told no', selected: this.selected === 1 },
      ],
      hint: '↑↓ move · enter choose · 1 allow · 2 deny · esc denies',
    }
  }
}

/** One question as the answerer receives it. */
export interface QuestionSpec {
  id: string
  question: string
  detail?: string
  header?: string
  options?: readonly { label: string; description?: string }[]
  multiSelect?: boolean
  intent?: { kind: 'plan-review'; approve: string }
}

/** One answered question, in the shape the Harness expects back. */
export interface QuestionAnswer {
  id: string
  selected: string[]
  custom?: string
}

/** Raised when the user backs out of a question set; the service maps it to `ASK_CANCELLED`. */
export const ASK_CANCELLED_CODE = 'ASK_CANCELLED'

interface Draft {
  selected: string[]
  custom: string
  cursor: number
}

/**
 * The `ask_user_question` flow, question by question.
 *
 * Single-select answers on `enter`; multi-select toggles with `space` and
 * collects with `enter`; `tab` moves to the free-text line, and typing on an
 * option row combines that option's label with the text, the way a form does.
 * A plan review is the same shape with a markdown body and an approve label
 * named by the protocol — approval never carries feedback, because the
 * protocol reads feedback as "keep planning".
 */
export class QuestionsPanel {
  index = 0
  focus: 'options' | 'custom' = 'options'
  private readonly drafts = new Map<string, Draft>()
  private readonly questions: readonly QuestionSpec[]

  constructor(questions: readonly QuestionSpec[]) {
    this.questions = questions
    for (const question of questions) {
      this.drafts.set(question.id, { selected: [], custom: '', cursor: 0 })
    }
  }

  private get question(): QuestionSpec | undefined {
    return this.questions[this.index]
  }

  private get draft(): Draft {
    const question = this.question
    if (question === undefined) return { selected: [], custom: '', cursor: 0 }
    let draft = this.drafts.get(question.id)
    if (draft === undefined) {
      draft = { selected: [], custom: '', cursor: 0 }
      this.drafts.set(question.id, draft)
    }
    return draft
  }

  /** Whether this set is a plan under review rather than a question. */
  get isPlanReview(): boolean {
    return this.question?.intent?.kind === 'plan-review'
  }

  move(delta: number): void {
    const options = this.question?.options ?? []
    if (options.length === 0) return
    this.focus = 'options'
    const next = this.draft.cursor + delta
    this.draft.cursor = next < 0 ? 0 : Math.min(next, options.length - 1)
  }

  /** Space toggles the highlighted option on a multi-select question. */
  toggle(): void {
    const question = this.question
    const options = question?.options ?? []
    const option = options[this.draft.cursor]
    if (question === undefined || option === undefined) return
    if (question.multiSelect !== true) {
      this.draft.selected = [option.label]
      return
    }
    const at = this.draft.selected.indexOf(option.label)
    if (at === -1) this.draft.selected.push(option.label)
    else this.draft.selected.splice(at, 1)
  }

  focusCustom(): void {
    this.focus = 'custom'
  }

  /** Type into the free-text line; on an option row the option joins the answer. */
  typeText(chunk: string): void {
    const question = this.question
    const options = question?.options ?? []
    const option = options[this.draft.cursor]
    if (this.focus === 'options' && option !== undefined && question?.multiSelect !== true) {
      this.draft.selected = [option.label]
    }
    this.focus = 'custom'
    this.draft.custom += chunk
  }

  backspaceText(): void {
    this.focus = 'custom'
    this.draft.custom = this.draft.custom.slice(0, -1)
  }

  /**
   * Commit the current question and move on.
   *
   * @returns `'next'` when another question follows, `'done'` when the set is
   *   answered, and `'empty'` when nothing has been chosen yet.
   */
  advance(): 'next' | 'done' | 'empty' {
    const question = this.question
    if (question === undefined) return 'done'
    const draft = this.draft
    const hasAnswer = draft.selected.length > 0 || draft.custom.trim() !== ''
    if (!hasAnswer) return 'empty'
    if (this.index + 1 < this.questions.length) {
      this.index += 1
      this.focus = 'options'
      return 'next'
    }
    return 'done'
  }

  /** Step back one question, keeping what was already chosen. */
  back(): boolean {
    if (this.index === 0) return false
    this.index -= 1
    this.focus = 'options'
    return true
  }

  /** The finished answer set, in question order. */
  answers(): QuestionAnswer[] {
    return this.questions.map((question) => {
      const draft = this.drafts.get(question.id) ?? { selected: [], custom: '', cursor: 0 }
      const custom = draft.custom.trim()
      const approve = question.intent?.kind === 'plan-review' && draft.selected[0] === question.intent.approve
      return {
        id: question.id,
        selected: draft.selected,
        // Approval must not carry feedback: the protocol reads it as a
        // request to keep planning instead of a decision.
        custom: custom === '' || approve ? undefined : custom,
      }
    })
  }

  view(): PanelView {
    const question = this.question
    const options = question?.options ?? []
    const draft = this.draft
    const rows: PanelRow[] = options.map((option, index) => ({
      label: option.label,
      description: option.description,
      selected: this.focus === 'options' && index === draft.cursor,
      checked: question?.multiSelect === true ? draft.selected.includes(option.label) : undefined,
    }))
    const total = this.questions.length
    const title =
      question?.header ?? (total > 1 ? `Question ${String(this.index + 1)} of ${String(total)}` : 'Question')
    const hint = this.isPlanReview
      ? '↑↓ move · enter decide · type feedback to keep planning · esc back'
      : question?.multiSelect === true
        ? '↑↓ move · space toggle · enter next · tab type an answer · esc back'
        : '↑↓ move · enter choose · tab type an answer · esc back'
    return {
      kind: 'questions',
      title,
      detail: question?.detail === undefined ? (question?.question ?? '') : `${question.question}\n\n${question.detail}`,
      rows,
      hint: this.index === 0 ? `${hint} · esc cancels` : hint,
      inputLabel: 'Answer',
      inputText: draft.custom,
      inputFocused: this.focus === 'custom',
    }
  }
}
