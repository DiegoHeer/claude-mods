import { expect, mock, test } from 'claude-code/testing'

const PLUGIN = 'branch-diff'
const PANE = 'review-diff'
const PANE_PROPS = { title: 'Review diff', bodyColumns: 80 } as never

const DIFF = 'git -c core.quotePath=false diff --no-ext-diff --no-textconv --no-renames'
const numstat = (forkPoint: string) => `${DIFF} --numstat ${forkPoint}`
const patch = (forkPoint: string, context: number) => `${DIFF} -U${context} ${forkPoint}`
const verify = (ref: string) => `git rev-parse --verify --quiet ${ref}^{commit}`
const UNTRACKED = 'git ls-files -z --others --exclude-standard --full-name :/'
const untrackedPatch = (path: string, context = 1000000) =>
  `git -C /repo -c core.bigFileThreshold=1m ${DIFF.slice(4)} --no-index -U${context} -- /dev/null ${path}`

// Fake git: answers each command the mod runs from a table of argv → stdout,
// a command run in another folder keyed `<folder>: <argv>` (see inDir).
// The table is read on every call, so a test can change it between refreshes.
// `holdUntil` can keep an answer back, to let a test overlap two refreshes.
function fakeGit(on, answers: Record<string, string>, holdUntil?: (key: string) => Promise<void> | undefined) {
  const calls: string[] = []
  on('process.run', async ($, e) => {
    const argv = e.argv.join(' ')
    const key = e.init?.cwd ? `${e.init.cwd}: ${argv}` : argv
    calls.push(key)
    await holdUntil?.(key)
    if (key in answers) return { value: { exitCode: 0, stdout: answers[key], stderr: '' } }
    return { value: { exitCode: 1, stdout: '', stderr: 'unexpected: ' + key } }
  })
  on('session.cwd', async () => ({ value: '/repo' }))
  on('command.register', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  return calls
}

async function openPane($, surface: 'terminal' | 'desktop' | 'vscode' = 'terminal') {
  await $.command.run({ command: 'review-diff', args: '' })
  return $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', props: PANE_PROPS, requestId: PANE })
}

// The diff blocks in drawing order, whether drawn inside mouse-aware Clients or directly.
async function codeBlocks(ui) {
  const clients = await ui.findAll({ type: 'Client' })
  if (clients.length === 0) return ui.findAll({ type: 'Code' })
  const blocks = []
  for (const client of clients) blocks.push(...(await ui.findAll({ type: 'Code', in: client.key })))
  return blocks
}

const APP_PATCH = [
  'diff --git a/src/app.js b/src/app.js',
  'index 1111111..2222222 100644',
  '--- a/src/app.js',
  '+++ b/src/app.js',
  '@@ -1,2 +1,2 @@',
  ' const a = 1',
  '-const b = 2',
  '+const b = 3',
].join('\n')

const README_PATCH = [
  'diff --git a/README.md b/README.md',
  'new file mode 100644',
  'index 0000000..3333333',
  '--- /dev/null',
  '+++ b/README.md',
  '@@ -0,0 +1 @@',
  '+# Hello',
].join('\n')

const BRANCH = {
  'git symbolic-ref --short refs/remotes/origin/HEAD': 'origin/main\n',
  [verify('origin/main')]: 'abc\n',
  'git merge-base origin/main HEAD': 'f0rk\n',
  [numstat('f0rk')]: '1\t1\tsrc/app.js\n1\t0\tREADME.md\n',
  [patch('f0rk', 1000000)]: APP_PATCH + '\n' + README_PATCH + '\n',
  [patch('f0rk', 3)]: APP_PATCH + '\n' + README_PATCH + '\n',
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`stacks every changed file as a built-in diff block (${surface})`, async ($, on) => {
    fakeGit(on, BRANCH)
    await $.command.run({ command: 'review-diff', args: '' })
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', props: PANE_PROPS, requestId: PANE })

    expect(await ui.find({ text: 'vs origin/main · 2 files' })).toBeDefined()
    expect(await ui.find({ key: 'goto-src/app.js', text: 'src/app.js' })).toBeDefined()
    expect(await ui.find({ key: 'file-src/app.js' })).toBeDefined()
    expect(await ui.find({ key: 'file-README.md' })).toBeDefined()

    // One solid rule opens each file and one closes the last.
    expect(await ui.findAll({ type: 'Text', text: '━━━━' })).toHaveLength(3)

    const blocks = await codeBlocks(ui)
    expect(blocks.map((b) => b.text)).toEqual([
      '@@ -1,2 +1,2 @@\n const a = 1\n-const b = 2\n+const b = 3',
      '@@ -0,0 +1,1 @@\n+# Hello',
    ])
  })
}

const APP_BLOCK = 'block-src/app.js-0'

test('draws each diff block inside a mouse-aware client, one row per line', async ($, on) => {
  fakeGit(on, BRANCH)
  const ui = await openPane($)

  expect(await ui.find({ type: 'Client', key: APP_BLOCK })).toBeDefined()
  const code = await ui.find({ type: 'Code', in: APP_BLOCK })
  expect(code?.props).toMatchObject({ format: 'diff', path: 'src/app.js', wrap: 'truncate-end' })
})

