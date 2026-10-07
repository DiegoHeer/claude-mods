// /branch-diff: a pane with every file changed on this branch vs its base,
// stacked like a pull request's files, refreshed as Claude edits.

import { CHANGED_PARTS, WHOLE_FILE, loadBranchDiff } from './git.js'
import { drawPane } from './view.js'

const PANE = 'branch-diff'
const REFRESH_DELAY_MS = 300 // lets a burst of edits settle into one refresh
const EDITING_TOOLS = ['Edit', 'Write', 'NotebookEdit', 'Bash']

let isWholeFile = true
let diff = { files: [] }
let isOpen = false
let pendingRefresh = null

// Run git without ever throwing: a failed start or timeout becomes an exit code.
async function runGit($, args) {
  try {
    return await $.process.run(['git', ...args])
  } catch (e) {
    return { exitCode: 1, stdout: '', stderr: String(e) }
  }
}

async function refresh($) {
  diff = await loadBranchDiff((args) => runGit($, args), isWholeFile ? WHOLE_FILE : CHANGED_PARTS)
  $.ui.invalidate('ui.render')
}

function refreshSoon($) {
  pendingRefresh?.cancel()
  pendingRefresh = $.clock.after(REFRESH_DELAY_MS, () => refresh($))
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'branch-diff', description: 'Show the full branch diff in a pane' })
    return next(e)
  })

  on('command.run', { command: 'branch-diff' }, async ($) => {
    await refresh($)
    isOpen = true
    await $.ui.open({ id: PANE, title: 'Branch diff', focus: true, closeOnEscape: true })
    return {}
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    isOpen = false
    return next(e)
  })

  on('tool.call', { tool: EDITING_TOOLS }, async ($, e, next) => {
    const result = await next(e)
    if (isOpen) refreshSoon($)
    return result
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    return drawPane(await $.ui.resolve(e), {
      diff,
      isWholeFile,
      columns: e.props.bodyColumns,
      onToggle: () => {
        isWholeFile = !isWholeFile
        return refresh($)
      },
      onRefresh: () => refresh($),
      onJump: (path) => $.ui.scroll({ in: PANE, to: { key: 'file-' + path }, block: 'start' }),
    })
  })
}
