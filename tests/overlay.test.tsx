import { expect, test } from 'claude-code/testing'
import type { ClientPointerEvent, ClientSurface, JsonValue } from 'claude-code'

import Overlay from '../hooks/render/overlay'

const driven = () => {
  const posted: JsonValue[] = []
  let listener: (event: ClientPointerEvent) => void = () => {}
  const surface = {
    elements: { Box: (props: object) => ({ type: 'Box', props }) },
    columns: 40,
    rows: 12,
    onPointer: (fn: (event: ClientPointerEvent) => void) => {
      listener = fn

      return () => {}
    },
    state: undefined as string | undefined,
    setState(next: string) {
      this.state = next
    },
    post: (data: JsonValue) => posted.push(data),
  } as unknown as ClientSurface

  return { posted, surface, pointer: (event: ClientPointerEvent) => listener(event) }
}

test('the overlay covers the whole region and posts where the left button went down', () => {
  const { posted, surface, pointer } = driven()

  expect(Overlay({}, surface)).toMatchObject({ type: 'Box', props: { width: 40, height: 12 } })

  pointer({ type: 'down', x: 3, y: 1, button: 'left', fine: { x: 3.375, y: 1.25 } })
  pointer({ type: 'down', x: 5, y: 2, button: 'left' })
  pointer({ type: 'down', x: 6, y: 2, button: 'right' })
  pointer({ type: 'up', x: 3, y: 1, button: 'left' })

  expect(posted.filter(one => !('region' in (one as object)))).toEqual([
    { x: 3.375, y: 1.25 },
    { x: 5.5, y: 2.5, isCell: true },
  ])
})

test('hover posts once per cell entered, ignores drags, and posts a leave', () => {
  const { posted, surface, pointer } = driven()
  Overlay({}, surface)

  pointer({ type: 'move', x: 7, y: 2, fine: { x: 7.25, y: 2.5 } })
  pointer({ type: 'move', x: 7, y: 2, fine: { x: 7.75, y: 2.1 } })
  pointer({ type: 'move', x: 8, y: 2 })
  pointer({ type: 'move', x: 9, y: 2, button: 'left' })
  pointer({ type: 'leave', x: 8, y: 2 })
  pointer({ type: 'move', x: 8, y: 2 })

  expect(posted.filter(one => !('region' in (one as object)))).toEqual([
    { hover: true, t: expect.any(Number), x: 7.25, y: 2.5 },
    { hover: true, t: expect.any(Number), x: 8.5, y: 2.5, isCell: true },
    { leave: true },
    { hover: true, t: expect.any(Number), x: 8.5, y: 2.5, isCell: true },
  ])
})

test('the overlay tells the plugin the region the terminal gave it, once per size, next to what was expected', () => {
  const { posted, surface } = driven()
  const props = { expect: { columns: 40, rows: 12 } }

  Overlay(props, surface)
  Overlay(props, surface)

  expect(posted).toEqual([{ region: { columns: 40, rows: 12, expect: { columns: 40, rows: 12 } } }])

  ;(surface as unknown as { columns: number }).columns = 37
  Overlay(props, surface)

  expect(posted.at(-1)).toEqual({ region: { columns: 37, rows: 12, expect: { columns: 40, rows: 12 } } })
  expect(posted).toHaveLength(2)
})
