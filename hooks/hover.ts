import type { EngineInterface as Engine } from 'claude-code'

import { trace, traceVerbose } from './core/trace'
import { hot } from './render/renderer'
import type { Hit } from './render/renderer'

export type View = {
  key: string
  rev: number
  y: number
  height: number
  columns: number
  rows: number
  base: string
  hits: Hit[]
  imageKey: string
}

const FRAMES_MAX = 48
const PREFILL_DELAY_MS = 250
const PREFILL_MAX = 40

let view: View | null = null
let frames = new Map<string, string>()
let wanted: string | null = null
let shownAct: string | null = null
let isBusy = false
let fillRound = 0
let began = 0
let lastPostMs: number | null = null
let isHeld = false

const frameKey = (target: View, act: string) => `${target.key}|${target.y}|${act}`

const isSame = (a: View, b: View) => a.key === b.key && a.rev === b.rev && a.y === b.y && a.height === b.height && a.imageKey === b.imageKey

export function resetHover() {
  view = null
  frames = new Map()
  wanted = null
  shownAct = null
  isBusy = false
  isHeld = false
  fillRound += 1
}

export function clearView() {
  view = null
  shownAct = null
  fillRound += 1
}

export function forgetFrames() {
  frames = new Map()
  shownAct = null
  fillRound += 1
}

export function pictureOf(target: View): string {
  const held = wanted === null ? undefined : frames.get(frameKey(target, wanted))
  shownAct = held ? wanted : null

  return held ?? target.base
}

async function frameFor($: Engine, target: View, act: string): Promise<string | null> {
  const key = frameKey(target, act)
  const held = frames.get(key)
  if (held) return held

  let file: string | null = null
  try {
    file = await hot($, act, target.rev, target.y, target.height)
  } catch {
    return null
  }

  if (file && view && isSame(view, target)) {
    if (frames.size >= FRAMES_MAX) frames.delete(frames.keys().next().value as string)
    frames.set(key, file)
  }

  return file
}

async function settle($: Engine) {
  if (isBusy) return

  isBusy = true
  try {
    while (view && !isHeld && shownAct !== wanted) {
      const target = view
      const want = wanted
      const file = (want === null ? null : await frameFor($, target, want)) ?? target.base

      if (isHeld) break
      if (!view || !isSame(view, target)) continue
      if (wanted !== want) continue

      const result = await $.ui.blit({ requestId: 'panel', key: target.imageKey, source: { file, format: 'png' }, columns: target.columns, rows: target.rows }).catch(error => ({ deny: String((error as Error)?.message ?? error) }))
      if (result && 'deny' in result && result.deny) void trace($, 'blit-denied', { why: result.deny, columns: target.columns, rows: target.rows, y: target.y })
      shownAct = want
      void traceVerbose($, 'hover', { act: want, ms: Date.now() - began, postMs: lastPostMs, isCached: want === null || frames.has(frameKey(target, want)) })
    }
  } finally {
    isBusy = false
  }
}

export function moveHover($: Engine, act: string | null, postMs: number | null = null) {
  if (act === wanted) return

  wanted = act
  began = Date.now()
  lastPostMs = postMs
  void settle($)
}

async function prefill($: Engine, round: number) {
  const target = view
  if (!target) return

  const visible = target.hits.filter(hit => hit.y < target.y + target.height && hit.y + hit.h > target.y).slice(0, PREFILL_MAX)

  for (const hit of visible) {
    if (round !== fillRound || !view || !isSame(view, target)) return
    if (frames.has(frameKey(target, hit.act))) continue

    if (!(await frameFor($, target, hit.act))) {
      void trace($, 'prefill-stopped', { done: frames.size })

      return
    }
  }

  void traceVerbose($, 'prefill-done', { frames: frames.size })
}

export function retarget(act: string | null) {
  wanted = act
}

export function holdHover(held: boolean) {
  isHeld = held
  if (held) shownAct = null
}

export function kick($: Engine) {
  if (view && shownAct !== wanted) void settle($)
}

export function setView($: Engine, next: View) {
  if (view && isSame(view, next)) return

  view = next
  shownAct = null
  fillRound += 1

  const round = fillRound
  $.clock.after(PREFILL_DELAY_MS, () => void prefill($, round))
}
