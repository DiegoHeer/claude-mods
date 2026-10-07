// Draws the pane: a header, a list of changed files, then every file's diff
// stacked, each through the engine's own diff drawing (Code, format 'diff').

const MAX_BLOCK_CHARS = 8000 // keeps each Code block well under the engine's per-drawing cap
const MAX_DRAWN_CHARS = 80000 // keeps the whole pane under the engine's per-tree cap

const countOld = (lines) => lines.filter((l) => l[0] !== '+').length
const countNew = (lines) => lines.filter((l) => l[0] !== '-').length

// The engine numbers lines from the header, so a cut hunk needs one rebuilt from its own lines.
function hunkSource({ oldStart, newStart, lines }) {
  return `@@ -${oldStart},${countOld(lines)} +${newStart},${countNew(lines)} @@\n` + lines.join('\n')
}

function splitHunk(hunk) {
  const pieces = []
  let piece = { oldStart: hunk.oldStart, newStart: hunk.newStart, lines: [] }
  let size = 0
  for (const fullLine of hunk.lines) {
    const line = fullLine.slice(0, MAX_BLOCK_CHARS - 100)
    if (size + line.length + 1 > MAX_BLOCK_CHARS && piece.lines.length) {
      pieces.push(piece)
      piece = { oldStart: piece.oldStart + countOld(piece.lines), newStart: piece.newStart + countNew(piece.lines), lines: [] }
      size = 0
    }
    piece.lines.push(line)
    size += line.length + 1
  }
  pieces.push(piece)
  return pieces
}

// Which blocks of which files fit in the pane's budget, in order.
function planSections(files) {
  const sections = []
  let budget = MAX_DRAWN_CHARS
  for (const [i, file] of files.entries()) {
    const section = { file, blocks: [], isCut: false }
    sections.push(section)
    for (const source of file.hunks.flatMap(splitHunk).map(hunkSource)) {
      if (source.length > budget) {
        section.isCut = true
        return { sections, hiddenCount: files.length - i - 1 }
      }
      budget -= source.length
      section.blocks.push(source)
    }
  }
  return { sections, hiddenCount: 0 }
}

const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's')

export function drawPane({ Box, Text, Button, Code }, { diff, isWholeFile, columns, onToggle, onRefresh, onJump }) {
  const column = (...children) => Box({ flexDirection: 'column', children })
  const blank = () => Text({ children: [' '] })
  const dim = (text) => Text({ dimColor: true, children: [text] })
  const fileRule = () => Text({ bold: true, wrap: 'truncate-end', children: ['━'.repeat(columns || 40)] })
  const stat = (file) => [
    Text({ color: 'diffAddedWord', children: ['+' + file.added] }),
    Text({ color: 'diffRemovedWord', children: ['-' + file.removed] }),
    ...(file.isUncommitted ? [Text({ color: 'warning', children: ['● uncommitted'] })] : []),
  ]

  const summary = 'vs ' + (diff.base ?? '?') + (diff.files ? ' · ' + plural(diff.files.length, 'file') : '')
  const header = Box({
    flexDirection: 'row',
    columnGap: 2,
    children: [
      Text({ bold: true, children: ['branch-diff'] }),
      dim(summary),
      Button({ key: 'toggle', label: isWholeFile ? 'changes only' : 'whole files', hotkey: 'f', plain: true, onPress: onToggle }),
      Button({ key: 'refresh', label: 'refresh', hotkey: 'r', plain: true, onPress: onRefresh }),
    ],
  })

  if (diff.error) return column(header, blank(), Text({ color: 'error', children: [diff.error] }))
  if (diff.files.length === 0) return column(header, blank(), Text({ children: ['No changes vs ' + diff.base] }))

  const fileList = diff.files.map((file) =>
    Box({
      flexDirection: 'row',
      columnGap: 1,
      children: [Button({ key: 'goto-' + file.path, label: file.path, plain: true, onPress: () => onJump(file.path) }), ...stat(file)],
    }),
  )

  const drawSection = ({ file, blocks, isCut }) => {
    const body = file.isBinary
      ? [dim('Binary file, not shown')]
      : blocks.map((source) => Code({ source, format: 'diff', path: file.path }))
    if (!file.isBinary && file.hunks.length === 0) body.push(dim('No text changes'))
    if (isCut) body.push(dim('… rest of this file not shown'))
    return Box({
      key: 'file-' + file.path,
      flexDirection: 'column',
      children: [fileRule(), Box({ flexDirection: 'row', columnGap: 1, children: [Text({ bold: true, children: [file.path] }), ...stat(file)] }), blank(), ...body, blank()],
    })
  }

  const { sections, hiddenCount } = planSections(diff.files)
  const footer = hiddenCount
    ? [dim(plural(hiddenCount, 'more file') + ' not shown' + (isWholeFile ? ' — press f for changed parts only' : ''))]
    : []

  return column(header, ...fileList, blank(), ...sections.map(drawSection), fileRule(), ...footer)
}
