// The cship statusline, drawn under the prompt once /statusline-install has set it up.
// Runs the bundled script and keeps its output as the line drawn in the prompt's hint row.

import { atom, read, update } from 'claude-code'
import { parseAnsi } from './ansi.js'
import { runInstall, runUninstall } from './install.js'
import { statusInput } from './payload.js'

const REFRESH_MS = 30000
const DEFAULT_COLUMNS = 80 // a surface that reports no width

const lineAtom = atom({ plugin: 'statusline', key: 'line' }, null)
const transcriptAtom = atom({ plugin: 'statusline', key: 'transcriptPath' }, null)

let isActive = false
let isHidden = false // another statusline is configured; drawing ours would show the same twice
let timer = null
let columns // the hint row's width; the script waits for the first draw to learn it
let isRunning = false
let isDirty = false

const isVisible = () => isActive && !isHidden

const logToDebug = ($, text) => $.ui.log(`statusline: ${text}`, { to: 'debug' })

// Work started from a hook or timer that nobody awaits.
const inBackground = ($, work) => work.catch((error) => logToDebug($, error?.message ?? String(error)))

// Settings are read before the line counts as active, so a line kept in session state across a
// reload is never drawn beside another statusline. The first run is not awaited: the first
// prompt would wait on cship.
async function startLine($) {
  if (isActive) return
  isHidden = await hasOtherStatusLine($).catch((error) => (logToDebug($, error.message), false))
  isActive = true
  timer = $.clock.every(REFRESH_MS, () => inBackground($, refresh($)))
  inBackground($, recheckSettings($))
}

async function stopLine($) {
  isActive = false
  timer?.cancel()
  timer = null
  await update($, lineAtom, () => null)
}

const hasOtherStatusLine = async ($) => 'statusLine' in (await $.settings.read())

async function recheckSettings($) {
  if (!isActive) return
  isHidden = await hasOtherStatusLine($)
  if (isHidden) await update($, lineAtom, () => null)
  else await refresh($)
}

// At most one run at a time: a request during a run asks for one more run after it.
async function refresh($) {
  if (!isVisible() || columns === undefined) return
  if (isRunning) {
    isDirty = true
    return
  }
  isRunning = true
  try {
    do {
      isDirty = false
      await runOnce($)
    } while (isDirty)
  } finally {
    isRunning = false
  }
}

async function runOnce($) {
  const result = await runScript($).catch((error) => ({ exitCode: -1, stdout: '', stderr: String(error) }))
  if (!isVisible()) return // hidden or turned off while it ran
  if (result.exitCode === 0 && result.stdout.trim()) await update($, lineAtom, () => parseAnsi(result.stdout))
  else logToDebug($, `the script failed: ${result.stderr.trim().split('\n')[0]}`)
}

async function runScript($) {
  const [sessionId, model, cwd, projectDir, usage, transcriptPath] = await Promise.all([
    $.session.id(),
    $.session.model(),
    $.session.cwd(),
    $.session.root(),
    $.session.usage(),
    read($, transcriptAtom),
  ])
  const input = statusInput({ sessionId, transcriptPath: transcriptPath ?? undefined, cwd, projectDir, model, usage })
  return $.process.run(['bash', `${$.plugin.root}/scripts/statusline.sh`], {
    stdin: JSON.stringify(input),
    env: { COLUMNS: String(columns) },
    cwd,
  })
}

async function drawLine($, e, next) {
  const width = e.viewport?.columns ?? columns ?? DEFAULT_COLUMNS
  if (width !== columns) {
    columns = width
    inBackground($, refresh($))
  }
  const rows = await read($, lineAtom)
  if (!rows || !isVisible()) return next(e)
  const { Box, Text } = $.ui.resolve(e)
  const drawRow = (spans) => h(Text, {}, ...spans.map(({ text, ...style }) => h(Text, style, text)))
  // The engine's hint stays under the line: it carries 'esc to interrupt' and 'Ctrl-C again to exit'.
  return h(Box, { flexDirection: 'column' }, ...rows.map(drawRow), await next(e))
}

// What install.js reaches the engine through.
const installIo = ($) => ({
  run: (argv, init) => $.process.run(argv, init),
  ask: (question, options) => $.ui.ask(question, options),
  get: (key) => $.store.get(key),
  set: (key, value) => $.store.set(key, value),
  delete: (key) => $.store.delete(key),
  readSource: (source) => $.settings.read({ source }),
  root: () => $.session.root(),
  activate: () => startLine($),
  deactivate: () => stopLine($),
})

// Shown once per machine, on the first interactive session after the plugin is installed.
async function welcome($, isTurnedOn) {
  if (isTurnedOn || (await $.store.get('welcomed')) === true) return
  $.ui.toast('statusline: run /statusline-install to turn it on')
  await $.store.set('welcomed', true)
}

export const register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'statusline-install', description: 'Set up and turn on the cship statusline' })
    await $.command.register({ name: 'statusline-uninstall', description: 'Turn off the cship statusline' })
    if (!e.isInteractive) return next(e)
    const isTurnedOn = (await $.store.get('active')) === true
    if (isTurnedOn) await startLine($)
    await welcome($, isTurnedOn)
    return next(e)
  })

  on('command.run', { command: 'statusline-install' }, async ($) => ({ text: await runInstall(installIo($)) }))
  on('command.run', { command: 'statusline-uninstall' }, async ($) => ({ text: await runUninstall(installIo($)) }))

  // Kept in session state, which a hot reload keeps; this event does not fire again on a reload.
  on('classic.SessionStart', async ($, e, next) => {
    await update($, transcriptAtom, () => e.transcript_path)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    inBackground($, refresh($))
    return next(e)
  })

  on('classic.ConfigChange', async ($, e, next) => {
    inBackground($, recheckSettings($))
    return next(e)
  })

  on('ui.render', { component: 'PromptHint' }, drawLine)
}
