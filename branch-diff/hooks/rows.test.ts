import { expect, test } from 'claude-code/testing'
import { anchorOf, fileRows, planSections, reviewMessage, rowRange } from './rows.js'

const PATH = 'src/a.ts'
const FILE = { path: PATH, hunks: [{ oldStart: 10, newStart: 10, lines: [' a', '-b', '+B', '+c', ' d'] }] }
const rows = fileRows(FILE)

test('numbers each row with its old and new line', async () => {
  expect(rows).toEqual([
    { kind: 'ctx', line: ' a', oldNo: 10, newNo: 10 },
    { kind: 'del', line: '-b', oldNo: 11 },
    { kind: 'add', line: '+B', newNo: 11 },
    { kind: 'add', line: '+c', newNo: 12 },
    { kind: 'ctx', line: ' d', oldNo: 12, newNo: 13 },
  ])
})

test('labels a range in new-file lines, in either order', async () => {
  expect(anchorOf(PATH, rows, 2, 3).label).toBe('L11-12')
  expect(anchorOf(PATH, rows, 3, 2)).toEqual(anchorOf(PATH, rows, 2, 3))
  expect(anchorOf(PATH, rows, 0, 0).label).toBe('L10')
})

test('labels removed lines alone in old-file lines', async () => {
  expect(anchorOf(PATH, rows, 1, 1)).toMatchObject({ side: 'old', first: 11, last: 11, label: 'old L11' })
})

test('keeps the selected diff lines as the snippet', async () => {
  expect(anchorOf(PATH, rows, 1, 2).snippet).toBe('-b\n+B')
})

test('finds an anchor again in the rows, or nothing when its lines are gone', async () => {
  const anchor = anchorOf(PATH, rows, 2, 4)
  expect(rowRange(rows, anchor)).toEqual({ from: 2, to: 4 })
  expect(rowRange(rows, { ...anchor, first: 99 })).toBe(null)
})

test('writes all drafts as one review message', async () => {
  const drafts = [
    { ...anchorOf(PATH, rows, 2, 3), id: 1, text: 'rename these' },
    { ...anchorOf('src/b.ts', rows, 1, 1), id: 2, text: 'why remove this?' },
  ]
  expect(reviewMessage('origin/main', drafts)).toBe(
    [
      'Review comments on this branch (vs origin/main). Please address each one.',
      '',
      '1. src/a.ts L11-12',
      '```diff',
      '+B',
      '+c',
      '```',
      'rename these',
      '',
      '2. src/b.ts old L11',
      '```diff',
      '-b',
      '```',
      'why remove this?',
    ].join('\n'),
  )
})

const TWO_HUNKS = {
  path: PATH,
  hunks: [FILE.hunks[0], { oldStart: 40, newStart: 41, lines: [' x', '+y'] }],
}
const blocksOf = (cuts: number[]) =>
  planSections([TWO_HUNKS], new Map([[PATH, new Set(cuts)]])).sections[0].blocks
const shapes = (blocks) => blocks.map(({ start, count }) => ({ start, count }))

test('gives each block its first row and row count', async () => {
  const blocks = blocksOf([])
  expect(shapes(blocks)).toEqual([
    { start: 0, count: 5 },
    { start: 5, count: 2 },
  ])
  expect(blocks[1].source.startsWith('@@ -40,1 +41,2 @@\n')).toBe(true)
})

test('ends a block after a cut row, with a rebuilt header for the rest', async () => {
  const blocks = blocksOf([2])
  expect(shapes(blocks)).toEqual([
    { start: 0, count: 3 },
    { start: 3, count: 2 },
    { start: 5, count: 2 },
  ])
  expect(blocks[1].source.startsWith('@@ -12,1 +12,2 @@\n')).toBe(true)
})

test('adds no empty block for a cut at the end of a hunk', async () => {
  expect(blocksOf([4, 6])).toHaveLength(2)
})
