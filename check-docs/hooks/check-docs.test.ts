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

type World = {
  rows: unknown[]
  files: Record<string, string | Error>
  conversation?: string
  isHidden?: boolean // the pane is open but not shown
  isStoreFull?: boolean // every store write is refused
  onMessages?: () => void // runs as the history is read, to change the world mid-refresh
}

// Fake engine: the conversation (its id and rows), the files on disk, the store and
// the open panes, all read on every call so a test can change them between steps.
function fakeEngine(on, world: World) {
  const panes = new Set<string>()
  const closed: string[] = []
  const opened: string[] = []
  const reads: string[] = []
  const store: Record<string, unknown> = {}
  let historyReads = 0
  on('command.register', async () => ({ value: undefined }))
  on('classic.SessionStart', async () => ({}))
  on('session.id', async () => ({ value: world.conversation ?? 'c1' }))
  on('session.messages', async () => {
    historyReads++
    world.onMessages?.()
    return { value: world.rows }
  })
  on('store.get', async ($, e) => ({ value: store[e.key] }))
  on('store.set', async ($, e) => (world.isStoreFull ? { deny: 'store full' } : ((store[e.key] = e.value), { value: undefined })))
  on('fs.exists', async ($, e) => ({ value: e.path in world.files }))
  on('fs.read', async ($, e) => {
    reads.push(e.path)
    const file = world.files[e.path]
    return typeof file === 'string' ? { value: file } : { deny: 'unreadable' }
  })
  on('ui.open', async ($, e) => (panes.add(e.id), opened.push(e.id), { value: { isPlaced: true } }))
  on('ui.close', async ($, e, next) => {
    if (e.origin.kind !== 'plugin') return next(e)
    panes.delete(e.id)
    closed.push(e.id)
    return { value: undefined }
  })
  on('ui.panes', async () => ({
    value: [...panes].map((id) => ({ id, title: 'Check docs', isShown: !world.isHidden, isFocused: !world.isHidden, isPlaced: true })),
  }))
  return { closed, opened, reads, historyReads: () => historyReads }
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
  expect(text.startsWith('x'.repeat(90_000))).toBe(true)
  expect(text.endsWith('_File cut: too long to show in full._')).toBe(true)
  expect(text.length).toBeLessThanOrEqual(100_000)
})

test('many tabs leave the reader room within the pane limit', async ($, on) => {
  const names = Array.from({ length: 300 }, (_, i) => `/r/${'long-name-'.repeat(10)}${i}.md`)
  const files = Object.fromEntries(names.map((name) => [name, 'x'.repeat(150_000)]))
  fakeEngine(on, { rows: names.map(write), files })
  const ui = await openPane($)
  const text = await readerText(ui)
  const tabsLength = names.reduce((sum, name) => sum + name.length - 3, 0)
  expect(text.endsWith('_File cut: too long to show in full._')).toBe(true)
  expect(tabsLength + text.length).toBeLessThan(100_000)
})

test('/check-docs shows a hidden pane instead of closing it', async ($, on) => {
  const world: World = TWO_FILES()
  const { closed, opened } = fakeEngine(on, world)
  await openPane($)
  world.isHidden = true
  await $.command.run({ command: 'check-docs', args: '' })
  expect(closed).toEqual([])
  expect(opened).toEqual([PANE, PANE])
})

test('switching tabs reads each file once', async ($, on) => {
  const { reads } = fakeEngine(on, TWO_FILES())
  const ui = await openPane($)
  await ui.press({ key: 'next' })
  await ui.press({ key: 'previous' })
  await ui.press({ key: 'next' })
  expect(reads.filter((path) => path === '/r/a.md')).toHaveLength(1)
  expect(reads.filter((path) => path === '/r/b.md')).toHaveLength(1)
})

test('opens even when the store is full', async ($, on) => {
  fakeEngine(on, { ...TWO_FILES(), isStoreFull: true })
  const ui = await openPane($)
  expect(await tabKeys(ui)).toEqual(['tab-/r/b.md', 'tab-/r/a.md'])
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

test('a shell command redraws without rereading the history', async ($, on) => {
  const world = TWO_FILES()
  const { historyReads } = fakeEngine(on, world)
  toolsSucceed(on)
  const clock = mock.clock(on)
  const ui = await openPane($)
  const readsBefore = historyReads()

  world.files['/r/b.md'] = '# B doc, by sed'
  await $.tool.call({ tool: 'Bash', command: 'sed -i s/x/y/ /r/b.md' })
  await clock.advance(300)

  expect(await readerText(ui)).toBe('# B doc, by sed')
  expect(await tabKeys(ui)).toEqual(['tab-/r/b.md', 'tab-/r/a.md'])
  expect(historyReads()).toBe(readsBefore)
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

test('resume selects the newest tab even when the old pick is there too', async ($, on) => {
  const world = TWO_FILES()
  fakeEngine(on, world)
  const ui = await openPane($)
  await ui.press({ key: 'tab-/r/a.md' })

  world.rows = [write('/r/a.md'), write('/r/y.md')]
  world.files['/r/y.md'] = '# Y'
  world.conversation = 'c2'
  await $.classic.SessionStart({ source: 'resume' })

  expect(await readerText(ui)).toBe('# Y')
})

test('a switch mid-refresh does not save its files under the old conversation', async ($, on) => {
  const world: World = TWO_FILES()
  fakeEngine(on, world)
  const ui = await openPane($)

  world.onMessages = () => {
    world.conversation = 'c2'
    world.rows = [write('/r/x.md')]
    world.onMessages = undefined
  }
  await $.classic.SessionStart({ source: 'compact' })

  world.conversation = 'c1'
  world.rows = []
  await $.classic.SessionStart({ source: 'compact' })

  expect(await tabKeys(ui)).toEqual(['tab-/r/b.md', 'tab-/r/a.md'])
})
