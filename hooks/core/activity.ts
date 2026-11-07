import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine } from 'claude-code'

import type { Now, Scope, Touch } from '../../types'

export const touched = atom({ plugin: 'panel', key: 'touched' } as const, [] as Touch[], {
  shape: 'touched-2',
})
export const now = atom({ plugin: 'panel', key: 'now' } as const, { kind: 'idle' } as Now, {
  shape: 'now-1',
})
export const scope = atom({ plugin: 'panel', key: 'scope' } as const, 'turn' as Scope, {
  shape: 'scope-1',
})
export const turn = atom({ plugin: 'panel', key: 'turn' } as const, 0, { shape: 'turn-1' })

const EDITING = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const READING = new Set(['Read'])
const KEPT = 200
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/
const DETAIL_MAX = 120

export function normalize(path: string, cwd: string): string {
  if (WINDOWS_ABSOLUTE.test(path)) return path
  const full = path.startsWith('/') ? path : `${cwd}/${path}`
  const parts: string[] = []
  for (const part of full.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }

  return `/${parts.join('/')}`
}

export function visibleTouched(list: Touch[], scope: Scope, current: number): Touch[] {
  return scope === 'session' ? list : list.filter(t => t.turn === current)
}

function pathOf(e: Record<string, unknown>): string | undefined {
  const path = e.file_path ?? e.notebook_path

  return typeof path === 'string' && path !== '' ? path : undefined
}

function runningOf(tool: string, e: Record<string, unknown>): Now {
  if (tool === 'Bash') {
    const command = typeof e.command === 'string' ? e.command : ''

    return {
      kind: 'running',
      title: 'Rodando um comando',
      detail: command.trim().split('\n')[0].slice(0, DETAIL_MAX),
    }
  }

  return { kind: 'running', title: `Usando ${tool}`, detail: '' }
}

export async function trackToolCall(
  $: Engine,
  e: Record<string, unknown> & { tool: string },
): Promise<void> {
  const isEdit = EDITING.has(e.tool)
  const path = isEdit || READING.has(e.tool) ? pathOf(e) : undefined

  if (path === undefined) {
    await update($, now, () => runningOf(e.tool, e))

    return
  }

  const abs = normalize(path, await $.session.cwd())
  const current = await read($, turn)
  const at = Date.now()

  await update($, touched, list => {
    const before = list.find(t => t.abs === abs)
    const sameTurn = before?.turn === current
    const next: Touch = {
      abs,
      isEdited: isEdit || before?.isEdited === true,
      isEditedThisTurn: isEdit || (sameTurn && before?.isEditedThisTurn === true),
      at,
      turn: current,
    }

    return [...list.filter(t => t.abs !== abs), next].slice(-KEPT)
  })
  await update($, now, () => ({ kind: isEdit ? 'editing' : 'reading', abs }))
}

export async function startTurn($: Engine): Promise<void> {
  await update($, turn, n => n + 1)
  await update($, now, () => ({ kind: 'thinking' }))
}

export async function finishTurn($: Engine): Promise<void> {
  const current = await read($, turn)
  const mine = (await read($, touched)).filter(t => t.turn === current)

  await update($, now, () => ({
    kind: 'done',
    edited: mine.filter(t => t.isEditedThisTurn).map(t => t.abs),
    read: mine.filter(t => !t.isEditedThisTurn).map(t => t.abs),
  }))
}
