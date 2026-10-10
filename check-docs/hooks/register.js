// /check-docs: a pane with the markdown files this conversation wrote, one tab
// each, newest first; the selected one drawn as markdown.

import { atom, read, update } from 'claude-code'
import { collectDocPaths, keepKnown, stepPath, tabLabels } from './docs.js'
import { drawPane } from './view.js'

const PANE = 'check-docs'
const REFRESH_DELAY_MS = 300 // lets a burst of edits settle into one refresh
const CHANGING_TOOLS = ['Write', 'Edit', 'Bash']

const selected = atom({ plugin: 'check-docs', key: 'selected' }, null)
let paths = []
let pendingRefresh = null

const shownPath = (picked) => (paths.includes(picked) ? picked : (paths[0] ?? null))

// Kept per conversation, so a /clear or a switch starts from that conversation's own files.
async function refresh($) {
  const conversation = await $.session.id()
  const written = await collectDocPaths((agentId) => (agentId ? $.session.messages({ agentId }) : $.session.messages()))
  paths = keepKnown(written, (await $.store.get(conversation)) ?? [])
  await $.store.set(conversation, paths)
  $.ui.invalidate('ui.render')
}

function refreshSoon($) {
  pendingRefresh?.cancel()
  pendingRefresh = $.clock.after(REFRESH_DELAY_MS, () => refresh($))
}

async function isPaneUp($) {
  return (await $.ui.panes()).some((pane) => pane.id === PANE)
}

async function readContent($, path) {
  if (!(await $.fs.exists(path))) return { kind: 'deleted' }
  try {
    return { kind: 'text', text: await $.fs.read(path) }
  } catch {
    return { kind: 'unreadable' }
  }
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'check-docs', description: "Show this conversation's markdown files in a pane" })
    if (await isPaneUp($)) await refresh($)
    return next(e)
  })

  // A /clear, resume or fork changes the conversation, and with it the tabs.
  on('classic.SessionStart', async ($, e, next) => {
    if (await isPaneUp($)) await refresh($)
    return next(e)
  })

  // Bash only redraws: tabs come from Write and Edit alone.
  on('tool.call', { tool: CHANGING_TOOLS }, async ($, e, next) => {
    const result = await next(e)
    if (await isPaneUp($)) refreshSoon($)
    return result
  })

  on('command.run', { command: 'check-docs' }, async ($) => {
    if (await isPaneUp($)) {
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
      content: path ? await readContent($, path) : null,
      onSelect: (picked) => update($, selected, () => picked),
      onStep: (step) => update($, selected, (picked) => stepPath(paths, shownPath(picked), step)),
    })
  })
}
