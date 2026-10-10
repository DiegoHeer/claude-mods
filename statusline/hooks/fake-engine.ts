// Test helpers: what the mod reads from the engine, answered from memory.

export const PLUGIN = 'statusline'
const ESC = '\x1b'
export const GREEN_COST = `${ESC}[38;2;158;206;106m$0.42${ESC}[0m\n`
export const USAGE = { startedAt: 0, context: { window: 200000, tokens: 15500, percent: 8 }, rateLimits: [], cost: { usd: 0.42 } }
const HINT = { isDraft: false, isWorking: false, hint: '? for shortcuts' }
export const START = { cwd: '/repo', surface: 'terminal', isInteractive: true } as const

type Run = { argv: string[]; stdin?: string; columns?: string }

// `settings` maps a source ('merged' for the merge) to its settings; `answer` is what each
// script run prints, and may hold a run back.
export function fakeEngine(
  on,
  opts: { settings?: Record<string, object>; answer?: () => Promise<{ exitCode: number; stdout: string }> } = {},
) {
  const runs: Run[] = []
  const toasts: string[] = []
  const commands: string[] = []
  const logs: string[] = []
  const state = {
    settings: opts.settings ?? {},
    readError: '',
    answer: opts.answer ?? (async () => ({ exitCode: 0, stdout: GREEN_COST })),
  }
  on('process.run', async ($, e) => {
    runs.push({ argv: e.argv, stdin: e.init?.stdin, columns: e.init?.env?.COLUMNS })
    return { value: { ...(await state.answer()), stderr: '' } }
  })
  on('session.id', async () => ({ value: 'abc' }))
  on('session.model', async () => ({ value: 'claude-opus-5-5' }))
  on('session.cwd', async () => ({ value: '/repo' }))
  on('session.root', async () => ({ value: '/repo' }))
  on('session.usage', async () => ({ value: USAGE }))
  on('settings.read', async ($, e) => {
    if (state.readError) throw new Error(state.readError)
    return { value: state.settings[e?.source ?? 'merged'] ?? {} }
  })
  on('session.start', async ($, e) => ({ cwd: e.cwd }))
  on('session.measure', async ($, e) => ({ changed: e.changed }))
  on('classic.ConfigChange', async () => ({}))
  on('ui.render', ($, e) => h($.ui.resolve(e).Text, {}, e.props.hint))
  on('command.register', async ($, e) => {
    commands.push(e.name)
    return { value: undefined }
  })
  on('ui.log', async ($, e) => {
    logs.push(e.text)
    return { value: undefined }
  })
  on('classic.SessionStart', async () => ({}))
  on('ui.toast', async ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  return { runs, toasts, commands, logs, state }
}

export const mountHint = ($, columns = 120) =>
  $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'PromptHint', props: HINT, viewport: { columns, rows: 40 } })
