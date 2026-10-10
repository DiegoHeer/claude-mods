import { expect, mock, test } from 'claude-code/testing'
import { GREEN_COST, START, USAGE, fakeEngine, mountHint } from './fake-engine.ts'
import { statusLineSources } from './settings.js'

const CONFIG_CHANGE = {
  hook_event_name: 'ConfigChange',
  session_id: 'abc',
  transcript_path: '/t.jsonl',
  cwd: '/repo',
  source: 'user_settings',
} as never

test('inactive draws the engine hint', async ($, on) => {
  mock.store(on, {})
  mock.clock(on)
  const { runs } = fakeEngine(on)
  await $.session.start(START)
  const ui = await mountHint($)
  expect(runs).toHaveLength(0)
  expect(await ui.find({ type: 'Text', text: /\? for shortcuts/ })).toBeDefined()
})

test('active draws the cship colors', async ($, on) => {
  mock.store(on, { active: true })
  const clock = mock.clock(on)
  const { runs } = fakeEngine(on)
  await $.session.start(START)
  const ui = await mountHint($)
  await clock.settle()
  const costs = await ui.findAll({ type: 'Text', text: '$0.42' })
  expect(costs.map((t) => t.props.color)).toContain('#9ece6a')
  expect(runs[0].argv.at(-1)).toMatch(/\/scripts\/statusline\.sh$/)
  expect(JSON.parse(runs[0].stdin ?? '{}').session_id).toBe('abc')
})

test('keeps the engine hint under the line', async ($, on) => {
  mock.store(on, { active: true })
  const clock = mock.clock(on)
  fakeEngine(on)
  await $.session.start(START)
  const ui = await mountHint($)
  await clock.settle()
  const texts = (await ui.findAll({ type: 'Text' })).map((t) => t.text)
  const lineAt = texts.findIndex((text) => text.includes('$0.42'))
  const hintAt = texts.findIndex((text) => text.includes('? for shortcuts'))
  expect(lineAt).toBeGreaterThan(-1)
  expect(hintAt).toBeGreaterThan(lineAt)
})

test('refreshes on measure and every 30s', async ($, on) => {
  mock.store(on, { active: true })
  const clock = mock.clock(on)
  const { runs } = fakeEngine(on)
  await $.session.start(START)
  await mountHint($)
  await clock.settle()
  const before = runs.length
  await $.session.measure({ ...USAGE, changed: ['cost'] })
  await clock.settle()
  expect(runs).toHaveLength(before + 1)
  await clock.advance(30000)
  expect(runs).toHaveLength(before + 2)
})

test('keeps the last line when cship fails', async ($, on) => {
  mock.store(on, { active: true })
  const clock = mock.clock(on)
  const { state, toasts } = fakeEngine(on)
  await $.session.start(START)
  const ui = await mountHint($)
  await clock.settle()
  state.answer = async () => ({ exitCode: 1, stdout: '' })
  await $.session.measure({ ...USAGE, changed: ['cost'] })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: '$0.42' })).toBeDefined()
  expect(toasts).toHaveLength(0)
})

test('keeps the last line when cship prints nothing', async ($, on) => {
  mock.store(on, { active: true })
  const clock = mock.clock(on)
  const { state } = fakeEngine(on)
  await $.session.start(START)
  const ui = await mountHint($)
  await clock.settle()
  state.answer = async () => ({ exitCode: 0, stdout: '\n' })
  await $.session.measure({ ...USAGE, changed: ['cost'] })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: '$0.42' })).toBeDefined()
})

test('a run that ends after the line was hidden does not draw it', async ($, on) => {
  mock.store(on, { active: true })
  const clock = mock.clock(on)
  const { state } = fakeEngine(on)
  await $.session.start(START)
  const ui = await mountHint($)
  await clock.settle()
  let release = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
  state.answer = async () => {
    await held
    return { exitCode: 0, stdout: GREEN_COST }
  }
  $.session.measure({ ...USAGE, changed: ['cost'] })
  await clock.settle()
  state.settings = { merged: { statusLine: { type: 'command' } } }
  await $.classic.ConfigChange(CONFIG_CHANGE)
  await clock.settle()
  release()
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: /\? for shortcuts/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '$0.42' })).toBeUndefined()
})