test('draws plain diff blocks where the surface has no client', async ($, on) => {
  fakeGit(on, BRANCH)
  const ui = await openPane($, 'vscode')

  expect(await ui.findAll({ type: 'Client' })).toHaveLength(0)
  expect(await ui.findAll({ type: 'Code' })).toHaveLength(2)
})

test('asks git for whole files first, and for changed parts after pressing f', async ($, on) => {
  const calls = fakeGit(on, BRANCH)
  const ui = await openPane($)
  expect(calls).toContain(patch('f0rk', 1000000))
  expect(await ui.find({ key: 'toggle', text: 'changes only' })).toBeDefined()

  await ui.press({ key: 'toggle' })
  expect(calls).toContain(patch('f0rk', 3))
  expect(await ui.find({ key: 'toggle', text: 'whole files' })).toBeDefined()
})

test('splits a long file into blocks and stops drawing past the size budget', async ($, on) => {
  const bigLines = Array.from({ length: 3000 }, (_, i) => '+' + String(i).padEnd(39, 'x'))
  const bigPatch = ['diff --git a/big.txt b/big.txt', '--- /dev/null', '+++ b/big.txt', '@@ -0,0 +1,3000 @@', ...bigLines].join('\n')
  const smallPatch = ['diff --git a/small.txt b/small.txt', '--- a/small.txt', '+++ b/small.txt', '@@ -1 +1 @@', '-a', '+b'].join('\n')
  fakeGit(on, {
    ...BRANCH,
    [numstat('f0rk')]: '3000\t0\tbig.txt\n1\t1\tsmall.txt\n',
    [patch('f0rk', 1000000)]: bigPatch + '\n' + smallPatch + '\n',
  })
  const ui = await openPane($)

  const blocks = await codeBlocks(ui)
  expect(blocks.length).toBeGreaterThan(1)
  for (const block of blocks) expect(block.text.length).toBeLessThanOrEqual(8100)
  expect(blocks[1].text.startsWith('@@ -0,0 +')).toBe(true)
  expect(await ui.find({ key: 'file-small.txt' })).toBeUndefined()
  expect(await ui.find({ text: /1 more file not shown — press f for changed parts only/ })).toBeDefined()
})

test('tags files with uncommitted changes, in the list and above their diff', async ($, on) => {
  fakeGit(on, { ...BRANCH, [`${DIFF} --name-only HEAD`]: 'README.md\n' })
  const ui = await openPane($)

  const tags = await ui.findAll({ type: 'Text', text: '● uncommitted' })
  expect(tags).toHaveLength(2)
})

test('shows no tags when everything is committed', async ($, on) => {
  fakeGit(on, { ...BRANCH, [`${DIFF} --name-only HEAD`]: '' })
  const ui = await openPane($)

  expect(await ui.findAll({ type: 'Text', text: '● uncommitted' })).toHaveLength(0)
})

test('marks a binary file instead of drawing it', async ($, on) => {
  fakeGit(on, {
    ...BRANCH,
    [numstat('f0rk')]: '-\t-\tlogo.png\n',
    [patch('f0rk', 1000000)]: 'diff --git a/logo.png b/logo.png\nBinary files /dev/null and b/logo.png differ\n',
  })
  const ui = await openPane($)

  expect(await ui.find({ key: 'goto-logo.png' })).toBeDefined()
  expect(await ui.find({ text: 'Binary file, not shown' })).toBeDefined()
})

test('draws a file whose name holds a space', async ($, on) => {
  fakeGit(on, {
    ...BRANCH,
    [numstat('f0rk')]: '1\t0\tmy notes.md\n',
    [patch('f0rk', 1000000)]: 'diff --git a/my notes.md b/my notes.md\n--- a/my notes.md\t\n+++ b/my notes.md\t\n@@ -0,0 +1 @@\n+hi\n',
  })
  const ui = await openPane($)

  expect((await codeBlocks(ui))[0]?.text).toBe('@@ -0,0 +1,1 @@\n+hi')
})

test('refreshes shortly after Claude edits a file while the pane is open', async ($, on) => {
  const clock = mock.clock(on)
  const answers = { ...BRANCH }
  fakeGit(on, answers)
  on('tool.call', () => ({ result: 'ok' }))
  const ui = await openPane($)

  answers[patch('f0rk', 1000000)] = APP_PATCH.replace('+const b = 3', '+const b = 4') + '\n' + README_PATCH + '\n'
  await $.tool.call({ tool: 'Edit', file_path: 'src/app.js', old_string: '3', new_string: '4' })
  await clock.advance(300)

  const blocks = await codeBlocks(ui)
  expect(blocks[0].text).toContain('+const b = 4')
})

test('does not run git on edits while the pane is closed', async ($, on) => {
  mock.clock(on)
  const calls = fakeGit(on, BRANCH)
  on('tool.call', () => ({ result: 'ok' }))

  await $.tool.call({ tool: 'Edit', file_path: 'src/app.js', old_string: '3', new_string: '4' })
  expect(calls).toEqual([])
})

