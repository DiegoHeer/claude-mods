import { expect, test } from 'claude-code/testing'
import { collectDocPaths, docPathsFromRows, keepKnown, stepPath, tabLabels } from './docs.js'

let nextId = 0
const use = (tool: string, input: Record<string, unknown>, extra = {}) => ({ tool_use_id: `t${++nextId}`, tool, input, text: 'ok', ...extra })
const turn = (...toolUses) => ({ role: 'assistant' as const, text: '', toolUses })
const write = (path: string, extra = {}) => turn(use('Write', { file_path: path, content: '#' }, extra))
const edit = (path: string) => turn(use('Edit', { file_path: path, old_string: 'a', new_string: 'b' }))
const agent = (agentId: string) => turn(use('Agent', { prompt: 'go' }, { agentId }))
const noAgents = () => []

test('orders newest first and keeps one tab per file', async () => {
  const rows = [write('/r/a.md'), write('/r/b.md'), edit('/r/a.md')]
  expect(docPathsFromRows(rows, noAgents)).toEqual(['/r/a.md', '/r/b.md'])
})

test('skips non-markdown files and failed calls', async () => {
  const rows = [write('/r/x.ts'), write('/r/c.md', { isError: true }), write('/r/D.MD')]
  expect(docPathsFromRows(rows, noAgents)).toEqual(['/r/D.MD'])
})

test('skips calls still in flight', async () => {
  const rows = [write('/r/a.md'), write('/r/waiting.md', { text: undefined })]
  expect(docPathsFromRows(rows, noAgents)).toEqual(['/r/a.md'])
})

test('keeps files known before, behind the ones still in history', async () => {
  expect(keepKnown(['/r/b.md', '/r/a.md'], ['/r/old.md', '/r/a.md'])).toEqual(['/r/b.md', '/r/a.md', '/r/old.md'])
})

test('merges subagent writes at the point the agent ran', async () => {
  const rows = [write('/r/a.md'), agent('s1'), write('/r/b.md')]
  const agentRows = (id: string) => (id === 's1' ? [write('/r/spec.md')] : [])
  expect(docPathsFromRows(rows, agentRows)).toEqual(['/r/b.md', '/r/spec.md', '/r/a.md'])
})

test('skips a subagent whose history is refused', async () => {
  const readRows = async (agentId?: string) => (agentId ? { deny: 'no' } : [write('/r/a.md'), agent('s1')])
  expect(await collectDocPaths(readRows)).toEqual(['/r/a.md'])
})

test('reads each subagent history it finds', async () => {
  const readRows = async (agentId?: string) => (agentId === 's1' ? [write('/r/spec.md')] : [agent('s1')])
  expect(await collectDocPaths(readRows)).toEqual(['/r/spec.md'])
})

test('labels by basename, with the folder when names clash', async () => {
  const labels = tabLabels(['/r/specs/plan.md', '/r/plans/plan.md', '/r/notes.md'])
  expect([...labels.values()]).toEqual(['specs/plan.md', 'plans/plan.md', 'notes.md'])
})

test('steps with wrap', async () => {
  expect(stepPath(['a', 'b', 'c'], 'c', 1)).toBe('a')
  expect(stepPath(['a', 'b', 'c'], 'a', -1)).toBe('c')
  expect(stepPath([], null, 1)).toBe(null)
  expect(stepPath(['a'], 'gone', 1)).toBe('a')
})
