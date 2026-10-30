// Draws the pane: a row of tabs, the key hint, then the selected file as markdown.

const PANE_TEXT_LIMIT = 100_000 // the most text a pane draws, tabs and path included
const HINT_ROOM = 200 // the key hint, with room to spare
const CUT_NOTE = '\n\n_File cut: too long to show in full._'

const MESSAGES = {
  deleted: 'This file was deleted.',
  unreadable: 'This file could not be read.',
}

function readerText(content, room) {
  if (content.kind !== 'text') return MESSAGES[content.kind]
  if (content.text.length <= room) return content.text
  return content.text.slice(0, Math.max(0, room - CUT_NOTE.length)) + CUT_NOTE
}

const readerRoom = (labels, selected) => PANE_TEXT_LIMIT - HINT_ROOM - selected.length - [...labels.values()].join('').length

export function drawPane({ Box, Text, Button, Markdown }, { paths, labels, selected, content, onSelect, onStep, onOpen }) {
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
          content.kind !== 'deleted' &&
            Button({ key: 'open', label: 'open in VS Code', hotkey: 'o', plain: true, onPress: onOpen }),
        ].filter(Boolean),
      }),
      dim(selected),
      Markdown({ key: 'reader', text: readerText(content, readerRoom(labels, selected)) }),
    ],
  })
}
