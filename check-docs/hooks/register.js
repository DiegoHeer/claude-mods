// /check-docs: a pane with the markdown files this conversation wrote, one tab
// each, newest first; the selected one drawn as markdown.

import { atom, read, update } from 'claude-code'
import { collectDocPaths, keepKnown, knownPaths, rememberPaths, stepPath, tabLabels } from './docs.js'
import { drawPane } from './view.js'

const PANE = 'check-docs'
const STORE_KEY = 'recent'
const REFRESH_DELAY_MS = 300 // lets a burst of edits settle into one refresh

const selected = atom({ plugin: 'check-docs', key: 'selected' }, null)
let paths = []
let pendingRefresh = null
let refreshRun = 0
const contents = new Map() // each file's content as last read, until something may change it

const shownPath = (picked) => (paths.includes(picked) ? picked : (paths[0] ?? null))

// The store is a convenience: a full or failing one must never stop the pane.
async function readStore($) {
  try {
    return await $.store.get(STORE_KEY)
  } catch {
    return undefined
  }
}

async function writeStore($, value) {
  try {
    await $.store.set(STORE_KEY, value)
  } catch {}
}

async function refresh($) {
  const run = ++refreshRun
  const conversation = await $.session.id()
  const written = await collectDocPaths((agentId) => (agentId ? $.session.messages({ agentId }) : $.session.messages()))
  const recent = await readStore($)
  // A newer refresh, or another conversation, took over meanwhile: this one's files are stale.
  if (run !== refreshRun || (await $.session.id()) !== conversation) return
  paths = keepKnown(written, knownPaths(recent, conversation))
  contents.clear()
  await writeStore($, rememberPaths(recent, conversation, paths))
  $.ui.invalidate('ui.render')
}

function refreshSoon($) {
  pendingRefresh?.cancel()
  pendingRefresh = $.clock.after(REFRESH_DELAY_MS, () => refresh($))
}

// A shell command cannot add a tab, but may change the file on screen.
function redraw($) {
  contents.clear()
  $.ui.invalidate('ui.render')
}

const findPane = async ($) => (await $.ui.panes()).find((pane) => pane.id === PANE)

async function readContent($, path) {
  if (!(await $.fs.exists(path))) return { kind: 'deleted' }
  try {
    return { kind: 'text', text: await $.fs.read(path) }
  } catch {
    return { kind: 'unreadable' }
  }
}

async function contentOf($, path) {
  if (!contents.has(path)) contents.set(path, await readContent($, path))
  return contents.get(path)
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'check-docs', description: "Show this conversation's markdown files in a pane" })
    if (await findPane($)) await refresh($)
    return next(e)
  })

  // A /clear, resume or fork changes the conversation, and with it the tabs; a
  // compaction keeps the conversation, and the pick.
  on('classic.SessionStart', async ($, e, next) => {
    if (e.source !== 'compact') await update($, selected, () => null)
    if (await findPane($)) await refresh($)
    return next(e)
  })

  on('tool.call', { tool: ['Write', 'Edit'] }, async ($, e, next) => {
    const result = await next(e)
    if (await findPane($)) refreshSoon($)
    return result
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e)
    if (await findPane($)) redraw($)
    return result
  })

  on('command.run', { command: 'check-docs' }, async ($) => {
    if ((await findPane($))?.isShown) {
      await $.ui.close({ id: PANE })
      return {}
    }
    await refresh($)
    await $.ui.open({ id: PANE, title: 'Check docs', focus: true, closeOnEscape: true })
    return {}
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const elements = await $.ui.resolve(e)
    const path = shownPath(await read($, selected))
    return drawPane(elements, {
      paths,
      labels: tabLabels(paths),
      selected: path,
      content: path ? await contentOf($, path) : null,
      onSelect: (picked) => update($, selected, () => picked),
      onStep: (step) => update($, selected, (picked) => stepPath(paths, shownPath(picked), step)),
    })
  })
}
