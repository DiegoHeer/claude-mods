// A file's diff as numbered rows, cut into drawable blocks, and the anchors and
// message review comments are made of.

const MAX_BLOCK_CHARS = 8000 // keeps each Code block well under the engine's per-drawing cap
const MAX_DRAWN_CHARS = 80000 // keeps the whole pane under the engine's per-tree cap

const countOld = (lines) => lines.filter((l) => l[0] !== '+').length
const countNew = (lines) => lines.filter((l) => l[0] !== '-').length

// The engine numbers lines from the header, so a cut hunk needs one rebuilt from its own lines.
function hunkSource({ oldStart, newStart, lines }) {
  return `@@ -${oldStart},${countOld(lines)} +${newStart},${countNew(lines)} @@\n` + lines.join('\n')
}

// Pieces of a hunk: cut at the size limit and after every row in `cutRows`.
function splitHunk(hunk, firstRow, cutRows) {
  const pieces = []
  let piece = { oldStart: hunk.oldStart, newStart: hunk.newStart, start: firstRow, lines: [] }
  let size = 0
  const nextPiece = () => {
    pieces.push(piece)
    piece = {
      oldStart: piece.oldStart + countOld(piece.lines),
      newStart: piece.newStart + countNew(piece.lines),
      start: piece.start + piece.lines.length,
      lines: [],
    }
    size = 0
  }
  for (const [i, fullLine] of hunk.lines.entries()) {
    const line = fullLine.slice(0, MAX_BLOCK_CHARS - 100)
    if (size + line.length + 1 > MAX_BLOCK_CHARS && piece.lines.length) nextPiece()
    piece.lines.push(line)
    size += line.length + 1
    if (cutRows.has(firstRow + i) && i < hunk.lines.length - 1) nextPiece()
  }
  pieces.push(piece)
  return pieces
}

function fileBlocks(file, cutRows) {
  let firstRow = 0
  return file.hunks.flatMap((hunk) => {
    const pieces = splitHunk(hunk, firstRow, cutRows)
    firstRow += hunk.lines.length
    return pieces.map((piece) => ({ source: hunkSource(piece), start: piece.start, count: piece.lines.length }))
  })
}

// Which blocks of which files fit in the pane's budget, in order.
export function planSections(files, cutsByPath) {
  const sections = []
  let budget = MAX_DRAWN_CHARS
  for (const [i, file] of files.entries()) {
    const section = { file, blocks: [], isCut: false }
    sections.push(section)
    for (const block of fileBlocks(file, cutsByPath.get(file.path) ?? new Set())) {
      if (block.source.length > budget) {
        section.isCut = true
        return { sections, hiddenCount: files.length - i - 1 }
      }
      budget -= block.source.length
      section.blocks.push(block)
    }
  }
  return { sections, hiddenCount: 0 }
}

const KINDS = { ' ': 'ctx', '+': 'add', '-': 'del' }

// Each refresh brings new file objects, so rows are worked out once per diff.
const rowsCache = new WeakMap()

export function fileRows(file) {
  if (!rowsCache.has(file)) rowsCache.set(file, numberRows(file))
  return rowsCache.get(file)
}

function numberRows(file) {
  const rows = []
  for (const hunk of file.hunks) {
    let oldNo = hunk.oldStart
    let newNo = hunk.newStart
    for (const line of hunk.lines) {
      const kind = KINDS[line[0]] ?? 'ctx'
      const row = { kind, line }
      if (kind !== 'add') row.oldNo = oldNo++
      if (kind !== 'del') row.newNo = newNo++
      rows.push(row)
    }
  }
  return rows
}

// A row named by the number it keeps after a refresh: its new line, else its old one.
const refOf = (row) => (row.newNo !== undefined ? { side: 'new', no: row.newNo } : { side: 'old', no: row.oldNo })
const isRow = (ref) => (row) => row[ref.side === 'new' ? 'newNo' : 'oldNo'] === ref.no

const range = (numbers) => {
  const [first, last] = [Math.min(...numbers), Math.max(...numbers)]
  return first === last ? `L${first}` : `L${first}-${last}`
}

// Kept lines are named in the new file, removed ones in the old file.
export function anchorOf(path, rows, from, to) {
  const picked = rows.slice(Math.min(from, to), Math.max(from, to) + 1)
  const kept = picked.filter((row) => row.newNo !== undefined).map((row) => row.newNo)
  const removed = picked.filter((row) => row.kind === 'del').map((row) => row.oldNo)
  return {
    path,
    from: refOf(picked[0]),
    to: refOf(picked.at(-1)),
    label: [kept.length && range(kept), removed.length && 'old ' + range(removed)].filter(Boolean).join(', '),
    snippet: picked.map((row) => row.line).join('\n'),
  }
}

export function rowRange(rows, anchor) {
  const from = rows.findIndex(isRow(anchor.from))
  const to = rows.findIndex(isRow(anchor.to))
  return from === -1 || to === -1 ? null : { from, to }
}

export const PENDING_ID = 'pending' // the open comment box among the notes; drafts have numeric ids

// Where a file's review shows: a mark per row, the rows a block must end after,
// and the row each note (draft card or comment box) goes under; a note whose lines are gone has none.
export function placeReview(path, rows, { selection, notes }) {
  const marks = Array(rows.length).fill(' ')
  const cuts = new Set()
  const endRows = new Map()
  for (const note of notes.filter((n) => n.path === path)) {
    const found = rowRange(rows, note)
    if (!found) continue
    // While new lines are being picked, the open box keeps its place but not its bar.
    const sign = note.id !== PENDING_ID ? '✎' : selection ? null : '▌'
    if (sign) marks.fill(sign, found.from, found.to + 1)
    cuts.add(found.to)
    endRows.set(note.id, found.to)
  }
  if (selection?.path === path) marks.fill('▌', selection.from, selection.to + 1)
  return { marks: marks.join(''), cuts, endRows }
}

// Longer than any backtick run in the snippet, so its own fences cannot close this one.
const fenceFor = (text) => '`'.repeat(Math.max(3, ...(text.match(/`+/g) ?? []).map((run) => run.length + 1)))

export function reviewMessage(base, drafts) {
  const items = drafts.map((draft, i) => {
    const fence = fenceFor(draft.snippet)
    return `${i + 1}. ${draft.path} ${draft.label}\n${fence}diff\n${draft.snippet}\n${fence}\n${draft.text}`
  })
  return [`Review comments on this branch (vs ${base}). Please address each one.`, ...items].join('\n\n')
}
