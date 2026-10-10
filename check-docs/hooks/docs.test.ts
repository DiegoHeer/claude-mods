import { expect, test } from 'claude-code/testing'
import { collectDocPaths, keepKnown, knownPaths, rememberPaths, stepPath, tabLabels } from './docs.js'

let nextId = 0
const use = (tool: string, input: Record<string, unknown>, extra = {}) => ({ tool_use_id: `t${++nextId}`, tool, input, text: 'ok', ...extra })
const turn = (...toolUses) => ({ role: 'assistant' as const, text: '', toolUses })
const write = (path: string, extra = {}) => turn(use('Write', { file_path: path, content: '#' }, extra))
const edit = (path: string) => turn(use('Edit', { file_path: path, old_string: 'a', new_string: 'b' }))
const agent = (agentId: string) => turn(use('Agent', { prompt: 'go' }, { agentId }))

// The main history, and each agent's by id; an unknown agent has none.
const history = (main: unknown[], agents: Record<string, unknown> = {}) => async (agentId?: string) => (agentId ? (agents[agentId] ?? []) : main)

test('orders newest first and keeps one tab per file', async () => {
  const rows = [write('/r/a.md'), write('/r/b.md'), edit('/r/a.md')]
  expect(await collectDocPaths(history(rows))).toEqual(['/r/a.md', '/r/b.md'])
})

test('skips non-markdown files and failed calls', async () => {
  const rows = [write('/r/x.ts'), write('/r/c.md', { isError: true }), write('/r/D.MD')]
  expect(await collectDocPaths(history(rows))).toEqual(['/r/D.MD'])
})

test('skips calls still in flight', async () => {
  const rows = [write('/r/a.md'), write('/r/waiting.md', { text: undefined })]
  expect(await collectDocPaths(history(rows))).toEqual(['/r/a.md'])
})

test('merges subagent writes at the point the agent ran', async () => {
  const rows = [write('/r/a.md'), agent('s1'), write('/r/b.md')]
  expect(await collectDocPaths(history(rows, { s1: [write('/r/spec.md')] }))).toEqual(['/r/b.md', '/r/spec.md', '/r/a.md'])
})

test('reads nested subagents', async () => {
  const agents = { s1: [agent('s2')], s2: [write('/r/deep.md')] }
  expect(await collectDocPaths(history([agent('s1')], agents))).toEqual(['/r/deep.md'])
})

test('survives a subagent whose history holds its own spawn', async () => {
  const agents = { s1: [agent('s1'), write('/r/fork.md')] }
  expect(await collectDocPaths(history([agent('s1')], agents))).toEqual(['/r/fork.md'])
})

test('skips a subagent whose history is refused', async () => {
  const rows = [write('/r/a.md'), agent('s1')]
  expect(await collectDocPaths(history(rows, { s1: { deny: 'no' } }))).toEqual(['/r/a.md'])
})

test('keeps files known before, behind the ones still in history', async () => {
  expect(keepKnown(['/r/b.md', '/r/a.md'], ['/r/old.md', '/r/a.md'])).toEqual(['/r/b.md', '/r/a.md', '/r/old.md'])
})

test('remembers the latest 20 conversations', async () => {
  let recent = []
  for (let i = 0; i < 25; i++) recent = rememberPaths(recent, `c${i}`, [`/r/${i}.md`])
  expect(recent).toHaveLength(20)
  expect(knownPaths(recent, 'c24')).toEqual(['/r/24.md'])
  expect(knownPaths(recent, 'c4')).toEqual([])
  recent = rememberPaths(recent, 'c10', ['/r/new.md'])
  expect(recent[0]).toEqual({ conversation: 'c10', paths: ['/r/new.md'] })
  expect(recent).toHaveLength(20)
})

test('reads no known paths from a missing or broken store value', async () => {
  expect(knownPaths(undefined, 'c1')).toEqual([])
  expect(knownPaths({ c1: ['/r/a.md'] }, 'c1')).toEqual([])
})

test('labels by basename, with the folder when names clash', async () => {
  const labels = tabLabels(['/r/specs/plan.md', '/r/plans/plan.md', '/r/notes.md'])
  expect([...labels.values()]).toEqual(['specs/plan.md', 'plans/plan.md', 'notes.md'])
})

test('labels Windows paths too', async () => {
  const labels = tabLabels(['C:\\r\\specs\\plan.md', 'C:\\r\\plans\\plan.md', 'C:\\r\\notes.md'])
  expect([...labels.values()]).toEqual(['specs/plan.md', 'plans/plan.md', 'notes.md'])
})

test('steps with wrap', async () => {
  expect(stepPath(['a', 'b', 'c'], 'c', 1)).toBe('a')
  expect(stepPath(['a', 'b', 'c'], 'a', -1)).toBe('c')
  expect(stepPath([], null, 1)).toBe(null)
  expect(stepPath(['a'], 'gone', 1)).toBe('a')
})
