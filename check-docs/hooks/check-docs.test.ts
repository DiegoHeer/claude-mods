import { expect, mock, test } from 'claude-code/testing'

const PLUGIN = 'check-docs'
const PANE = 'check-docs'
const PANE_PROPS = { title: 'Check docs', bodyColumns: 80 } as never

let nextId = 0
const write = (path: string) => ({
  role: 'assistant' as const,
  text: '',
  toolUses: [{ tool_use_id: `t${++nextId}`, tool: 'Write', input: { file_path: path, content: '#' }, text: 'ok' }],
})

// Fake engine: the conversation (its id and rows), the files on disk and the open
// panes, all read on every call so a test can change them between steps.
function fakeEngine(on, world: { rows: unknown[]; files: Record<string, string | Error>; conversation?: string }) {
  const panes = new Set<string>()
  const closed: string[] = []
  mock.store(on)
  on('command.register', async () => ({ value: undefined }))
  on('classic.SessionStart', async () => ({}))
  on('session.id', async () => ({ value: world.conversation ?? 'c1' }))
  on('session.messages', async () => ({ value: world.rows }))
  on('fs.exists', async ($, e) => ({ value: e.path in world.files }))
  on('fs.read', async ($, e) => {
    const file = world.files[e.path]
    return typeof file === 'string' ? { value: file } : { deny: 'unreadable' }
  })
  on('ui.open', async ($, e) => (panes.add(e.id), { value: { isPlaced: true } }))
  on('ui.close', async ($, e, next) => {
    if (e.origin.kind !== 'plugin') return next(e)
    panes.delete(e.id)
    closed.push(e.id)
    return { value: undefined }
  })
  on('ui.panes', async () => ({ value: [...panes].map((id) => ({ id, title: 'Check docs', isShown: true, isFocused: true, isPlaced: true })) }))
  return { closed }
}

async function openPane($, surface: 'terminal' | 'desktop' = 'terminal') {
  await $.command.run({ command: 'check-docs', args: '' })
  return $.ui.mount({ plugin: PLUGIN, surface, component: 'Pane', props: PANE_PROPS, requestId: PANE })
}

const readerText = async (ui) => (await ui.find({ key: 'reader' }))?.text
const tabKeys = async (ui) => (await ui.findAll({ type: 'Button' })).map((b) => b.key).filter((k) => k.startsWith('tab-'))

const TWO_FILES = () => ({
  rows: [write('/r/a.md'), write('/r/b.md')],
  files: { '/r/a.md': '# A doc', '/r/b.md': '# B doc' } as Record<string, string | Error>,
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`opens with the newest file selected and drawn (${surface})`, async ($, on) => {
    fakeEngine(on, TWO_FILES())
    const ui = await openPane($, surface)
    expect(await readerText(ui)).toBe('# B doc')
    expect(await tabKeys(ui)).toEqual(['tab-/r/b.md', 'tab-/r/a.md'])
    expect(await ui.find({ key: 'tab-/r/b.md', text: 'b.md' })).toBeDefined()
  })

  test(`n and p move between tabs, wrapping (${surface})`, async ($, on) => {
    fakeEngine(on, TWO_FILES())
    const ui = await openPane($, surface)
    await ui.press({ key: 'next' })
    expect(await readerText(ui)).toBe('# A doc')
    await ui.press({ key: 'next' })
    expect(await readerText(ui)).toBe('# B doc')
    await ui.press({ key: 'previous' })
    expect(await readerText(ui)).toBe('# A doc')
  })

  test(`pressing a tab selects it (${surface})`, async ($, on) => {
    fakeEngine(on, TWO_FILES())
    const ui = await openPane($, surface)
    await ui.press({ key: 'tab-/r/a.md' })
    expect(await readerText(ui)).toBe('# A doc')
  })

  test(`shows the key hint and the file's path (${surface})`, async ($, on) => {
    fakeEngine(on, TWO_FILES())
    const ui = await openPane($, surface)
    expect(await ui.find({ key: 'next', text: 'next' })).toBeDefined()
    expect(await ui.find({ key: 'previous', text: 'previous' })).toBeDefined()
    expect((await ui.find({ key: 'next' }))?.props.hotkey).toBe('n')
    expect((await ui.find({ key: 'previous' }))?.props.hotkey).toBe('p')
    expect(await ui.find({ text: '/r/b.md' })).toBeDefined()
  })

  test(`says when nothing was written (${surface})`, async ($, on) => {
    fakeEngine(on, { rows: [], files: {} })
    const ui = await openPane($, surface)
    expect(await ui.find({ text: 'No markdown files written in this conversation yet.' })).toBeDefined()
  })

  test(`keeps a deleted file's tab (${surface})`, async ($, on) => {
    fakeEngine(on, { rows: [write('/r/gone.md')], files: {} })
    const ui = await openPane($, surface)
    expect(await tabKeys(ui)).toEqual(['tab-/r/gone.md'])
    expect(await readerText(ui)).toBe('This file was deleted.')
  })
}

