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

export function fileRows(file) {
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

const numberKey = (side) => (side === 'new' ? 'newNo' : 'oldNo')

// Lines are named in the new file, unless the range holds only removed lines.
export function anchorOf(path, rows, from, to) {
  const picked = rows.slice(Math.min(from, to), Math.max(from, to) + 1)
  const side = picked.some((row) => row.newNo !== undefined) ? 'new' : 'old'
  const numbers = picked.map((row) => row[numberKey(side)]).filter((n) => n !== undefined)
  const first = Math.min(...numbers)
  const last = Math.max(...numbers)
  const range = first === last ? `L${first}` : `L${first}-${last}`
  return {
    path,
    side,
    first,
    last,
    label: side === 'new' ? range : `old ${range}`,
    snippet: picked.map((row) => row.line).join('\n'),
  }
}

export function rowRange(rows, { side, first, last }) {
  const key = numberKey(side)
  const from = rows.findIndex((row) => row[key] === first)
  const to = rows.findIndex((row) => row[key] === last)
  return from === -1 || to === -1 ? null : { from, to }
}

// Where a file's review shows: a mark per row, the rows a block must end after,
// the notes (comment box, draft cards) under each such row, and notes whose lines are gone.
export function placeReview(path, rows, { selection, pending, drafts }) {
  const marks = Array(rows.length).fill(' ')
  const cuts = new Set()
  const notesAt = new Map()
  const orphans = []
  const mark = (from, to, sign) => marks.fill(sign, from, to + 1)
  const place = (anchor, note, sign) => {
    const range = rowRange(rows, anchor)
    if (!range) return orphans.push(note)
    if (sign) mark(range.from, range.to, sign)
    cuts.add(range.to)
    notesAt.set(range.to, [...(notesAt.get(range.to) ?? []), note])
  }
  for (const draft of drafts.filter((d) => d.path === path)) place(draft, { type: 'draft', draft }, '✎')
  // While new lines are being picked, the open box keeps its place but not its bar.
  if (pending?.path === path) place(pending, { type: 'pending', anchor: pending }, selection ? null : '▌')
  if (selection?.path === path) mark(selection.from, selection.to, '▌')
  return { marks: marks.join(''), cuts, notesAt, orphans }
}

export function reviewMessage(base, drafts) {
  const items = drafts.map(
    (draft, i) => `${i + 1}. ${draft.path} ${draft.label}\n\`\`\`diff\n${draft.snippet}\n\`\`\`\n${draft.text}`,
  )
  return [`Review comments on this branch (vs ${base}). Please address each one.`, ...items].join('\n\n')
}
