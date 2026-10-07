// Draws the pane: a header, a list of changed files, then every file's diff
// stacked, each through the engine's own diff drawing (Code, format 'diff').

import { fileRows, placeReview, planSections } from './rows.js'

const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's')

const NO_PLACEMENT = { marks: '', cuts: new Set(), notesAt: new Map(), orphans: [] }

export function drawPane(
  { Box, Text, Button, Code, Client, Input },
  { diff, isWholeFile, columns, review, onToggle, onRefresh, onJump, onSaveComment, onCancelComment, onDeleteDraft, onSend },
) {
  const draftCount = Client && review ? review.drafts.length : 0
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
      ...(draftCount ? [Button({ key: 'send', label: 'send ' + plural(draftCount, 'comment'), hotkey: 's', plain: true, onPress: onSend })] : []),
    ],
  })

  const drawnDraftIds = new Set()
  const drawDraft = (draft, where = '') => {
    drawnDraftIds.add(draft.id)
    return Box({
      key: 'draft-' + draft.id,
      flexDirection: 'row',
      columnGap: 2,
      children: [
        Text({ color: 'warning', children: [`${where}✎ ${draft.label}: ${draft.text}`] }),
        Button({ key: 'delete-' + draft.id, label: 'delete', plain: true, onPress: () => onDeleteDraft(draft.id) }),
      ],
    })
  }
  // A draft with no place in the drawn diff (its file gone, binary or not shown) is still sent, so it stays visible.
  const unplacedDrafts = () =>
    draftCount ? review.drafts.filter((d) => !drawnDraftIds.has(d.id)).map((d) => drawDraft(d, d.path + ' ')) : []

  if (diff.error) return column(header, ...unplacedDrafts(), blank(), Text({ color: 'error', children: [diff.error] }))
  if (diff.files.length === 0) return column(header, ...unplacedDrafts(), blank(), Text({ children: ['No changes vs ' + diff.base] }))

  const fileList = diff.files.map((file) =>
    Box({
      flexDirection: 'row',
      columnGap: 1,
      children: [Button({ key: 'goto-' + file.path, label: file.path, plain: true, onPress: () => onJump(file.path) }), ...stat(file)],
    }),
  )

  // Review comments need the mouse, so they exist only where the surface has a Client.
  const placements = new Map(
    Client && review
      ? diff.files.filter((file) => !file.isBinary).map((file) => [file.path, placeReview(file.path, fileRows(file), review)])
      : [],
  )
  const placementOf = (path) => placements.get(path) ?? NO_PLACEMENT

  // Keyed so the box, and what is typed in it, survives blocks shifting around it on a refresh.
  const drawCommentBox = (anchor) =>
    Box({
      key: 'comment-row',
      flexDirection: 'row',
      columnGap: 2,
      children: [
        Input({ key: 'comment-box', label: anchor.label, placeholder: 'comment', submitLabel: 'save', autoFocus: true, onSubmit: onSaveComment }),
        Button({ key: 'cancel-comment', label: 'cancel', plain: true, onPress: onCancelComment }),
      ],
    })
  const drawNote = (note) => (note.type === 'pending' ? drawCommentBox(note.anchor) : drawDraft(note.draft))

  // Where the surface has a Client, the block hears the mouse; elsewhere it is the plain diff.
  const drawBlock = (path, block) => {
    if (!Client) return [Code({ source: block.source, format: 'diff', path })]
    const { marks, notesAt } = placementOf(path)
    const lastRow = block.start + block.count - 1
    const props = { path, source: block.source, start: block.start, count: block.count, marks: marks.slice(block.start, lastRow + 1) }
    return [Client({ key: `block-${path}-${block.start}`, module: './diff-block.js', props }), ...(notesAt.get(lastRow) ?? []).map(drawNote)]
  }

  const drawSection = ({ file, blocks, isCut }) => {
    const body = file.isBinary ? [dim('Binary file, not shown')] : blocks.flatMap((block) => drawBlock(file.path, block))
    if (!file.isBinary && file.hunks.length === 0) body.push(dim('No text changes'))
    if (isCut) body.push(dim('… rest of this file not shown'))
    return Box({
      key: 'file-' + file.path,
      flexDirection: 'column',
      children: [
        fileRule(),
        Box({ flexDirection: 'row', columnGap: 1, children: [Text({ bold: true, children: [file.path] }), ...stat(file)] }),
        ...placementOf(file.path).orphans.map(drawNote),
        blank(),
        ...body,
        blank(),
      ],
    })
  }

  const cutsByPath = new Map([...placements].map(([path, placement]) => [path, placement.cuts]))
  const { sections, hiddenCount } = planSections(diff.files, cutsByPath)
  const footer = hiddenCount
    ? [dim(plural(hiddenCount, 'more file') + ' not shown' + (isWholeFile ? ' — press f for changed parts only' : ''))]
    : []

  const drawnSections = sections.map(drawSection)
  return column(header, ...fileList, ...unplacedDrafts(), blank(), ...drawnSections, fileRule(), ...footer)
}