test('running the command again closes the pane', async ($, on) => {
  const { closed } = fakeEngine(on, TWO_FILES())
  await openPane($)
  await $.command.run({ command: 'check-docs', args: '' })
  expect(closed).toEqual([PANE])
})

test('cuts a huge file', async ($, on) => {
  fakeEngine(on, { rows: [write('/r/big.md')], files: { '/r/big.md': 'x'.repeat(150_000) } })
  const ui = await openPane($)
  const text = await readerText(ui)
  expect(text.startsWith('x'.repeat(89_000))).toBe(true)
  expect(text.endsWith('_File cut at 90 000 characters._')).toBe(true)
  expect(text.length).toBeLessThanOrEqual(90_000)
})

test('survives an unreadable file', async ($, on) => {
  fakeEngine(on, { rows: [write('/r/locked.md')], files: { '/r/locked.md': new Error('no') } })
  const ui = await openPane($)
  expect(await readerText(ui)).toBe('This file could not be read.')
})

// The engine's own answer to a tool call, beneath the mod's hook.
const toolsSucceed = (on) => on('tool.call', async () => ({ result: 'ok' }))

test('a new file gets a tab without moving the selection', async ($, on) => {
  const world = TWO_FILES()
  fakeEngine(on, world)
  toolsSucceed(on)
  const clock = mock.clock(on)
  const ui = await openPane($)
  await ui.press({ key: 'tab-/r/a.md' })

  world.rows = [...world.rows, write('/r/new.md')]
  world.files['/r/new.md'] = '# New'
  await $.tool.call({ tool: 'Write', file_path: '/r/new.md', content: '# New' })
  await clock.advance(300)

  expect(await tabKeys(ui)).toEqual(['tab-/r/new.md', 'tab-/r/b.md', 'tab-/r/a.md'])
  expect(await readerText(ui)).toBe('# A doc')
})

test('an edit redraws the selected file', async ($, on) => {
  const world = TWO_FILES()
  fakeEngine(on, world)
  toolsSucceed(on)
  const clock = mock.clock(on)
  const ui = await openPane($)

  world.files['/r/b.md'] = '# B doc, edited'
  await $.tool.call({ tool: 'Edit', file_path: '/r/b.md', old_string: 'doc', new_string: 'doc, edited' })
  await clock.advance(300)

  expect(await readerText(ui)).toBe('# B doc, edited')
})

test('a shell command redraws without adding a tab', async ($, on) => {
  const world = TWO_FILES()
  fakeEngine(on, world)
  toolsSucceed(on)
  const clock = mock.clock(on)
  const ui = await openPane($)

  world.files['/r/b.md'] = '# B doc, by sed'
  world.files['/r/other.md'] = '# Other'
  await $.tool.call({ tool: 'Bash', command: 'sed -i s/x/y/ /r/b.md' })
  await clock.advance(300)

  expect(await readerText(ui)).toBe('# B doc, by sed')
  expect(await tabKeys(ui)).toEqual(['tab-/r/b.md', 'tab-/r/a.md'])
})

test('/clear empties the tabs', async ($, on) => {
  const world = TWO_FILES()
  fakeEngine(on, world)
  const ui = await openPane($)

  world.rows = []
  world.conversation = 'c2'
  await $.classic.SessionStart({ source: 'clear' })

  expect(await ui.find({ text: 'No markdown files written in this conversation yet.' })).toBeDefined()
})

test('a compaction keeps the tabs whose writes it summarized away', async ($, on) => {
  const world = TWO_FILES()
  fakeEngine(on, world)
  const ui = await openPane($)

  world.rows = []
  await $.classic.SessionStart({ source: 'compact' })

  expect(await tabKeys(ui)).toEqual(['tab-/r/b.md', 'tab-/r/a.md'])
})

test("resume shows that conversation's tabs", async ($, on) => {
  const world = TWO_FILES()
  fakeEngine(on, world)
  const ui = await openPane($)

  world.rows = [write('/r/x.md'), write('/r/y.md')]
  world.files = { '/r/x.md': '# X', '/r/y.md': '# Y' }
  world.conversation = 'c2'
  await $.classic.SessionStart({ source: 'resume' })

  expect(await tabKeys(ui)).toEqual(['tab-/r/y.md', 'tab-/r/x.md'])
  expect(await readerText(ui)).toBe('# Y')
})