test('shows uncommitted changes on the base branch itself', async ($, on) => {
  fakeGit(on, {
    'git symbolic-ref --short refs/remotes/origin/HEAD': 'origin/main\n',
    [verify('origin/main')]: 'abc\n',
    'git merge-base origin/main HEAD': 'head\n',
    [numstat('head')]: '1\t1\tapp.json\n',
    [patch('head', 1000000)]: 'diff --git a/app.json b/app.json\n--- a/app.json\n+++ b/app.json\n@@ -1 +1 @@\n-  "v": 1\n+  "v": 2\n',
  })
  const ui = await openPane($)

  expect((await codeBlocks(ui))[0]?.text).toBe('@@ -1,1 +1,1 @@\n-  "v": 1\n+  "v": 2')
})

test('falls back to main and says when nothing changed', async ($, on) => {
  fakeGit(on, {
    [verify('main')]: 'abc\n',
    'git merge-base main HEAD': 'abc\n',
    [numstat('abc')]: '',
  })
  const ui = await openPane($)

  expect(await ui.find({ text: 'No changes vs main' })).toBeDefined()
})

test('prefers origin/main over a local main when origin/HEAD is not set', async ($, on) => {
  fakeGit(on, {
    [verify('origin/main')]: 'abc\n',
    [verify('main')]: 'head\n',
    'git merge-base origin/main HEAD': 'abc\n',
    [numstat('abc')]: '',
  })
  const ui = await openPane($)

  expect(await ui.find({ text: 'No changes vs origin/main' })).toBeDefined()
})

test('skips an origin/HEAD that names a branch which is gone', async ($, on) => {
  fakeGit(on, {
    'git symbolic-ref --short refs/remotes/origin/HEAD': 'origin/master\n',
    [verify('origin/main')]: 'abc\n',
    'git merge-base origin/main HEAD': 'abc\n',
    [numstat('abc')]: '',
  })
  const ui = await openPane($)

  expect(await ui.find({ text: 'No changes vs origin/main' })).toBeDefined()
})

test('checks a gone origin/HEAD branch only once', async ($, on) => {
  const calls = fakeGit(on, {
    'git symbolic-ref --short refs/remotes/origin/HEAD': 'origin/main\n',
    [verify('origin/master')]: 'abc\n',
    'git merge-base origin/master HEAD': 'abc\n',
    [numstat('abc')]: '',
  })
  const ui = await openPane($)

  expect(await ui.find({ text: 'No changes vs origin/master' })).toBeDefined()
  expect(calls.filter((call) => call === verify('origin/main'))).toHaveLength(1)
})

test('uses the base set in git config before any other', async ($, on) => {
  fakeGit(on, {
    'git config --get branch-diff.base': 'develop\n',
    [verify('develop')]: 'dev\n',
    'git symbolic-ref --short refs/remotes/origin/HEAD': 'origin/main\n',
    [verify('origin/main')]: 'abc\n',
    'git merge-base develop HEAD': 'dev\n',
    [numstat('dev')]: '',
  })
  const ui = await openPane($)

  expect(await ui.find({ text: 'No changes vs develop' })).toBeDefined()
})

test('says when the base set in git config does not exist', async ($, on) => {
  fakeGit(on, { 'git config --get branch-diff.base': 'nope\n', [verify('origin/main')]: 'abc\n' })
  const ui = await openPane($)

  expect(await ui.find({ text: /branch-diff.base is set to nope/ })).toBeDefined()
})

test('shows untracked files as new, with their whole content', async ($, on) => {
  fakeGit(on, {
    ...BRANCH,
    [UNTRACKED]: 'notes.md\0',
    'git rev-parse --show-toplevel': '/repo\n',
    [untrackedPatch('notes.md')]:
      'diff --git a/notes.md b/notes.md\nnew file mode 100644\n--- /dev/null\n+++ b/notes.md\n@@ -0,0 +1,2 @@\n+one\n+two\n',
  })
  const ui = await openPane($)

  expect(await ui.find({ text: 'vs origin/main · 3 files' })).toBeDefined()
  expect(await ui.find({ key: 'goto-notes.md' })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: '● new, untracked' })).toHaveLength(2)
  expect((await codeBlocks(ui)).at(-1)?.text).toBe('@@ -0,0 +1,2 @@\n+one\n+two')
})

test('shows untracked files even when nothing tracked changed', async ($, on) => {
  fakeGit(on, {
    [verify('origin/main')]: 'abc\n',
    'git merge-base origin/main HEAD': 'abc\n',
    [numstat('abc')]: '',
    [UNTRACKED]: 'new file.txt\0',
    'git rev-parse --show-toplevel': '/repo\n',
    [untrackedPatch('new file.txt')]: 'diff --git a/new file.txt b/new file.txt\n--- /dev/null\n+++ b/new file.txt\t\n@@ -0,0 +1 @@\n+hi\n',
  })
  const ui = await openPane($)

  expect(await ui.find({ text: 'vs origin/main · 1 file' })).toBeDefined()
  expect((await codeBlocks(ui))[0]?.text).toBe('@@ -0,0 +1,1 @@\n+hi')
})

test('lists at most 50 untracked files and counts the rest', async ($, on) => {
  const paths = Array.from({ length: 53 }, (_, i) => `f${i}.txt`)
  const calls = fakeGit(on, {
    [verify('origin/main')]: 'abc\n',
    'git merge-base origin/main HEAD': 'abc\n',
    [numstat('abc')]: '',
    [UNTRACKED]: paths.join('\0') + '\0',
    'git rev-parse --show-toplevel': '/repo\n',
  })
  const ui = await openPane($)

  expect(await ui.find({ text: 'vs origin/main · 50 files' })).toBeDefined()
  expect(await ui.find({ text: '3 more untracked files not shown' })).toBeDefined()
  expect(calls).not.toContain(untrackedPatch('f50.txt'))
})

