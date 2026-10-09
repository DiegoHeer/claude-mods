// /branch-diff: a pane with every file changed on this branch vs its base,
// stacked like a pull request's files, refreshed as Claude edits. Lines picked
// with the mouse take review comments, kept as drafts until sent to Claude.

import { atom, read, update } from 'claude-code'
import { CHANGED_PARTS, WHOLE_FILE, listWorktrees, loadBranchDiff, worktreeHolding } from './git.js'
import { anchorOf, fileRows, reviewMessage, rowRange } from './rows.js'
import { drawPane } from './view.js'

const PANE = 'branch-diff'
const REFRESH_DELAY_MS = 300 // lets a burst of edits settle into one refresh
const EDITING_TOOLS = ['Edit', 'Write', 'NotebookEdit', 'Bash', 'EnterWorktree']
const MOUSE_SURFACES = ['terminal', 'desktop'] // the surfaces that draw a Client

let isWholeFile = true
let diff = { files: [] }
let isOpen = false
let pendingRefresh = null

let worktrees = []
let target // the worktree shown; undefined when git lists none
let pickedPath = null // the worktree picked in the pane; null follows Claude
let touchedPath = null // the last file or worktree Claude worked in
let isPickerOpen = false

const drafts = atom({ plugin: 'branch-diff', key: 'drafts' }, [])
let selection = null // rows being picked: { path, anchorRow, from, to }
let pending = null // the picked lines awaiting their comment, by line number
let typedComment = '' // what the open comment box holds so far
let isSending = false

// A draft shows, and is sent, only in the worktree it was written in.
const isHere = (draft) => draft.worktree === target?.path
const readHereDrafts = async ($) => (await read($, drafts)).filter(isHere)

const rowsOf = (path) => {
  const file = diff.files?.find((f) => f.path === path)
  return file ? fileRows(file) : null
}

// A shift-click grows the selection or comment box already open in the same file.
function openAnchorRow(path, rows) {
  if (selection?.path === path) return selection.anchorRow
  if (pending?.path === path) return rowRange(rows, pending)?.from
  return undefined
}

function onGesture({ type, path, anchorRow, row, shift }) {
  const rows = rowsOf(path)
  if (!rows) return
  const anchor = (shift ? openAnchorRow(path, rows) : undefined) ?? anchorRow
  // The open box stays until release: dropping it mid-gesture would re-cut the blocks
  // and unmount the one holding the pointer.
  if (type === 'release') {
    forgetComment()
    pending = anchorOf(path, rows, anchor, row)
    selection = null
  } else {
    selection = { path, anchorRow: anchor, from: Math.min(anchor, row), to: Math.max(anchor, row) }
  }
}

function forgetComment() {
  pending = null
  typedComment = ''
}

async function saveComment($, text) {
  const anchor = pending
  // Forgotten before the await, so a box opened meanwhile is not closed by this save.
  forgetComment()
  const comment = text.trim()
  if (comment && anchor) {
    await update($, drafts, (list) => [...list, { ...anchor, worktree: target?.path, id: Math.max(0, ...list.map((d) => d.id)) + 1, text: comment }])
  }
  $.ui.invalidate('ui.render')
}

// Sent as the person's own words: the comments are theirs, not the plugin's.
// Drafts leave only once sent, and only those sent; a half-typed comment goes along.
async function sendReview($) {
  if (isSending) return
  isSending = true
  try {
    await saveComment($, typedComment)
    const list = await readHereDrafts($)
    if (list.length === 0) return
    await $.prompt.submit({ text: reviewMessage(diff.base, list, target?.path), asUser: true })
    const sent = new Set(list.map((d) => d.id))
    await update($, drafts, (current) => current.filter((d) => !sent.has(d.id)))
  } finally {
    isSending = false
    $.ui.invalidate('ui.render')
  }
}

// Run git without ever throwing: a failed start or timeout becomes an exit code.
async function runGit($, args, cwd) {
  try {
    return await $.process.run(['git', ...args], cwd ? { cwd } : undefined)
  } catch (e) {
    return { exitCode: 1, stdout: '', stderr: String(e) }
  }
}

// The picked worktree, else the one Claude last worked in, else the session's.
function chooseTarget(sessionDir) {
  const picked = worktrees.find((w) => w.path === pickedPath)
  const followed = touchedPath ? worktreeHolding(worktrees, touchedPath) : undefined
  return picked ?? followed ?? worktreeHolding(worktrees, sessionDir)
}

// Where a tool call worked: the worktree EnterWorktree moved to, or the file an edit wrote.
const touchedBy = (e, result) => (e.tool === 'EnterWorktree' ? result.result?.worktreePath : (e.file_path ?? e.notebook_path))

async function refresh($) {
  worktrees = await listWorktrees((args) => runGit($, args))
  if (!worktrees.some((w) => w.path === pickedPath)) pickedPath = null
  const shown = chooseTarget(await $.session.cwd())
  // Picked lines name files of the worktree they were picked in.
  if (shown?.path !== target?.path) {
    selection = null
    forgetComment()
  }
  target = shown
  diff = await loadBranchDiff((args) => runGit($, args, target?.path), isWholeFile ? WHOLE_FILE : CHANGED_PARTS)
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
    isPickerOpen = false
    selection = null
    forgetComment()
    return next(e)
  })

  on('tool.call', { tool: EDITING_TOOLS }, async ($, e, next) => {
    const result = await next(e)
    touchedPath = touchedBy(e, result) ?? touchedPath
    if (isOpen) refreshSoon($)
    return result
  })

  on('ui.message', { requestId: PANE }, async ($, e) => {
    onGesture(e.data)
    $.ui.invalidate('ui.render')
    return {}
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const elements = await $.ui.resolve(e)
    const hasMouse = MOUSE_SURFACES.includes(e.surface)
    return drawPane({ ...elements, Client: hasMouse ? elements.Client : undefined }, {
      diff,
      isWholeFile,
      columns: e.props.bodyColumns,
      review: { selection, pending, drafts: await readHereDrafts($) },
      worktrees,
      target,
      isFollowing: pickedPath === null,
      isPickerOpen,
      onToggle: () => {
        isWholeFile = !isWholeFile
        return refresh($)
      },
      onRefresh: () => refresh($),
      onTogglePicker: () => {
        isPickerOpen = !isPickerOpen
        $.ui.invalidate('ui.render')
      },
      onPickWorktree: (path) => {
        pickedPath = path
        isPickerOpen = false
        return refresh($)
      },
      onJump: (path) => $.ui.scroll({ in: PANE, to: { key: 'file-' + path }, block: 'start' }),
      onTypeComment: (text) => {
        typedComment = text
      },
      onSaveComment: (text) => saveComment($, text),
      onCancelComment: () => saveComment($, ''),
      onDeleteDraft: async (id) => {
        await update($, drafts, (list) => list.filter((d) => d.id !== id))
        $.ui.invalidate('ui.render')
      },
      onSend: () => sendReview($),
    })
  })
}
