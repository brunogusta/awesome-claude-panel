import { expect, test } from 'claude-code/testing'

import * as actions from '../hooks/actions'
import * as activity from '../hooks/core/activity'
import * as pane from '../hooks/pane'

const describe = (a: unknown) => JSON.stringify(a)

test('os átomos declarados em mais de um arquivo têm a mesma referência e forma', () => {
  for (const name of ['openDiffAbs', 'isTreeOpen', 'expanded', 'showHidden', 'showSizes', 'scope', 'seen'] as const) {
    expect(describe(actions[name])).toBe(describe(pane[name]))
  }

  for (const name of ['touched', 'now', 'scope', 'turn'] as const) {
    expect(describe(activity[name])).toBe(describe(pane[name]))
  }
})

test('o átomo carrega a etiqueta de forma', () => {
  expect(describe(pane.isTreeOpen)).toContain('isTreeOpen-1')
})
