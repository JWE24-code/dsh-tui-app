/**
 * Markdown to ANSI rendering, plus a small syntax highlighter for fenced code.
 *
 * The original Go client leaned on glamour and chroma. This is the same job
 * done with no dependency: the transcript is re-rendered on every frame and
 * while a reply streams in, so the renderer must tolerate a half-written
 * document (an unterminated fence, a dangling emphasis run) without throwing
 * or swallowing text.
 * @module
 */
/** Render inline spans: code, bold, italic, strikethrough, and links. */
export declare function renderInline(text: string): string;
/** Render a markdown document to styled lines at `width` columns. */
export declare function renderMarkdown(source: string, width: number): string;
