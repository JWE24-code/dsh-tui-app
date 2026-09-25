/** Preview a tool-heavy turn — the case that motivated collapsing. */
import { Composer, Palette, Picker, textMessage } from '../src/tui/state.ts'
import { render, type Snapshot } from '../src/tui/view.ts'

const expand = process.argv[2] === 'expand'
const tools = ['bash', 'bash', 'bash', 'bash', 'bash', 'grep', 'grep', 'grep', 'read'].map(
  (name) => ({ name, status: 'ok' as const }),
)

const snapshot: Snapshot = {
  columns: 88,
  rows: expand ? 22 : 14,
  title: 'can i add skills',
  host: 'local harness',
  modelName: 'glm-5.3',
  messages: [
    textMessage('user', 'can i add skills'),
    {
      role: 'assistant',
      segments: [
        {
          kind: 'text',
          text: "I'll look at how this harness discovers skills so I can tell you where to add them.",
        },
        ...tools.map((tool) => ({ kind: 'tool' as const, tool })),
      ],
    },
  ],
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
  expandTools: expand,
  sessions: [],
  background: [],
  expandBackground: false,
  elapsedSeconds: 0,
  promptTokens: 4200,
  completionTokens: 900,
  totalTokens: 5100,
  haveUsage: true,
  contextLimit: 204800,
  confirming: false,
}

// eslint-disable-next-line no-console
console.log(render(snapshot).lines.join('\n'))
