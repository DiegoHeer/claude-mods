// One diff block drawn with the mouse in mind: a one-cell mark strip beside the
// engine's own diff drawing. Cut to one row per line, a pointer's `y` is the line.

export default function DiffBlock(props, surface) {
  const { Box, Text, Code } = surface.elements
  // Held here as well as in state: a down and an up in one frame both reach this
  // listener before setState redraws, so the up must see what the down kept.
  let gesture = surface.state ?? {}
  const remember = (next) => {
    gesture = next
    surface.setState(next)
  }
  const rowAt = (y) => props.start + Math.min(Math.max(y, 0), props.count - 1)
  // Each post carries the whole gesture: a later post in the same frame replaces an earlier one.
  const send = (type) =>
    surface.post({ type, path: props.path, anchorRow: gesture.anchorRow, row: gesture.row, shift: gesture.shift })

  surface.onPointer((e) => {
    if (e.type === 'down' && e.button === 'left' && e.y >= 0 && e.y < props.count) {
      const row = rowAt(e.y)
      remember({ isDown: true, anchorRow: row, row, shift: Boolean(e.shift) })
      send('press')
    } else if (e.type === 'move' && e.button === 'left' && gesture.isDown) {
      const row = rowAt(e.y)
      if (row === gesture.row) return
      remember({ ...gesture, row })
      send('drag')
    } else if (e.type === 'up' && gesture.isDown) {
      send('release')
      remember({ ...gesture, isDown: false })
    }
  })

  return Box({
    flexDirection: 'row',
    children: [
      Box({
        flexDirection: 'column',
        width: 1,
        children: [...props.marks].map((mark) => Text({ color: 'warning', children: [mark] })),
      }),
      Box({ flexGrow: 1, children: [Code({ source: props.source, format: 'diff', path: props.path, wrap: 'truncate-end' })] }),
    ],
  })
}
