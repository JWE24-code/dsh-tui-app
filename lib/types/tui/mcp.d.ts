/**
 * `/mcp` formatting: which MCP servers' tools are actually mounted.
 *
 * The MCP client is a composition-level plugin — servers are declared in the
 * profile, not registered through a queryable runtime API — so the honest view
 * is the tool registry filtered to MCP-provided names. This module does the
 * naming and grouping; the app layer does the probing.
 * @module
 */
/** One MCP server and the tools it contributed. */
export interface McpServer {
    name: string;
    tools: string[];
}
/**
 * The separator conventions MCP bridges use in tool names.
 *
 * `mcp__server__tool` is the Claude-style double-underscore form; `server/tool`
 * and `server:tool` appear in some bridges. Parsing all three means a server
 * shows up whichever bridge mounted it.
 */
export declare function parseMcpToolName(name: string): {
    server: string;
    tool: string;
} | undefined;
/** Group tool names into their MCP servers, alphabetically by server then tool. */
export declare function groupMcpTools(toolNames: readonly string[]): McpServer[];
/**
 * The `/mcp` overlay body.
 *
 * @param servers - grouped MCP tools, from {@link groupMcpTools}.
 * @param totalTools - every tool the registry offers, for the empty case.
 */
export declare function renderMcp(servers: readonly McpServer[], totalTools: number): string;
