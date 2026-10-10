// Draws the pane: a row of tabs, the key hint, then the selected file as markdown.

const READER_LIMIT = 90_000 // the pane draws 100 000 characters in all; tabs and path take the rest
const CUT_NOTE = '\n\n_File cut at 90 000 characters._'

const MESSAGES = {
  deleted: 'This file was deleted.',
  unreadable: 'This file could not be read.',
}

function readerText(content) {
  if (content.kind !== 'text') return MESSAGES[content.kind]
  if (content.text.length <= READER_LIMIT) return content.text
  return content.text.slice(0, READER_LIMIT - CUT_NOTE.length) + CUT_NOTE
}

export function drawPane({ Box, Text, Button, Markdown }, { paths, labels, selected, content, onSelect, onStep }) {
  const dim = (text) => Text({ dimColor: true, children: [text] })
  if (paths.length === 0) return dim('No markdown files written in this conversation yet.')

  const tab = (path) =>
    Button({
      key: 'tab-' + path,
      label: labels.get(path),
      ...(path === selected ? { variant: 'primary' } : { dimColor: true }),
      onPress: () => onSelect(path),
    })
  return Box({
    flexDirection: 'column',
    rowGap: 1,
    children: [
      Box({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 2, children: paths.map(tab) }),
      Box({
        flexDirection: 'row',
        columnGap: 2,
        children: [
          Button({ key: 'next', label: 'next', hotkey: 'n', plain: true, onPress: () => onStep(1) }),
          Button({ key: 'previous', label: 'previous', hotkey: 'p', plain: true, onPress: () => onStep(-1) }),
        ],
      }),
      dim(selected),
      Markdown({ key: 'reader', text: readerText(content) }),
    ],
  })
}
