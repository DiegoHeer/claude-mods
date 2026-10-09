// Draws the pane: a header, a list of changed files, then every file's diff
// stacked, each through the engine's own diff drawing (Code, format 'diff').

import { PENDING_ID, fileRows, placeReview, planSections } from './rows.js'

const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's')

const FOLLOW = 'follow' // the picker option for following Claude
const nameOf = (worktree) => worktree.branch ?? worktree.path.split('/').at(-1) + ' (detached)'

export function drawPane(
  { Box, Text, Button, Code, Client, Input },
  {
    diff,
    isWholeFile,
    columns,
    review,
    worktrees,
    target,
    isFollowing,
    isPickerOpen,
    onToggle,
    onRefresh,
    onTogglePicker,
    onPickWorktree,
    onJump,
    onTypeComment,
    onSaveComment,
    onCancelComment,
    onDeleteDraft,
    onSend,
  },
) {
  // Review comments need the mouse, so they exist only where the surface has a Client.
  const hasReview = Boolean(Client && review)
  const drafts = hasReview ? review.drafts : []
  const notes = hasReview && review.pending ? [...drafts, { ...review.pending, id: PENDING_ID }] : drafts
  // While a comment is typed, its letters must reach the box, not the pane's hotkeys.
  const hotkey = (key) => (hasReview && review.pending ? {} : { hotkey: key })

  const column = (...children) => Box({ flexDirection: 'column', children })
  const blank = () => Text({ children: [' '] })
  const dim = (text) => Text({ dimColor: true, children: [text] })
  const fileRule = () => Text({ bold: true, wrap: 'truncate-end', children: ['━'.repeat(columns || 40)] })
  const tag = (file) => (file.isUntracked ? 'new, untracked' : file.isUncommitted ? 'uncommitted' : null)
  const stat = (file) => [
    Text({ color: 'diffAddedWord', children: ['+' + file.added] }),
    Text({ color: 'diffRemovedWord', children: ['-' + file.removed] }),
    ...(tag(file) ? [Text({ color: 'warning', children: ['● ' + tag(file)] })] : []),
  ]

  // Built from Buttons, not a Select: the terminal's Select takes no mouse picks.
  const followLabel = 'follow Claude' + (isFollowing && target ? ` (${nameOf(target)})` : '')
  const pick = (value) => onPickWorktree(value === FOLLOW ? null : value)
  const option = (value, label) => Button({ key: 'worktree-' + value, label, plain: true, onPress: () => pick(value) })
  const drawPicker = () => [
    Button({
      key: 'worktree',
      label: `worktree: ${isFollowing ? followLabel : nameOf(target)} ${isPickerOpen ? '▴' : '▾'}`,
      plain: true,
      onPress: onTogglePicker,
    }),
    ...(isPickerOpen
      ? [Box({ flexDirection: 'column', paddingLeft: 2, children: [option(FOLLOW, followLabel), ...worktrees.map((w) => option(w.path, nameOf(w)))] })]
      : []),
  ]
  const choices = [FOLLOW, ...worktrees.map((w) => w.path)]
  const nextChoice = () => choices[(choices.indexOf(isFollowing ? FOLLOW : target?.path) + 1) % choices.length]
  // With one worktree there is nothing to pick.
  const hasPicker = worktrees.length > 1
  const picker = hasPicker ? drawPicker() : []
  const nextButton = hasPicker
    ? [Button({ key: 'next-worktree', label: 'next worktree', ...hotkey('w'), plain: true, onPress: () => pick(nextChoice()) })]
    : []

  const summary = 'vs ' + (diff.base ?? '?') + (diff.files ? ' · ' + plural(diff.files.length, 'file') : '')
  const toolbar = Box({
    flexDirection: 'row',
    columnGap: 2,
    children: [
      Text({ bold: true, children: ['branch-diff'] }),
      dim(summary),
      Button({ key: 'toggle', label: isWholeFile ? 'changes only' : 'whole files', ...hotkey('f'), plain: true, onPress: onToggle }),
      Button({ key: 'refresh', label: 'refresh', ...hotkey('r'), plain: true, onPress: onRefresh }),
      ...nextButton,
      ...(drafts.length ? [Button({ key: 'send', label: 'send ' + plural(drafts.length, 'comment'), ...hotkey('s'), plain: true, onPress: onSend })] : []),
    ],
  })
  const header = column(toolbar, ...picker)

  // The comment box is keyed so it, and what is typed in it, survives blocks shifting around it on a refresh.
  const drawNote = (note, where = '') =>
    note.id === PENDING_ID
      ? Box({
          key: 'comment-row',
          flexDirection: 'row',
          columnGap: 2,
          children: [
            Input({ key: 'comment-box', label: where + note.label, placeholder: 'comment', submitLabel: 'save', autoFocus: true, onInput: onTypeComment, onSubmit: onSaveComment }),
            Button({ key: 'cancel-comment', label: 'cancel', plain: true, onPress: onCancelComment }),
          ],
        })
      : Box({
          key: 'draft-' + note.id,
          flexDirection: 'row',
          columnGap: 2,
          children: [
            Text({ color: 'warning', children: [`${where}✎ ${note.label}: ${note.text}`] }),
            Button({ key: 'delete-' + note.id, label: 'delete', plain: true, onPress: () => onDeleteDraft(note.id) }),
          ],
        })
  // A note with no place in the drawn diff (its lines gone, its file binary or not shown) is listed by file instead.
  const notesNotShown = (shownIds) => notes.filter((n) => !shownIds.has(n.id)).map((n) => drawNote(n, n.path + ' '))

  if (diff.error) return column(header, ...notesNotShown(new Set()), blank(), Text({ color: 'error', children: [diff.error] }))
  if (diff.files.length === 0) return column(header, ...notesNotShown(new Set()), blank(), Text({ children: ['No changes vs ' + diff.base] }))

  const fileList = diff.files.map((file) =>
    Box({
      flexDirection: 'row',
      columnGap: 1,
      children: [Button({ key: 'goto-' + file.path, label: file.path, plain: true, onPress: () => onJump(file.path) }), ...stat(file)],
    }),
  )

  const untrackedNote = diff.untrackedHiddenCount
    ? [dim(plural(diff.untrackedHiddenCount, 'more untracked file') + ' not shown')]
    : []

  const reviewedPaths = new Set([...notes.map((n) => n.path), hasReview ? review.selection?.path : undefined])
  const placements = new Map(
    diff.files
      .filter((file) => !file.isBinary && reviewedPaths.has(file.path))
      .map((file) => [file.path, placeReview(file.path, fileRows(file), { selection: review.selection, notes })]),
  )
  const cutsByPath = new Map([...placements].map(([path, placement]) => [path, placement.cuts]))
  const { sections, hiddenCount } = planSections(diff.files, cutsByPath)

  const lastRowOf = (block) => block.start + block.count - 1
  const notesUnder = (path, row) => notes.filter((n) => n.path === path && placements.get(path)?.endRows.get(n.id) === row)
  const shownIds = new Set(sections.flatMap(({ file, blocks }) => blocks.flatMap((b) => notesUnder(file.path, lastRowOf(b)).map((n) => n.id))))

  // Where the surface has a Client, the block hears the mouse; elsewhere it is the plain diff.
  const drawBlock = (path, block) => {
    if (!Client) return [Code({ source: block.source, format: 'diff', path })]
    const marks = placements.get(path)?.marks.slice(block.start, lastRowOf(block) + 1) ?? ' '.repeat(block.count)
    const props = { path, source: block.source, start: block.start, count: block.count, marks }
    return [Client({ key: `block-${path}-${block.start}`, module: './diff-block.js', props }), ...notesUnder(path, lastRowOf(block)).map((n) => drawNote(n))]
  }

  const drawSection = ({ file, blocks, isCut }) => {
    const body = file.isBinary ? [dim('Binary file, not shown')] : blocks.flatMap((block) => drawBlock(file.path, block))
    if (!file.isBinary && file.hunks.length === 0) body.push(dim('No text changes'))
    if (isCut) body.push(dim('… rest of this file not shown'))
    return Box({
      key: 'file-' + file.path,
      flexDirection: 'column',
      children: [fileRule(), Box({ flexDirection: 'row', columnGap: 1, children: [Text({ bold: true, children: [file.path] }), ...stat(file)] }), blank(), ...body, blank()],
    })
  }

  const footer = hiddenCount
    ? [dim(plural(hiddenCount, 'more file') + ' not shown' + (isWholeFile ? ' — press f for changed parts only' : ''))]
    : []

  return column(header, ...fileList, ...untrackedNote, ...notesNotShown(shownIds), blank(), ...sections.map(drawSection), fileRule(), ...footer)
}
