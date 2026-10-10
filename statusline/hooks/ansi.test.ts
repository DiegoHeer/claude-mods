import { expect, test } from 'claude-code/testing'
import { parseAnsi } from './ansi.js'

const ESC = '\x1b'

test('truecolor bold', async () => {
  expect(parseAnsi(`${ESC}[1;38;2;122;162;247mOpus${ESC}[0m │ x`)).toEqual([
    [{ text: 'Opus', color: '#7aa2f7', bold: true }, { text: ' │ x' }],
  ])
})

test('256 color', async () => {
  expect(parseAnsi(`${ESC}[38;5;196mred`)).toEqual([[{ text: 'red', color: '#ff0000' }]])
})

test('basic color and reset by 39', async () => {
  expect(parseAnsi(`${ESC}[31ma${ESC}[39mb`)).toEqual([[{ text: 'a', color: 'red' }, { text: 'b' }]])
})

test('bright color, background, dim, italic, underline', async () => {
  expect(parseAnsi(`${ESC}[91;44;2;3;4mx${ESC}[22;23;24;49my`)).toEqual([
    [
      { text: 'x', color: '#ff0000', backgroundColor: 'blue', dimColor: true, italic: true, underline: true },
      { text: 'y', color: '#ff0000' },
    ],
  ])
})

test('drops OSC and other CSI', async () => {
  expect(parseAnsi(`${ESC}]8;;http://x\x07link${ESC}]8;;${ESC}\\${ESC}[2K!`)).toEqual([[{ text: 'link!' }]])
})

test('merges adjacent text of the same style', async () => {
  expect(parseAnsi(`${ESC}[1;31ma${ESC}[31;1mb`)).toEqual([[{ text: 'ab', color: 'red', bold: true }]])
})

test('two lines', async () => {
  expect(parseAnsi('a\nb\n')).toEqual([[{ text: 'a' }], [{ text: 'b' }]])
})

test('real cship line keeps every character', async () => {
  const line =
    `${ESC}[1;38;2;122;162;247mOpus 5.5${ESC}[0m │ ${ESC}[38;2;158;206;106m$0.42${ESC}[0m │ ctx ` +
    `${ESC}[38;2;187;154;247m░░░░░░░░░░ 8%${ESC}[0m │ \n`
  const [spans] = parseAnsi(line)
  expect(spans.map((s) => s.text).join('')).toBe('Opus 5.5 │ $0.42 │ ctx ░░░░░░░░░░ 8% │ ')
  expect(spans[2]).toEqual({ text: '$0.42', color: '#9ece6a' })
})
