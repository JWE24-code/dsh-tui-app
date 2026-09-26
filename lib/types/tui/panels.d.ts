/**
 * Trust-surface panels: tool approval, `ask_user_question`, plan review, and a
 * running sign-in.
 *
 * These are the moments something stops and asks a human — the agent, or a
 * `ctx.authorization` flow doing its own OAuth dance — so they own the
 * keyboard while open and answer through the Harness's own seams. Like the
 * rest of `tui/`, this module is pure state plus a view shape — the app layer
 * does the Cordis wiring and the renderer does the drawing.
 * @module
 */
/** One selectable row in a panel. */
export interface PanelRow {
    label: string;
    description?: string;
    /** Highlighted by the cursor. */
    selected: boolean;
    /** Multi-select state; undefined for a single-select row. */
    checked?: boolean;
}
/**
 * The panel the renderer draws in place of the transcript.
 *
 * `detail` is markdown: an approval's reason, a question's supporting text, a
 * plan under review, or a sign-in flow's own notice.
 */
export interface PanelView {
    kind: 'approval' | 'questions' | 'login';
    title: string;
    detail: string;
    rows: PanelRow[];
    hint: string;
    /** Extra lines under the rows: the free-text line and its draft. */
    inputLabel?: string;
    inputText?: string;
    inputFocused?: boolean;
}
/**
 * Read a spoken (transcribed) answer as an approval decision.
 *
 * Deliberately narrow: a misheard sentence must never grant a tool call, so
 * only unambiguous words decide and anything else returns `undefined`, leaving
 * the panel waiting. Both shipped interface languages are accepted.
 */
export declare function interpretApproval(text: string): ApprovalDecision | undefined;
/** What the user decided about one approval request. */
export type ApprovalDecision = 'allowed-once' | 'rejected';
/**
 * One pending tool approval.
 *
 * There is no persistent grant in the protocol — "allow once" or deny — so the
 * panel offers exactly those two rows and no "always" temptation.
 */
export declare class ApprovalPanel {
    selected: number;
    readonly toolName: string;
    readonly reason: string | undefined;
    private readonly command;
    constructor(toolName: string, reason: string | undefined, command: string | undefined);
    move(delta: number): void;
    decision(): ApprovalDecision;
    view(): PanelView;
}
/** One question as the answerer receives it. */
export interface QuestionSpec {
    id: string;
    question: string;
    detail?: string;
    header?: string;
    options?: readonly {
        label: string;
        description?: string;
    }[];
    multiSelect?: boolean;
    intent?: {
        kind: 'plan-review';
        approve: string;
    };
}
/** One answered question, in the shape the Harness expects back. */
export interface QuestionAnswer {
    id: string;
    selected: string[];
    custom?: string;
}
/** Raised when the user backs out of a question set; the service maps it to `ASK_CANCELLED`. */
export declare const ASK_CANCELLED_CODE = "ASK_CANCELLED";
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
export declare class QuestionsPanel {
    index: number;
    focus: 'options' | 'custom';
    private readonly drafts;
    private readonly questions;
    constructor(questions: readonly QuestionSpec[]);
    private get question();
    private get draft();
    /** Whether this set is a plan under review rather than a question. */
    get isPlanReview(): boolean;
    move(delta: number): void;
    /** Space toggles the highlighted option on a multi-select question. */
    toggle(): void;
    focusCustom(): void;
    /** Type into the free-text line; on an option row the option joins the answer. */
    typeText(chunk: string): void;
    backspaceText(): void;
    /**
     * Commit the current question and move on.
     *
     * @returns `'next'` when another question follows, `'done'` when the set is
     *   answered, and `'empty'` when nothing has been chosen yet.
     */
    advance(): 'next' | 'done' | 'empty';
    /** Step back one question, keeping what was already chosen. */
    back(): boolean;
    /** The finished answer set, in question order. */
    answers(): QuestionAnswer[];
    view(): PanelView;
}
/** One notice a running `ctx.authorization` flow reported, mid-attempt. */
export interface LoginNotice {
    message: string;
    url?: string;
    code?: string;
}
/** One question a running flow needs answered before it can continue. */
export type LoginPrompt = {
    kind: 'text' | 'secret';
    message: string;
    placeholder?: string;
} | {
    kind: 'select';
    message: string;
    options: readonly {
        id: string;
        label: string;
        description?: string;
    }[];
};
/**
 * One running `ctx.authorization` attempt, surfaced as a panel.
 *
 * Deliberately thin: this tracks only what is on screen — the last notice,
 * the live prompt if one is waiting, and what has been typed or highlighted
 * for it. Resolving a prompt is the caller's job, the same split
 * {@link ApprovalPanel} and {@link QuestionsPanel} keep, because answering one
 * is a call into the Harness and this module may depend on nothing from it.
 */
export declare class LoginPanel {
    readonly label: string;
    notice: LoginNotice | undefined;
    prompt: LoginPrompt | undefined;
    private cursor;
    private draft;
    constructor(label: string);
    /**
     * Put a fresh prompt on screen, or clear it once it has been answered.
     * Starts from empty every time — a stale draft or highlight from the
     * question before it must never bleed into this one.
     */
    setPrompt(prompt: LoginPrompt | undefined): void;
    move(delta: number): void;
    typeText(chunk: string): void;
    backspaceText(): void;
    /** What `enter` would answer the live prompt with, or undefined for none waiting. */
    answer(): string | undefined;
    view(): PanelView;
}
