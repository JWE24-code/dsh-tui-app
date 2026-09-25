/**
 * Smoke tests for MCP tool grouping and the `/mcp` pane body.
 */
import assert from 'node:assert/strict'
import { groupMcpTools, parseMcpToolName, renderMcp } from '../src/tui/mcp.ts'

let checks = 0
function check(label: string, condition: boolean): void {
  assert.ok(condition, label)
  checks += 1
}

// ---------------------------------------------------------------- parsing

check('the double-underscore form parses', parseMcpToolName('mcp__github__create_issue')?.server === 'github')
check(
  'the double-underscore tool keeps its own underscores',
  parseMcpToolName('mcp__github__create_issue')?.tool === 'create_issue',
)
check('the single-underscore form parses', parseMcpToolName('mcp_linear_list_issues')?.server === 'linear')
check('the slash form parses', parseMcpToolName('files/read')?.server === 'files')
check('the colon form parses', parseMcpToolName('db:query')?.server === 'db')
check('a plain tool name is not MCP', parseMcpToolName('shell') === undefined)
check('a plain path is not mistaken for a server', parseMcpToolName('src/tui/state.ts') === undefined)
check('a bare prefix is not enough', parseMcpToolName('mcp__') === undefined)
check('a trailing separator is rejected', parseMcpToolName('mcp__server__') === undefined)
check('a nameless server is rejected', parseMcpToolName('mcp_') === undefined)

// -------------------------------------------------------------- grouping

const grouped = groupMcpTools([
  'mcp__zeta__b',
  'mcp__zeta__a',
  'mcp__alpha__only',
  'shell',
  'read',
  'files/read',
])
check('only MCP tools are grouped', grouped.length === 3)
check('servers come back alphabetically', grouped[0]?.name === 'alpha')
check('the second server is next', grouped[1]?.name === 'files')
check(
  'tools inside a server are sorted',
  grouped[2]?.tools.length === 2 && grouped[2]?.tools[0] === 'a' && grouped[2]?.tools[1] === 'b',
)
check('a server with one tool still lists it', grouped[0]?.tools[0] === 'only')
check('no MCP tools means no servers', groupMcpTools(['shell', 'read']).length === 0)

// ------------------------------------------------------------- rendering

const empty = renderMcp([], 12)
check('the empty case names the tool count', empty.includes('12 tools in total'))
check('the empty case explains where servers live', empty.includes('cordis.patch.yml'))
check('the empty case offers the plugin command', empty.includes('dsh plugin'))
check('an empty registry says so', renderMcp([], 0).includes('no tool registry'))

const body = renderMcp(grouped, 20)
check('the body counts servers', body.includes('3 servers'))
check('the body counts tools', body.includes('4 tools'))
check('a server name is shown', body.includes('alpha'))
check('a tool is listed under its server', body.includes('`only`'))
check(
  'tools are nested under their server',
  body.indexOf('- **alpha**') < body.indexOf('`only`'),
)

console.log(`ok - ${String(checks)} mcp checks passed`)
