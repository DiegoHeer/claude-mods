// cship prints ANSI escapes; the prompt's Text draws colors from props instead.

const BASIC = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
const BRIGHT = ['#808080', '#ff0000', '#00ff00', '#ffff00', '#5c5cff', '#ff00ff', '#00ffff', '#ffffff']
const XTERM_LOW = ['#000000', '#cd0000', '#00cd00', '#cdcd00', '#0000ee', '#cd00cd', '#00cdcd', '#e5e5e5', ...BRIGHT]
const CUBE = [0, 95, 135, 175, 215, 255]

const OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g
const ESCAPE = /\x1b\[([0-9;?]*)([@-~])|\x1b./g

const hex = (...rgb) => '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('')

function xterm256(n) {
  if (n < 16) return XTERM_LOW[n]
  if (n < 232) return hex(CUBE[Math.floor((n - 16) / 36)], CUBE[Math.floor((n - 16) / 6) % 6], CUBE[(n - 16) % 6])
  const gray = 8 + 10 * (n - 232)
  return hex(gray, gray, gray)
}

// Reads `38;5;n` or `38;2;r;g;b` from codes[i] on; returns the color and how many codes it took.
function extendedColor(codes, i) {
  if (codes[i + 1] === 5) return [xterm256(codes[i + 2]), 3]
  if (codes[i + 1] === 2) return [hex(codes[i + 2], codes[i + 3], codes[i + 4]), 5]
  return [undefined, 1]
}

function applySgr(style, params) {
  const codes = params === '' ? [0] : params.split(';').map(Number)
  let next = { ...style }
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]
    if (code === 0) next = {}
    else if (code === 1) next.bold = true
    else if (code === 2) next.dimColor = true
    else if (code === 3) next.italic = true
    else if (code === 4) next.underline = true
    else if (code === 22) {
      delete next.bold
      delete next.dimColor
    } else if (code === 23) delete next.italic
    else if (code === 24) delete next.underline
    else if (code === 39) delete next.color
    else if (code === 49) delete next.backgroundColor
    else if (code >= 30 && code <= 37) next.color = BASIC[code - 30]
    else if (code >= 40 && code <= 47) next.backgroundColor = BASIC[code - 40]
    else if (code >= 90 && code <= 97) next.color = BRIGHT[code - 90]
    else if (code >= 100 && code <= 107) next.backgroundColor = BRIGHT[code - 100]
    else if (code === 38 || code === 48) {
      const [color, used] = extendedColor(codes, i)
      if (color) next[code === 38 ? 'color' : 'backgroundColor'] = color
      i += used - 1
    }
  }
  return next
}

const styleKey = ({ text, ...style }) => JSON.stringify(Object.entries(style).sort())
const sameStyle = (a, b) => styleKey(a) === styleKey(b)

function parseLine(line) {
  const spans = []
  let style = {}
  const push = (text) => {
    if (!text) return
    const last = spans.at(-1)
    if (last && sameStyle(last, style)) last.text += text
    else spans.push({ text, ...style })
  }
  let at = 0
  for (const match of line.matchAll(ESCAPE)) {
    push(line.slice(at, match.index))
    if (match[2] === 'm') style = applySgr(style, match[1])
    at = match.index + match[0].length
  }
  push(line.slice(at))
  return spans
}

export function parseAnsi(text) {
  const lines = text.replace(OSC, '').split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines.map(parseLine)
}