test('the first prompt does not wait for cship', async ($, on) => {
  mock.store(on, { active: true })
  const clock = mock.clock(on)
  const { runs, state } = fakeEngine(on)
  state.answer = () => new Promise(() => {})
  await $.session.start(START)
  await mountHint($)
  await clock.settle()
  expect(runs).toHaveLength(1)
})

test('the first run waits for the real width', async ($, on) => {
  mock.store(on, { active: true })
  const clock = mock.clock(on)
  const { runs } = fakeEngine(on)
  await $.session.start(START)
  await clock.settle()
  expect(runs).toHaveLength(0)
  await mountHint($, 200)
  await clock.settle()
  expect(runs.map((run) => run.columns)).toEqual(['200'])
})

test('a failing settings read is logged, not thrown', async ($, on) => {
  mock.store(on, { active: true })
  const clock = mock.clock(on)
  const { logs, state } = fakeEngine(on)
  state.readError = 'settings unreadable'
  await $.session.start(START)
  await clock.settle()
  // A throwing hook counts as absent, so the engine reports the read as unanswered.
  expect(logs.some((line) => line.includes('settings.read'))).toBe(true)
})

test('the transcript path reaches the script', async ($, on) => {
  mock.store(on, { active: true })
  const clock = mock.clock(on)
  const { runs } = fakeEngine(on)
  await $.classic.SessionStart({ hook_event_name: 'SessionStart', session_id: 'abc', transcript_path: '/t.jsonl', cwd: '/repo', source: 'startup' } as never)
  await $.session.start(START)
  await mountHint($)
  await clock.settle()
  expect(JSON.parse(runs[0].stdin ?? '{}').transcript_path).toBe('/t.jsonl')
})

test('no runs in a session nobody sees', async ($, on) => {
  mock.store(on, { active: true })
  const clock = mock.clock(on)
  const { runs } = fakeEngine(on)
  await $.session.start({ ...START, isInteractive: false })
  await $.session.measure({ ...USAGE, changed: ['cost'] })
  await clock.advance(30000)
  expect(runs).toHaveLength(0)
})

test('one run in flight at a time', async ($, on) => {
  mock.store(on, { active: true })
  const clock = mock.clock(on)
  const { runs, state } = fakeEngine(on)
  await $.session.start(START)
  await mountHint($)
  await clock.settle()
  const before = runs.length
  let release = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
  state.answer = async () => {
    await held
    return { exitCode: 0, stdout: GREEN_COST }
  }
  const first = $.session.measure({ ...USAGE, changed: ['cost'] })
  await clock.settle()
  await $.session.measure({ ...USAGE, changed: ['cost'] })
  await $.session.measure({ ...USAGE, changed: ['cost'] })
  expect(runs).toHaveLength(before + 1)
  release()
  await first
  await clock.settle()
  expect(runs).toHaveLength(before + 2)
})

test('re-runs once on resize', async ($, on) => {
  mock.store(on, { active: true })
  const clock = mock.clock(on)
  const { runs } = fakeEngine(on)
  await $.session.start(START)
  // The prompt has one hint row: each mount replaces the last, as a resize redraws it.
  await (await mountHint($, 120)).unmount()
  await clock.settle()
  const atWide = runs.length
  await (await mountHint($, 120)).unmount()
  await clock.settle()
  expect(runs).toHaveLength(atWide)
  await mountHint($, 60)
  await clock.settle()
  expect(runs).toHaveLength(atWide + 1)
  expect(runs.at(-1)?.columns).toBe('60')
})

test('hides while another statusline is set', async ($, on) => {
  mock.store(on, { active: true })
  const clock = mock.clock(on)
  const { runs, toasts, state } = fakeEngine(on, { settings: { merged: { statusLine: { type: 'command' } } } })
  await $.session.start(START)
  const ui = await mountHint($)
  await clock.settle()
  expect(runs).toHaveLength(0)
  expect(await ui.find({ type: 'Text', text: /\? for shortcuts/ })).toBeDefined()
  expect(toasts).toHaveLength(0)
  state.settings = {}
  await $.classic.ConfigChange(CONFIG_CHANGE)
  await clock.settle()
  expect(runs).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: '$0.42' })).toBeDefined()
})

test('statusLineSources names each file that sets one', async () => {
  const sources = { user: { statusLine: {} }, local: { statusLine: {} }, project: { model: 'x' } }
  const readSource = async (source: string) => sources[source] ?? {}
  expect(await statusLineSources(readSource, '/repo')).toEqual(['~/.claude/settings.json', '/repo/.claude/settings.local.json'])
})