test('leaves out a nested repo among the untracked files', async ($, on) => {
  const calls = fakeGit(on, {
    [verify('origin/main')]: 'abc\n',
    'git merge-base origin/main HEAD': 'abc\n',
    [numstat('abc')]: '',
    [UNTRACKED]: 'vendor/lib/\0notes.md\0',
    'git rev-parse --show-toplevel': '/repo\n',
    [untrackedPatch('notes.md')]: 'diff --git a/notes.md b/notes.md\n--- /dev/null\n+++ b/notes.md\n@@ -0,0 +1 @@\n+hi\n',
  })
  const ui = await openPane($)

  expect(await ui.find({ text: 'vs origin/main · 1 file' })).toBeDefined()
  expect(calls).not.toContain(untrackedPatch('vendor/lib/'))
})

test('draws an untracked file whose name git quotes', async ($, on) => {
  fakeGit(on, {
    [verify('origin/main')]: 'abc\n',
    'git merge-base origin/main HEAD': 'abc\n',
    [numstat('abc')]: '',
    [UNTRACKED]: 'say "hi".txt\0',
    'git rev-parse --show-toplevel': '/repo\n',
    [untrackedPatch('say "hi".txt')]: 'diff --git "a/say \\"hi\\".txt" "b/say \\"hi\\".txt"\n--- /dev/null\n+++ "b/say \\"hi\\".txt"\n@@ -0,0 +1 @@\n+hi\n',
  })
  const ui = await openPane($)

  expect(await ui.find({ text: '+1' })).toBeDefined()
  expect((await codeBlocks(ui))[0]?.text).toBe('@@ -0,0 +1,1 @@\n+hi')
})

test('shows an error outside a repo with no base branch', async ($, on) => {
  fakeGit(on, {})
  const ui = await openPane($)

  expect(await ui.find({ text: /No base branch found/ })).toBeDefined()
})

// Review comments. src/app.js rows: 0 ' const a = 1' (L1), 1 '-const b = 2' (old L2), 2 '+const b = 3' (L2).

async function click(ui, block: string, y: number, shift = false) {
  await ui.pointer({ type: 'down', x: 3, y, button: 'left', in: block, ...(shift ? { shift: true } : {}) })
  await ui.pointer({ type: 'up', x: 3, y, button: 'left', in: block })
}

const boxLabel = async (ui) => (await ui.find({ key: 'comment-box' }))?.props.label
const marksOf = async (ui, block: string) => (await ui.find({ type: 'Client', key: block }))?.props.props.marks

async function saveDraft(ui, y: number, text: string) {
  await click(ui, APP_BLOCK, y)
  await ui.input({ key: 'comment-box', text })
}

test('opens a comment box under a clicked line', async ($, on) => {
  fakeGit(on, BRANCH)
  const ui = await openPane($)

  await click(ui, APP_BLOCK, 2)
  expect(await boxLabel(ui)).toBe('L2')
  expect(await marksOf(ui, APP_BLOCK)).toBe('  ▌')
})

test('opens the comment box on a click whose down and up arrive together', async ($, on) => {
  fakeGit(on, BRANCH)
  const ui = await openPane($)

  await Promise.all([
    ui.pointer({ type: 'down', x: 3, y: 2, button: 'left', in: APP_BLOCK }),
    ui.pointer({ type: 'up', x: 3, y: 2, button: 'left', in: APP_BLOCK }),
  ])
  expect(await boxLabel(ui)).toBe('L2')
})

test('selects a dragged range, held inside the block where the drag started', async ($, on) => {
  fakeGit(on, BRANCH)
  const ui = await openPane($)

  await ui.pointer({ type: 'down', x: 3, y: 0, button: 'left', in: APP_BLOCK })
  await ui.pointer({ type: 'move', x: 3, y: 9, button: 'left', in: APP_BLOCK })
  await ui.pointer({ type: 'up', x: 3, y: 9, button: 'left', in: APP_BLOCK })
  expect(await boxLabel(ui)).toBe('L1-2, old L2')
})

test('extends the open selection with a shift-click', async ($, on) => {
  fakeGit(on, BRANCH)
  const ui = await openPane($)

  await click(ui, APP_BLOCK, 0)
  expect(await boxLabel(ui)).toBe('L1')
  // The box sits under row 0, so rows 1-2 are now their own block.
  await click(ui, 'block-src/app.js-1', 1, true)
  expect(await boxLabel(ui)).toBe('L1-2, old L2')
})

test('starts a new selection when a shift-click lands in another file', async ($, on) => {
  fakeGit(on, BRANCH)
  const ui = await openPane($)

  await click(ui, APP_BLOCK, 0)
  await click(ui, 'block-README.md-0', 0, true)
  expect(await boxLabel(ui)).toBe('L1')
  expect(await marksOf(ui, 'block-README.md-0')).toBe('▌')
  expect(await marksOf(ui, APP_BLOCK)).toBe('   ')
})

