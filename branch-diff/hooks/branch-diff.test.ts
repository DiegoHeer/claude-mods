import { expect, mock, test } from 'claude-code/testing'

const PLUGIN = 'branch-diff'
const PANE_PROPS = { title: 'Branch diff', bodyColumns: 80 } as never

const DIFF = 'git -c core.quotePath=false diff --no-ext-diff --no-textconv --no-renames'
const numstat = (forkPoint: string) => `${DIFF} --numstat ${forkPoint}`
const patch = (forkPoint: string, context: number) => `${DIFF} -U${context} ${forkPoint}`

// Fake git: answers each command the mod runs from a table of argv → stdout.
// The table is read on every call, so a test can change it between refreshes.
function fakeGit(on, answers: Record<string, string>) {
  const calls: string[] = []
  on('process.run', async ($, e) => {
    const key = e.argv.join(' ')
    calls.push(key)
    if (key in answers) return { value: { exitCode: 0, stdout: answers[key], stderr: '' } }
    return { value: { exitCode: 1, stdout: '', stderr: 'unexpected: ' + key } }
  })
  on('command.register', async () => ({ value: undefined }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  return calls
}

async function openPane($) {
  await $.command.run({ command: 'branch-diff', args: '' })
  return $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', props: PANE_PROPS, requestId: PLUGIN })
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
  'git merge-base origin/main HEAD': 'f0rk\n',
  [numstat('f0rk')]: '1\t1\tsrc/app.js\n1\t0\tREADME.md\n',
  [patch('f0rk', 1000000)]: APP_PATCH + '\n' + README_PATCH + '\n',
  [patch('f0rk', 3)]: APP_PATCH + '\n' + README_PATCH + '\n',
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`stacks every changed file as a built-in diff block (${surface})`, async ($, on) => {
    fakeGit(on, BRANCH)
    await $.command.run({ command: 'branch-diff', args: '' })
    const ui = await $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', props: PANE_PROPS, requestId: PLUGIN })

    expect(await ui.find({ text: 'vs origin/main · 2 files' })).toBeDefined()
    expect(await ui.find({ key: 'goto-src/app.js', text: 'src/app.js' })).toBeDefined()
    expect(await ui.find({ key: 'file-src/app.js' })).toBeDefined()
    expect(await ui.find({ key: 'file-README.md' })).toBeDefined()

    // One solid rule opens each file and one closes the last.
    expect(await ui.findAll({ type: 'Text', text: '━━━━' })).toHaveLength(3)

    const blocks = await ui.findAll({ type: 'Code' })
    expect(blocks.map((b) => b.text)).toEqual([
      '@@ -1,2 +1,2 @@\n const a = 1\n-const b = 2\n+const b = 3',
      '@@ -0,0 +1,1 @@\n+# Hello',
    ])
  })
}

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

  const blocks = await ui.findAll({ type: 'Code' })
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

test('refreshes shortly after Claude edits a file while the pane is open', async ($, on) => {
  const clock = mock.clock(on)
  const answers = { ...BRANCH }
  fakeGit(on, answers)
  on('tool.call', () => ({ result: 'ok' }))
  const ui = await openPane($)

  answers[patch('f0rk', 1000000)] = APP_PATCH.replace('+const b = 3', '+const b = 4') + '\n' + README_PATCH + '\n'
  await $.tool.call({ tool: 'Edit', file_path: 'src/app.js', old_string: '3', new_string: '4' })
  await clock.advance(300)

  const blocks = await ui.findAll({ type: 'Code' })
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
    'git merge-base origin/main HEAD': 'head\n',
    [numstat('head')]: '1\t1\tapp.json\n',
    [patch('head', 1000000)]: 'diff --git a/app.json b/app.json\n--- a/app.json\n+++ b/app.json\n@@ -1 +1 @@\n-  "v": 1\n+  "v": 2\n',
  })
  const ui = await openPane($)

  expect((await ui.find({ type: 'Code' }))?.text).toBe('@@ -1,1 +1,1 @@\n-  "v": 1\n+  "v": 2')
})

test('falls back to main and says when nothing changed', async ($, on) => {
  fakeGit(on, {
    'git rev-parse --verify --quiet main': 'abc\n',
    'git merge-base main HEAD': 'abc\n',
    [numstat('abc')]: '',
  })
  const ui = await openPane($)

  expect(await ui.find({ text: 'No changes vs main' })).toBeDefined()
})

test('shows an error outside a repo with no base branch', async ($, on) => {
  fakeGit(on, {})
  const ui = await openPane($)

  expect(await ui.find({ text: /No base branch found/ })).toBeDefined()
})
