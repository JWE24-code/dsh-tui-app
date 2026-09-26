/**
 * Transcript export: turn the in-app message list into a markdown document.
 *
 * Pure and free of Harness imports, like everything under `./tui/`, so it can
 * be tested without a profile.
 * @module
 */
import { type Message } from './state.ts';
/**
 * Render a transcript as markdown.
 *
 * User turns become `## >`-quoted sections and assistant turns `##` sections.
 * An assistant turn is written in the order it happened — each tool call as a
 * checklist line between the prose it came between — because a document that
 * collects the calls at the end tells you what the agent did but not when, and
 * the reason it said the next thing is usually what the call returned.
 */
export declare function transcriptMarkdown(messages: readonly Message[], title: string): string;
