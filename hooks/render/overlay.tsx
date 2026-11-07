import type { ClientModule } from 'claude-code'

const Overlay: ClientModule<{ expect?: { columns: number; rows: number } }, string> = (props, surface) => {
  const { Box } = surface.elements
  let lastCell = ''
  const region = `${surface.columns}x${surface.rows}`

  if (surface.columns > 0 && surface.state !== region) {
    surface.setState(region)
    surface.post({ region: { columns: surface.columns, rows: surface.rows, expect: props?.expect ?? null } })
  }

  surface.onPointer(({ type, button, x, y, fine }) => {
    if (type === 'leave') {
      lastCell = ''
      surface.post({ leave: true })

      return
    }

    if (type === 'move' && !button) {
      const cell = `${Math.floor(x)},${Math.floor(y)}`
      if (cell === lastCell) return

      lastCell = cell
      surface.post({ hover: true, t: Date.now(), x: fine?.x ?? x + 0.5, y: fine?.y ?? y + 0.5, ...(fine ? {} : { isCell: true }) })

      return
    }

    if (type !== 'down' || button !== 'left') return

    surface.post({ x: fine?.x ?? x + 0.5, y: fine?.y ?? y + 0.5, ...(fine ? {} : { isCell: true }) })
  })

  return <Box width={surface.columns} height={surface.rows} />
}

export default Overlay