test('saves a comment as a draft marked on its lines', async ($, on) => {
  fakeGit(on, BRANCH)
  const ui = await openPane($)

  await saveDraft(ui, 2, 'rename')
  expect((await ui.find({ key: 'draft-1' }))?.text).toContain('✎ L2: rename')
  expect(await marksOf(ui, APP_BLOCK)).toBe('  ✎')
  expect(await ui.find({ key: 'comment-box' })).toBeUndefined()
})

test('drops the comment when it is blank or cancelled', async ($, on) => {
  fakeGit(on, BRANCH)
  const ui = await openPane($)

  await saveDraft(ui, 2, '   ')
  expect(await ui.find({ key: 'comment-box' })).toBeUndefined()
  expect(await ui.find({ key: 'draft-1' })).toBeUndefined()

  await click(ui, APP_BLOCK, 2)
  await ui.press({ key: 'cancel-comment' })
  expect(await ui.find({ key: 'comment-box' })).toBeUndefined()
})

test('deletes a draft', async ($, on) => {
  fakeGit(on, BRANCH)
  const ui = await openPane($)

  await saveDraft(ui, 2, 'rename')
  await ui.press({ key: 'delete-1' })
  expect(await ui.find({ key: 'draft-1' })).toBeUndefined()
  expect(await marksOf(ui, APP_BLOCK)).toBe('   ')
})

test('keeps an open comment box on its line numbers when the diff refreshes', async ($, on) => {
  const answers = { ...BRANCH }
  fakeGit(on, answers)
  const ui = await openPane($)

  await click(ui, APP_BLOCK, 2)
  answers[patch('f0rk', 1000000)] = APP_PATCH.replace('@@ -1,2 +1,2 @@\n const a = 1', '@@ -1,2 +1,3 @@\n+const z = 0\n const a = 1') + '\n'
  await ui.press({ key: 'refresh' })

  expect(await boxLabel(ui)).toBe('L2')
  expect(await marksOf(ui, APP_BLOCK)).toBe(' ▌')
})

test('keeps drafts when switching to changed parts only', async ($, on) => {
  fakeGit(on, BRANCH)
  const ui = await openPane($)

  await saveDraft(ui, 2, 'rename')
  await ui.press({ key: 'toggle' })
  expect(await ui.find({ key: 'draft-1' })).toBeDefined()
})

test('keeps a draft whose lines are gone, under its file name', async ($, on) => {
  const answers = { ...BRANCH }
  fakeGit(on, answers)
  const ui = await openPane($)

  await saveDraft(ui, 2, 'rename')
  answers[patch('f0rk', 1000000)] = APP_PATCH.replace(' const a = 1\n-const b = 2\n+const b = 3', '-const a = 1\n+const a = 0').replace('-1,2 +1,2', '-1 +1') + '\n'
  await ui.press({ key: 'refresh' })

  expect((await ui.find({ key: 'draft-1' }))?.text).toContain('✎ L2: rename')
})

test('lists drafts whose file left the diff, so they can still be seen and deleted', async ($, on) => {
  const answers = { ...BRANCH }
  fakeGit(on, answers)
  const ui = await openPane($)

  await saveDraft(ui, 2, 'revert this')
  answers[numstat('f0rk')] = '1\t0\tREADME.md\n'
  answers[patch('f0rk', 1000000)] = README_PATCH + '\n'
  await ui.press({ key: 'refresh' })

  expect((await ui.find({ key: 'draft-1' }))?.text).toContain('src/app.js ✎ L2: revert this')
  await ui.press({ key: 'delete-1' })
  expect(await ui.find({ key: 'send' })).toBeUndefined()
})

test('turns the pane hotkeys off while a comment is typed', async ($, on) => {
  fakeGit(on, BRANCH)
  const ui = await openPane($)

  await saveDraft(ui, 2, 'rename')
  await click(ui, APP_BLOCK, 0)
  for (const key of ['send', 'toggle', 'refresh']) expect((await ui.find({ key }))?.props.hotkey).toBeUndefined()

  await ui.press({ key: 'cancel-comment' })
  expect((await ui.find({ key: 'send' }))?.props.hotkey).toBe('s')
})

test('lists an open comment box whose lines are gone, so it can still be used', async ($, on) => {
  const answers = { ...BRANCH }
  fakeGit(on, answers)
  const ui = await openPane($)

  await click(ui, APP_BLOCK, 2)
  answers[numstat('f0rk')] = '1\t0\tREADME.md\n'
  answers[patch('f0rk', 1000000)] = README_PATCH + '\n'
  await ui.press({ key: 'refresh' })

  expect(await boxLabel(ui)).toBe('src/app.js L2')
})

test('keeps the drafts when sending fails', async ($, on) => {
  fakeGit(on, BRANCH)
  on('prompt.submit', async () => {
    throw new Error('busy')
  })
  const ui = await openPane($)

  await saveDraft(ui, 2, 'rename')
  await ui.press({ key: 'send' }).catch(() => {})
  expect(await ui.find({ key: 'draft-1' })).toBeDefined()
})

