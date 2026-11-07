import { atom, update } from 'claude-code'
import type { EngineInterface as Engine, RenderSurface } from 'claude-code'

import { forgetGit } from './core/cache'
import { findEditors, hasFolderApp, openInEditor, showInFolder } from './core/editors'
import type { Scope } from '../types'
import type { Hit } from './render/renderer'

export const openDiffAbs = atom({ plugin: 'panel', key: 'openDiffAbs' } as const, null as string | null, {
  shape: 'openDiffAbs-1',
})
export const isTreeOpen = atom({ plugin: 'panel', key: 'isTreeOpen' } as const, false, { shape: 'isTreeOpen-1' })
export const expanded = atom({ plugin: 'panel', key: 'expanded' } as const, [] as string[], { shape: 'expanded-1' })
export const showHidden = atom({ plugin: 'panel', key: 'showHidden' } as const, false, { shape: 'showHidden-1' })
export const showSizes = atom({ plugin: 'panel', key: 'showSizes' } as const, false, { shape: 'showSizes-1' })
export const seen = atom({ plugin: 'panel', key: 'seen' } as const, {} as Record<string, number>, { shape: 'seen-1' })
export const scope = atom({ plugin: 'panel', key: 'scope' } as const, 'turn' as Scope, { shape: 'scope-1' })

const baseOf = (abs: string) => abs.split(/[\\/]/).filter(Boolean).pop() ?? abs

export const mentionText = (rel: string) => `@${/[\s"]/.test(rel) ? `"${rel.replace(/"/g, '\\"')}"` : rel} `

const relativeTo = (cwd: string, abs: string) => {
  const prefix = cwd.endsWith('/') ? cwd : `${cwd}/`

  return abs.startsWith(prefix) ? abs.slice(prefix.length) : abs
}

export function redraw($: Engine) {
  $.ui.invalidate('ui.render')
}

const CELL_OVERLAP_MIN = 0.3

export function hitIn(hits: Hit[], left: number, top: number, right: number, bottom: number): string | null {
  const cellArea = (right - left) * (bottom - top)
  let best: Hit | null = null

  for (const hit of hits) {
    const across = Math.min(right, hit.x + hit.w) - Math.max(left, hit.x)
    const down = Math.min(bottom, hit.y + hit.h) - Math.max(top, hit.y)
    if (across <= 0 || down <= 0) continue
    if ((across * down) / Math.min(cellArea, hit.w * hit.h) < CELL_OVERLAP_MIN) continue
    if (!best || hit.w * hit.h < best.w * best.h) best = hit
  }

  return best?.act ?? null
}

export function hitAt(hits: Hit[], x: number, y: number): string | null {
  let best: Hit | null = null

  for (const hit of hits) {
    if (x < hit.x || x >= hit.x + hit.w || y < hit.y || y >= hit.y + hit.h) continue
    if (!best || hit.w * hit.h < best.w * best.h) best = hit
  }

  return best?.act ?? null
}

export async function refresh($: Engine) {
  forgetGit()
  redraw($)
}

export async function act($: Engine, action: string, surface: RenderSurface): Promise<void> {
  const [verb = '', ...rest] = action.split(':')
  const tail = rest.join(':')

  switch (verb) {
    case 'file':
      await update($, openDiffAbs, old => (old === tail ? null : tail))
      await update($, seen, old => ({ ...old, [tail]: Date.now() }))

      return
    case 'open': {
      const cli = rest[0]
      const abs = rest.slice(1).join(':')
      const editor = (await findEditors($)).find(one => one.cli === cli)

      if (editor && !(await openInEditor($, editor, abs))) $.ui.toast(`Não consegui abrir ${baseOf(abs)} no ${editor.name}`)

      return
    }
    case 'copy':
      await $.ui.copy({ text: tail, surface }).catch(() => {})
      $.ui.toast(`Copiado ${tail}`)

      return
    case 'mention':
      await $.prompt.fill({ text: mentionText(relativeTo(await $.session.cwd(), tail)), mode: 'insert' }).catch(() => {})

      return
    case 'folder':
      if ((await hasFolderApp($)) && !(await showInFolder($, tail))) $.ui.toast(`Não consegui abrir ${baseOf(tail)} na pasta`)

      return
    case 'tree':
      await update($, isTreeOpen, open => !open)

      return
    case 'dir':
      await update($, expanded, old => (old.includes(tail) ? old.filter(one => one !== tail) : [...old, tail]))

      return
    case 'scope':
      await update($, scope, old => (old === 'session' ? 'turn' : 'session'))

      return
    case 'refresh':
      await refresh($)

      return
    case 'collapse':
      await update($, expanded, () => [])

      return
    case 'sizes':
      await update($, showSizes, old => !old)

      return
    case 'hidden':
      await update($, showHidden, old => !old)
  }
}

export async function resetPaneState($: Engine) {
  await update($, openDiffAbs, () => null)
  await update($, isTreeOpen, () => false)
  await update($, expanded, () => [])
  await update($, showHidden, () => false)
  await update($, showSizes, () => false)
}