test('sends a half-typed comment along with the drafts', async ($, on) => {
  fakeGit(on, BRANCH)
  const submitted = []
  on('prompt.submit', async ($, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  const ui = await openPane($)

  await saveDraft(ui, 2, 'rename')
  await click(ui, APP_BLOCK, 0)
  await ui.input({ key: 'comment-box', text: 'half typed', kind: 'change' })
  await ui.press({ key: 'send' })

  expect(submitted[0]).toContain('rename')
  expect(submitted[0]).toContain('half typed')
})

test('offers no send button without drafts, nor where there is no mouse', async ($, on) => {
  fakeGit(on, BRANCH)
  const ui = await openPane($)
  expect(await ui.find({ key: 'send' })).toBeUndefined()

  await saveDraft(ui, 2, 'rename')
  const plain = await $.ui.mount({ plugin: PLUGIN, surface: 'vscode', component: 'Pane', props: PANE_PROPS, requestId: PANE })
  expect(await plain.find({ key: 'send' })).toBeUndefined()
})

test('sends all drafts as one review message, then clears them', async ($, on) => {
  fakeGit(on, BRANCH)
  const submitted = []
  on('prompt.submit', async ($, e) => {
    submitted.push(e)
    return { text: e.text }
  })
  const ui = await openPane($)

  await saveDraft(ui, 2, 'rename')
  await saveDraft(ui, 0, 'why?')
  expect((await ui.find({ key: 'send' }))?.props.label).toBe('send 2 comments')
  await ui.press({ key: 'send' })

  expect(submitted).toHaveLength(1)
  expect(submitted[0].text).toBe(
    [
      'Review comments on this branch (vs origin/main). Please address each one.',
      '',
      '1. src/app.js L2',
      '```diff',
      '+const b = 3',
      '```',
      'rename',
      '',
      '2. src/app.js L1',
      '```diff',
      ' const a = 1',
      '```',
      'why?',
    ].join('\n'),
  )
  expect(submitted[0].origin).toMatchObject({ asUser: true })
  expect(await ui.find({ key: 'draft-1' })).toBeUndefined()
  expect(await ui.find({ key: 'send' })).toBeUndefined()
})

// Worktrees. The session runs in /repo (see fakeGit), whose main worktree has no
// changes; the feat worktree holds the BRANCH changes.

const MAIN = '/repo'
const FEAT = '/repo/.claude/worktrees/feat'
const inDir = (dir: string, answers: Record<string, string>) =>
  Object.fromEntries(Object.entries(answers).map(([argv, stdout]) => [`${dir}: ${argv}`, stdout]))

const WORKTREES = {
  'git worktree list --porcelain': `worktree ${MAIN}\nHEAD abc\nbranch refs/heads/main\n\nworktree ${FEAT}\nHEAD def\nbranch refs/heads/feat\n\n`,
  ...inDir(MAIN, { [verify('origin/main')]: 'abc\n', 'git merge-base origin/main HEAD': 'abc\n', [numstat('abc')]: '' }),
  ...inDir(FEAT, BRANCH),
}

function inSession(on, answers = WORKTREES) {
  const clock = mock.clock(on)
  const calls = fakeGit(on, answers)
  return { clock, calls }
}

async function editIn(dir: string, $, clock) {
  await $.tool.call({ tool: 'Edit', file_path: dir + '/src/app.js', old_string: '3', new_string: '4' })
  await clock.advance(300)
}

const pickerLabel = async (ui) => (await ui.find({ key: 'worktree' }))?.props.label

async function pickWorktree(ui, value: string) {
  await ui.press({ key: 'worktree' })
  await ui.press({ key: 'worktree-' + value })
}

async function optionLabels(ui, values: string[]) {
  await ui.press({ key: 'worktree' })
  return Promise.all(values.map(async (value) => (await ui.find({ key: 'worktree-' + value }))?.props.label))
}

test('starts on the worktree the session runs in', async ($, on) => {
  inSession(on)
  const ui = await openPane($)

  expect(await ui.find({ text: 'No changes vs origin/main' })).toBeDefined()
  expect(await pickerLabel(ui)).toBe('worktree: follow Claude (main) ▾')
})

test('opens the worktree list on a press and closes it after a pick', async ($, on) => {
  inSession(on)
  const ui = await openPane($)
  expect(await ui.find({ key: 'worktree-' + FEAT })).toBeUndefined()

  await ui.press({ key: 'worktree' })
  expect(await pickerLabel(ui)).toBe('worktree: follow Claude (main) ▴')
  await ui.press({ key: 'worktree-' + FEAT })
  expect(await ui.find({ key: 'worktree-' + FEAT })).toBeUndefined()
  expect(await pickerLabel(ui)).toBe('worktree: feat ▾')
})

test('follows the worktree Claude edits files in', async ($, on) => {
  const { clock } = inSession(on)
  on('tool.call', () => ({ result: 'ok' }))
  const ui = await openPane($)

  await editIn(FEAT, $, clock)
  expect(await ui.find({ text: 'vs origin/main · 2 files' })).toBeDefined()
})

test('follows the worktree Claude enters', async ($, on) => {
  const { clock } = inSession(on)
  on('tool.call', () => ({ result: { worktreePath: FEAT, message: 'entered' } }))
  const ui = await openPane($)

  await $.tool.call({ tool: 'EnterWorktree', name: 'feat' })
  await clock.advance(300)
  expect(await ui.find({ text: 'vs origin/main · 2 files' })).toBeDefined()
})

test('remembers where Claude worked while the pane was closed', async ($, on) => {
  const { clock } = inSession(on)
  on('tool.call', () => ({ result: 'ok' }))

  await editIn(FEAT, $, clock)
  const ui = await openPane($)
  expect(await ui.find({ text: 'vs origin/main · 2 files' })).toBeDefined()
})

test('steps to the next worktree with w, then back to following Claude', async ($, on) => {
  inSession(on)
  const ui = await openPane($)
  expect((await ui.find({ key: 'next-worktree' }))?.props.hotkey).toBe('w')

  await ui.press({ key: 'next-worktree' })
  expect(await pickerLabel(ui)).toBe('worktree: main ▾')
  await ui.press({ key: 'next-worktree' })
  expect(await pickerLabel(ui)).toBe('worktree: feat ▾')
  expect(await ui.find({ text: 'vs origin/main · 2 files' })).toBeDefined()
  await ui.press({ key: 'next-worktree' })
  expect(await pickerLabel(ui)).toBe('worktree: follow Claude (main) ▾')
})

test('names the followed worktree in the picker', async ($, on) => {
  const { clock } = inSession(on)
  on('tool.call', () => ({ result: 'ok' }))
  const ui = await openPane($)

  await editIn(FEAT, $, clock)
  expect(await pickerLabel(ui)).toBe('worktree: follow Claude (feat) ▾')
  expect(await optionLabels(ui, ['follow', MAIN, FEAT])).toEqual(['follow Claude (feat)', 'main', 'feat'])
})

test('keeps the picked worktree while Claude works in another', async ($, on) => {
  const { clock } = inSession(on)
  on('tool.call', () => ({ result: 'ok' }))
  const ui = await openPane($)

  await pickWorktree(ui, FEAT)
  expect(await ui.find({ text: 'vs origin/main · 2 files' })).toBeDefined()
  await editIn(MAIN, $, clock)
  expect(await ui.find({ text: 'vs origin/main · 2 files' })).toBeDefined()

  await pickWorktree(ui, 'follow')
  expect(await ui.find({ text: 'No changes vs origin/main' })).toBeDefined()
})

test('goes back to following Claude when the picked worktree is removed', async ($, on) => {
  const answers = { ...WORKTREES, 'git worktree list --porcelain': WORKTREES['git worktree list --porcelain'] + `worktree /tmp/spike\nHEAD def\ndetached\n\n` }
  inSession(on, answers)
  const ui = await openPane($)

  await pickWorktree(ui, '/tmp/spike')
  answers['git worktree list --porcelain'] = WORKTREES['git worktree list --porcelain']
  await ui.press({ key: 'refresh' })
  expect(await pickerLabel(ui)).toBe('worktree: follow Claude (main) ▾')
})

test('names a detached worktree by its folder and leaves out a bare repo', async ($, on) => {
  inSession(on, {
    ...WORKTREES,
    'git worktree list --porcelain': `worktree /repo.git\nbare\n\nworktree ${MAIN}\nHEAD abc\nbranch refs/heads/main\n\nworktree /tmp/spike\nHEAD def\ndetached\n\n`,
  })
  const ui = await openPane($)

  expect(await optionLabels(ui, ['follow', MAIN, '/tmp/spike'])).toEqual(['follow Claude (main)', 'main', 'spike (detached)'])
  expect(await ui.find({ key: 'worktree-/repo.git' })).toBeUndefined()
})

test('offers no worktree picker in a repo with one worktree', async ($, on) => {
  fakeGit(on, BRANCH)
  const ui = await openPane($)

  expect(await ui.find({ key: 'worktree' })).toBeUndefined()
  expect(await ui.find({ key: 'next-worktree' })).toBeUndefined()
})

test('keeps each draft with the worktree it was written in', async ($, on) => {
  inSession(on, { ...WORKTREES, ...inDir(MAIN, BRANCH) })
  const ui = await openPane($)

  await pickWorktree(ui, FEAT)
  await saveDraft(ui, 2, 'rename')
  await pickWorktree(ui, MAIN)
  expect(await ui.find({ key: 'draft-1' })).toBeUndefined()
  expect(await ui.find({ key: 'send' })).toBeUndefined()

  await pickWorktree(ui, FEAT)
  expect(await ui.find({ key: 'draft-1' })).toBeDefined()
})

test('closes an open comment box when the worktree changes', async ($, on) => {
  inSession(on, { ...WORKTREES, ...inDir(MAIN, BRANCH) })
  const ui = await openPane($)

  await click(ui, APP_BLOCK, 2)
  await pickWorktree(ui, FEAT)
  expect(await ui.find({ key: 'comment-box' })).toBeUndefined()
})

test('names the worktree in the review message', async ($, on) => {
  inSession(on)
  const submitted = []
  on('prompt.submit', async ($, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  const ui = await openPane($)

  await pickWorktree(ui, FEAT)
  await saveDraft(ui, 2, 'rename')
  await ui.press({ key: 'send' })
  expect(submitted[0]).toMatch(/^Review comments on this branch \(vs origin\/main\), in the worktree at \/repo\/\.claude\/worktrees\/feat\. /)
})

const LIST = 'git worktree list --porcelain'

test('keeps the newest refresh when an older one finishes after it', async ($, on) => {
  let release
  const gate = new Promise<void>((resolve) => (release = resolve))
  let holdsLeft = 0
  const holdMainStat = (key: string) => (key === `${MAIN}: ${numstat('abc')}` && holdsLeft-- > 0 ? gate : undefined)
  mock.clock(on)
  fakeGit(on, WORKTREES, holdMainStat)
  const ui = await openPane($)

  holdsLeft = 1
  const slow = ui.press({ key: 'refresh' })
  await pickWorktree(ui, FEAT)
  release()
  await slow

  expect(await pickerLabel(ui)).toBe('worktree: feat ▾')
  expect(await ui.find({ text: 'vs origin/main · 2 files' })).toBeDefined()
})

test('keeps following a worktree when Claude edits a file outside every worktree', async ($, on) => {
  const { clock } = inSession(on)
  on('tool.call', () => ({ result: 'ok' }))
  const ui = await openPane($)

  await editIn(FEAT, $, clock)
  await $.tool.call({ tool: 'Write', file_path: '/tmp/notes.txt', content: 'hi' })
  await clock.advance(300)
  expect(await pickerLabel(ui)).toBe('worktree: follow Claude (feat) ▾')
})

test('keeps a half-typed comment as a draft when following moves to another worktree', async ($, on) => {
  const { clock } = inSession(on, { ...WORKTREES, ...inDir(MAIN, BRANCH) })
  on('tool.call', () => ({ result: 'ok' }))
  const ui = await openPane($)

  await click(ui, APP_BLOCK, 2)
  await ui.input({ key: 'comment-box', text: 'half typed', kind: 'change' })
  await editIn(FEAT, $, clock)
  await pickWorktree(ui, MAIN)
  expect((await ui.find({ key: 'draft-1' }))?.text).toContain('half typed')
})

test('shows drafts whose worktree is gone, so they can still be sent or deleted', async ($, on) => {
  const answers = { ...WORKTREES, [LIST]: WORKTREES[LIST] + `worktree /tmp/spike\nHEAD def\nbranch refs/heads/spike\n\n`, ...inDir('/tmp/spike', BRANCH) }
  inSession(on, answers)
  const ui = await openPane($)

  await pickWorktree(ui, '/tmp/spike')
  await saveDraft(ui, 2, 'rename')
  answers[LIST] = WORKTREES[LIST]
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ key: 'draft-1' })).toBeDefined()
})

test('goes back to the session worktree when Claude leaves a worktree', async ($, on) => {
  const { clock } = inSession(on)
  on('tool.call', ($, e) => ({ result: e.tool === 'EnterWorktree' ? { worktreePath: FEAT, message: '' } : { message: '' } }))
  const ui = await openPane($)

  await $.tool.call({ tool: 'EnterWorktree', name: 'feat' })
  await $.tool.call({ tool: 'ExitWorktree', action: 'keep' })
  await clock.advance(300)
  expect(await pickerLabel(ui)).toBe('worktree: follow Claude (main) ▾')
})

test('follows an edit through a symlinked path, asking git for its worktree', async ($, on) => {
  const { clock } = inSession(on, { ...WORKTREES, 'git -C /link/feat/src rev-parse --show-toplevel': FEAT + '\n' })
  on('tool.call', () => ({ result: 'ok' }))
  const ui = await openPane($)

  await editIn('/link/feat', $, clock)
  expect(await pickerLabel(ui)).toBe('worktree: follow Claude (feat) ▾')
})

test('follows an edit whose path uses backslashes', async ($, on) => {
  const { clock } = inSession(on)
  on('tool.call', () => ({ result: 'ok' }))
  const ui = await openPane($)

  await $.tool.call({ tool: 'Edit', file_path: FEAT.replaceAll('/', '\\') + '\\app.js', old_string: '3', new_string: '4' })
  await clock.advance(300)
  expect(await pickerLabel(ui)).toBe('worktree: follow Claude (feat) ▾')
})

test('keeps the picked worktree when listing worktrees fails once', async ($, on) => {
  const answers = { ...WORKTREES }
  inSession(on, answers)
  const ui = await openPane($)

  await pickWorktree(ui, FEAT)
  delete answers[LIST]
  await ui.press({ key: 'refresh' })
  answers[LIST] = WORKTREES[LIST]
  await ui.press({ key: 'refresh' })
  expect(await pickerLabel(ui)).toBe('worktree: feat ▾')
})

test('leaves out a worktree whose folder was deleted', async ($, on) => {
  inSession(on, { ...WORKTREES, [LIST]: WORKTREES[LIST] + `worktree /gone\nHEAD def\nbranch refs/heads/gone\nprunable gitdir file points to non-existent location\n\n` })
  const ui = await openPane($)

  await ui.press({ key: 'worktree' })
  expect(await ui.find({ key: 'worktree-/gone' })).toBeUndefined()
})

test('closes the worktree list when the second worktree goes away', async ($, on) => {
  const answers = { ...WORKTREES }
  inSession(on, answers)
  const ui = await openPane($)

  await ui.press({ key: 'worktree' })
  answers[LIST] = `worktree ${MAIN}\nHEAD abc\nbranch refs/heads/main\n\n`
  await ui.press({ key: 'refresh' })
  answers[LIST] = WORKTREES[LIST]
  await ui.press({ key: 'refresh' })
  expect(await ui.find({ key: 'worktree-' + FEAT })).toBeUndefined()
})
