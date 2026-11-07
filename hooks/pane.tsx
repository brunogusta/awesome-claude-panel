import { atom, read } from 'claude-code'
import type { EngineInterface as Engine, PluginOptions, RenderInput, Timer, UiMessageArgument } from 'claude-code'

import type { Now, Scope, Touch } from '../types'
import { act, hitAt, hitIn, redraw, resetPaneState } from './actions'
import { cachedDiff, cachedFolderApp, cachedGit, cachedTree, resetCache } from './core/cache'
import { visibleTouched } from './core/activity'
import { parseDiff } from './core/diff'
import { findEditors } from './core/editors'
import type { PageModel } from './page/page'
import { pageOf } from './page/page'
import { errorFields, trace, traceVerbose } from './core/trace'
import { clearView, forgetFrames, holdHover, kick, moveHover, pictureOf, resetHover, retarget, setView } from './hover'
import { WHEEL_PX, clampPx, stepToward } from './smooth'
import type { View } from './hover'
import type { Frame } from './render/renderer'
import { clip, findChrome, isRunning, render, stop, whenLost } from './render/renderer'

export const openDiffAbs = atom({ plugin: 'panel', key: 'openDiffAbs' } as const, null as string | null, {
  shape: 'openDiffAbs-1',
})
export const isTreeOpen = atom({ plugin: 'panel', key: 'isTreeOpen' } as const, false, { shape: 'isTreeOpen-1' })
export const expanded = atom({ plugin: 'panel', key: 'expanded' } as const, [] as string[], { shape: 'expanded-1' })
export const showHidden = atom({ plugin: 'panel', key: 'showHidden' } as const, false, { shape: 'showHidden-1' })
export const showSizes = atom({ plugin: 'panel', key: 'showSizes' } as const, false, { shape: 'showSizes-1' })
export const touched = atom({ plugin: 'panel', key: 'touched' } as const, [] as Touch[], { shape: 'touched-2' })
export const now = atom({ plugin: 'panel', key: 'now' } as const, { kind: 'idle' } as Now, { shape: 'now-1' })
export const scope = atom({ plugin: 'panel', key: 'scope' } as const, 'turn' as Scope, { shape: 'scope-1' })
export const seen = atom({ plugin: 'panel', key: 'seen' } as const, {} as Record<string, number>, { shape: 'seen-1' })
export const turn = atom({ plugin: 'panel', key: 'turn' } as const, 0, { shape: 'turn-1' })

export const PANE_ID = 'panel'

const MIN_COLUMNS = 4
const IMAGE_CELLS_MAX = 255
const imageKeyOf = (columns: number, rows: number) => `page-${columns}x${rows}`
const MAX_PIXELS = 1_500_000
const RESIZE_SETTLE_MS = 150
const RESIZE_MAX_WAIT_MS = 700
const PAGE_BG = '#0d1117'
const RETRY_WITH_FRAME_MS = 400
const FIRST_DRAW_WAIT_MS = 1500
const NOW_REDRAW_MS = 1000
const RETRY_AFTER_FAILURE_MS = 30_000
const NEEDS_GHOSTTY = 'O painel precisa do Ghostty ou do kitty (no `claude agents`, com CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1)'

let cell = { width: 13, height: 28, scale: 1.3 }

export function setCellSize(options: PluginOptions) {
  const pick = (value: unknown, fallback: number) => (Number(value) > 0 ? Number(value) : fallback)

  cell = {
    width: pick(options.cellWidth, 13),
    height: pick(options.cellHeight, 28),
    scale: Math.min(4, Math.max(0.5, pick(options.pageScale, 1.3))),
  }
}

function gridOf(columns: number, rows: number): Grid {
  const area = columns * cell.width * Math.max(1, rows) * cell.height
  const k = Math.min(1, Math.sqrt(MAX_PIXELS / area))
  const w = Math.max(4, Math.round(cell.width * k))

  return { w, h: Math.max(8, Math.round(cell.height * k)), scale: cell.scale * (w / cell.width) }
}

type Grid = { w: number; h: number; scale: number }
type Landed = { key: string; baseKey: string; size: string; grid: Grid; columns: number; bodyRows: number; frame: Frame }
type Shown = { hits: Frame['hits']; offset: number; scale: number; grid: Grid }

let landed: Landed | null = null
let inflightKey: string | null = null
let inflightToken = 0
let drawCount = 0
let inflight: Promise<void> | null = null
let renderedAt = 0
let failedAt = 0
let isWarned = false
let isThrottled = false
let scrollPx = 0
let targetPx = 0
let isAnimating = false
let lastSize = ''
let sizeChangedAt = 0
let resizeStartedAt = 0
let isSettleScheduled = false
let slice: { limit: number; visible: number; columns: number; rows: number; imageKey: string } | null = null
let shown: Shown | null = null
let clipped: { key: string; file: string } | null = null
let clipFailedKey: string | null = null
let isRetryScheduled = false
let drawable: boolean | null = null
let maxScrollPx = 0
let pointer: { x: number; y: number; isCell: boolean } | null = null

const isCoolingDown = () => failedAt > 0 && Date.now() - failedAt < (landed ? RETRY_WITH_FRAME_MS : RETRY_AFTER_FAILURE_MS)

async function paintSlice($: Engine): Promise<boolean> {
  if (!landed || !slice) return false

  const { key, frame } = landed
  const y = Math.round(scrollPx)
  const made = await clip($, y, slice.limit)
  if (!made || landed?.key !== key) return false

  clipped = { key: `${key}|${y}|${slice.limit}`, file: made }
  const height = Math.min(slice.limit, frame.height - y)
  shown = { hits: frame.hits, offset: y, scale: (slice.rows * landed.grid.h) / Math.max(1, height), grid: landed.grid }
  const result = await $.ui.blit({ requestId: PANE_ID, key: slice.imageKey, source: { file: made, format: 'png' }, columns: slice.columns, rows: slice.rows }).catch(error => ({ deny: String((error as Error)?.message ?? error) }))
  if (result && 'deny' in result && result.deny) void trace($, 'blit-denied', { why: result.deny, columns: slice.columns, rows: slice.rows, y })
  void traceVerbose($, 'scroll-frame', { y, target: targetPx })

  return true
}

async function animateScroll($: Engine) {
  isAnimating = true
  holdHover(true)

  try {
    while (landed && scrollPx !== targetPx) {
      scrollPx = stepToward(scrollPx, targetPx)
      if (!(await paintSlice($))) break
    }
  } catch (error) {
    void trace($, 'scroll-error', errorFields(error))
  } finally {
    isAnimating = false
    holdHover(false)
  }

  redraw($)
}

export function scrollBy($: Engine, units: number) {
  const next = clampPx(targetPx + units * WHEEL_PX * ((landed?.grid.w ?? cell.width) / cell.width), maxScrollPx)
  if (next === targetPx) return

  targetPx = next
  if (!isAnimating) void animateScroll($)
}

export function snapshotOf() {
  return {
    hasFrame: landed !== null,
    frameH: landed?.frame.height,
    size: landed?.size,
    rev: landed?.frame.rev,
    inflight: inflightKey !== null,
    scrollPx,
    targetPx,
    maxScrollPx,
    isAnimating,
    pointer: pointer !== null,
    failedMsAgo: failedAt ? Date.now() - failedAt : null,
    running: isRunning(),
  }
}

export function resetPane() {
  landed = null
  inflightKey = null
  inflightToken = 0
  inflight = null
  renderedAt = 0
  failedAt = 0
  isRetryScheduled = false
  isThrottled = false
  scrollPx = 0
  targetPx = 0
  maxScrollPx = 0
  slice = null
  pointer = null
  shown = null
  clipped = null
  clipFailedKey = null
  drawable = null
  resetHover()
  resetCache()
}

export function resetSessionPane() {
  resetPane()
  isWarned = false
}

const drop = () => {
  forgetFrames()
  clearView()
  landed = null
  inflightKey = null
  inflightToken = 0
  inflight = null
  clipped = null
  clipFailedKey = null
  shown = null
}

async function canDraw($: Engine, e: { surface: string }): Promise<boolean> {
  if (e.surface !== 'terminal') return false
  if (drawable !== null) return drawable

  const [tmux, term, program, ghostty, kitty, kind, forced] = await Promise.all([
    $.env.get('TMUX').catch(() => undefined),
    $.env.get('TERM').catch(() => undefined),
    $.env.get('TERM_PROGRAM').catch(() => undefined),
    $.env.get('GHOSTTY_RESOURCES_DIR').catch(() => undefined),
    $.env.get('KITTY_WINDOW_ID').catch(() => undefined),
    $.env.get('CLAUDE_CODE_SESSION_KIND').catch(() => undefined),
    $.env.get('CLAUDE_CODE_FORCE_TERMINAL_IMAGES').catch(() => undefined),
  ])
  const hasMarker = /kitty|ghostty/i.test(term ?? '') || /kitty|ghostty/i.test(program ?? '') || Boolean(ghostty) || Boolean(kitty)
  drawable = !tmux && hasMarker && (kind !== 'bg' || Boolean(forced))

  return drawable
}

export async function modelOf($: Engine): Promise<PageModel> {
  const project = await $.session.cwd()
  const [list, current, sc, openAbs, isTree, open, hidden, sizes, git] = await Promise.all([
    read($, touched),
    read($, turn),
    read($, scope),
    read($, openDiffAbs),
    read($, isTreeOpen),
    read($, expanded),
    read($, showHidden),
    read($, showSizes),
    cachedGit($, project),
  ])
  const [cur, editors, folder, diff, tree, seenAt] = await Promise.all([
    read($, now),
    findEditors($),
    cachedFolderApp($),
    openAbs ? cachedDiff($, openAbs).catch(() => null) : null,
    isTree ? cachedTree($, git?.root ?? project, open, hidden, sizes) : null,
    read($, seen),
  ])

  return {
    project,
    now: cur,
    touched: visibleTouched(list, sc, current),
    scope: sc,
    git,
    openDiff: openAbs && diff ? { abs: openAbs, rows: parseDiff(diff.text), more: diff.more, isBinary: diff.isBinary } : null,
    tree,
    editors,
    hasFolderApp: folder,
    showSizes: sizes,
    showHidden: hidden,
    seen: seenAt,
  }
}

async function fail($: Engine, why = 'render') {
  failedAt = Date.now()
  void trace($, 'fail', { why, state: snapshotOf() })

  if (!isRetryScheduled) {
    isRetryScheduled = true
    $.clock.after(landed ? RETRY_WITH_FRAME_MS : RETRY_AFTER_FAILURE_MS, () => {
      isRetryScheduled = false
      redraw($)
    })
  }

  if (isWarned || landed) return

  isWarned = true
  const reason = (await findChrome($).catch(() => null)) ? 'falha ao desenhar' : 'Chromium não encontrado'
  void trace($, 'toast', { reason, state: snapshotOf() })
  $.ui.toast(`Painel indisponível: ${reason}`)
}

function start($: Engine, key: string, baseKey: string, size: string, grid: Grid, layout: { columns: number; bodyRows: number }, html: string, width: number, height: number) {
  const token = ++drawCount
  inflightKey = key
  inflightToken = token
  renderedAt = Date.now()
  failedAt = 0

  inflight = render($, html, width, height, grid.scale)
    .catch(error => {
      const message = String((error as Error)?.message ?? error)
      void trace($, 'render-threw', { message })

      return /superseded|aborted/i.test(message) ? ('replaced' as const) : null
    })
    .then(async frame => {
      if (inflightToken !== token) return

      inflightKey = null

      if (frame === 'replaced') {
        inflightToken = 0
        inflight = null
        redraw($)

        return
      }

      if (frame && frame.height >= 1) landed = { key, baseKey, size, grid, columns: layout.columns, bodyRows: layout.bodyRows, frame }
      else await fail($, frame ? `frame height ${frame.height}` : `render returned null (token ${token}, now ${inflightToken})`)

      redraw($)
    })
    .catch(error => void trace($, 'start-error', errorFields(error)))
}

function whenToRedrawNow($: Engine) {
  if (isThrottled) return

  isThrottled = true
  $.clock.after(Math.max(1, NOW_REDRAW_MS - (Date.now() - renderedAt)), () => {
    isThrottled = false
    redraw($)
  })
}

async function waitFirst($: Engine, drawing: Promise<void>) {
  let timer: Timer | undefined
  const late = new Promise<void>(resolve => {
    timer = $.clock.after(FIRST_DRAW_WAIT_MS, resolve)
  })

  await Promise.race([drawing, late])
  timer?.cancel()
}

async function ensure($: Engine, key: string, baseKey: () => string, size: string, grid: Grid, layout: { columns: number; bodyRows: number }, html: string, width: number, height: number) {
  if (landed?.key === key || inflightKey === key) {
    if (!landed && inflight && isRunning()) await waitFirst($, inflight)

    return
  }

  const isOnlyNowChanged = landed !== null && landed.baseKey === baseKey()
  if (isOnlyNowChanged && Date.now() - renderedAt < NOW_REDRAW_MS) return whenToRedrawNow($)

  const isWarm = isRunning()
  start($, key, baseKey(), size, grid, layout, html, width, height)
  if (!landed && inflight && isWarm) await waitFirst($, inflight)
}

export async function renderPane($: Engine, e: RenderInput<'Pane'>, isRetry = false): Promise<unknown> {
  return renderPaneTimed($, e, isRetry)
}

async function renderPaneTimed($: Engine, e: RenderInput<'Pane'>, isRetry: boolean): Promise<unknown> {
  const elements = $.ui.resolve(e)
  if (!('Image' in elements && 'Client' in elements)) {
    void trace($, 'no-image-element', { surface: e.surface, keys: Object.keys(elements) })

    return null
  }

  const { Box, Text, Image, Client } = elements

  if (!(await canDraw($, e))) {
    void trace($, 'cannot-draw', { surface: e.surface, drawable })

    return <Text>{NEEDS_GHOSTTY}</Text>
  }
  if (e.props.bodyColumns < MIN_COLUMNS) return <Text dimColor>Desenhando…</Text>
  if (isCoolingDown() && !landed) {
    void trace($, 'cooling-down', { sinceFailMs: Date.now() - failedAt })

    return <Text dimColor>Painel indisponível</Text>
  }

  // An idle stop keeps the last PNGs, so the frame in hand stays valid and nothing redraws: Chrome only returns on a real change.
  // A server that dies on its own counts as a failure: redrawing at once would relaunch it in a loop.
  whenLost((isDeath, isAborted) => {
    forgetFrames()
    if (!isDeath) return

    drop()
    if (isAborted) return redraw($)

    void fail($, 'server-death').then(() => redraw($))
  })

  const model = await modelOf($)
  const columns = Math.min(IMAGE_CELLS_MAX, e.props.bodyColumns)
  const bodyRows = Math.min(IMAGE_CELLS_MAX, Math.max(1, e.props.scroll.bodyRows))
  const grid = gridOf(columns, bodyRows)
  const width = columns * grid.w
  const limit = bodyRows * grid.h
  const html = pageOf(model)
  const size = `${width}x${limit}@${grid.scale}`
  const key = `${size}\n${html}`
  let base: string | null = null
  const baseKey = () => (base ??= `${size}\n${pageOf({ ...model, now: { kind: 'idle' } })}`)

  if (size !== lastSize) {
    lastSize = size
    sizeChangedAt = Date.now()
    if (resizeStartedAt === 0) resizeStartedAt = sizeChangedAt
    void trace($, 'size', { columns, rows: bodyRows, asked: [e.props.bodyColumns, e.props.scroll.bodyRows], grid, pixels: width * limit, state: snapshotOf() })
  }

  if (landed?.size === size) resizeStartedAt = 0

  const isResizing = landed !== null && landed.size !== size && Date.now() - sizeChangedAt < RESIZE_SETTLE_MS && Date.now() - resizeStartedAt < RESIZE_MAX_WAIT_MS

  if (isResizing && !isSettleScheduled) {
    isSettleScheduled = true
    $.clock.after(RESIZE_SETTLE_MS, () => {
      isSettleScheduled = false
      redraw($)
    })
  }

  if (!isCoolingDown() && !isResizing) await ensure($, key, baseKey, size, grid, { columns, bodyRows }, html, width, limit)

  if (failedAt && !landed) return <Text dimColor>Painel indisponível</Text>

  if (!landed) {
    shown = null

    return <Text dimColor>Desenhando…</Text>
  }

  const { frame, grid: g } = landed
  const isStale = landed.size !== size
  const shownColumns = isStale ? landed.columns : columns
  const shownRows = isStale ? landed.bodyRows : bodyRows
  const limitPx = shownRows * g.h
  const needsScroll = frame.height - limitPx > g.h / 2
  const visible = shownRows
  maxScrollPx = needsScroll ? frame.height - limitPx : 0
  if (!isAnimating) {
    scrollPx = clampPx(scrollPx, maxScrollPx)
    targetPx = scrollPx
  }
  const offsetPx = needsScroll ? Math.round(scrollPx) : 0
  let sliceFile: string | null = null

  if (needsScroll) {
    const clipKey = `${landed.key}|${offsetPx}|${limitPx}`

    if (clipped?.key !== clipKey && clipFailedKey !== landed.key) {
      const made = await clip($, offsetPx, limitPx)

      if (made) clipped = { key: clipKey, file: made }
      else if (!isRunning() && !isRetry) {
        drop()

        return renderPaneTimed($, e, true)
      } else clipFailedKey = landed.key
    }

    sliceFile = clipped?.key === clipKey ? clipped.file : null
  }

  const isSliced = sliceFile !== null
  const file = sliceFile ?? frame.file
  const shotPx = isSliced ? Math.min(limitPx, frame.height - offsetPx) : Math.min(frame.height, limitPx)

  if (shotPx < 1) {
    shown = null

    return <Text dimColor>Desenhando…</Text>
  }

  const rows = Math.min(IMAGE_CELLS_MAX, Math.max(1, Math.round(shotPx / g.h)))
  slice = isSliced ? { limit: limitPx, visible, columns: shownColumns, rows, imageKey: imageKeyOf(shownColumns, shownRows) } : null
  shown = { hits: frame.hits, offset: isSliced ? offsetPx : 0, scale: (rows * g.h) / shotPx, grid: g }

  const view: View = { key: landed.key, rev: frame.rev, y: isSliced ? offsetPx : 0, height: shotPx, columns: shownColumns, rows, base: file, hits: frame.hits, imageKey: imageKeyOf(shownColumns, shownRows) }
  setView($, view)
  if (pointer) retarget(actionAt(pointer.x, pointer.y, pointer.isCell))
  const picture = pictureOf(view)
  kick($)

  const imageKey = imageKeyOf(shownColumns, shownRows)

  return (
    <Box flexDirection="column" alignItems="flex-start" width="100%" height={Math.max(1, bodyRows)} backgroundColor={PAGE_BG}>
      <Box flexDirection="column" width={shownColumns} height={rows} flexShrink={0}>
        <Image key={imageKey} source={{ file: picture, format: 'png' }} columns={shownColumns} rows={rows} alt="Painel" />
        <Box position="absolute" top={0} left={0} width={shownColumns} height={rows}>
          <Client key="hit" module="./render/overlay.tsx" width={shownColumns} height={rows} props={{ expect: { columns: shownColumns, rows } }} />
        </Box>
      </Box>
    </Box>
  )
}

function actionAt(x: number, y: number, isCell = false) {
  if (!shown) return null

  const { grid: g, offset, scale, hits } = shown
  const top = (row: number) => offset + (row * g.h) / scale

  if (!isCell) return hitAt(hits, x * g.w, top(y))

  return hitIn(hits, (x - 0.5) * g.w, top(y - 0.5), (x + 0.5) * g.w, top(y + 0.5))
}

export async function onOverlay($: Engine, e: UiMessageArgument) {
  const data = e.data as { x?: unknown; y?: unknown; t?: unknown; hover?: unknown; leave?: unknown; isCell?: unknown; region?: { columns?: unknown; rows?: unknown; expect?: { columns?: unknown; rows?: unknown } } } | null

  if (data?.region) {
    const { columns, rows, expect } = data.region
    const isMatch = columns === expect?.columns && rows === expect?.rows
    void trace($, isMatch ? 'region' : 'region-mismatch', { got: [columns, rows], expected: [expect?.columns, expect?.rows], state: isMatch ? undefined : snapshotOf() })

    return
  }

  if (data?.leave === true) {
    pointer = null
    moveHover($, null)

    return
  }

  if (!shown || typeof data?.x !== 'number' || typeof data.y !== 'number') return

  if (data.hover === true) {
    pointer = { x: data.x, y: data.y, isCell: data.isCell === true }
    moveHover($, actionAt(data.x, data.y, pointer.isCell), typeof data.t === 'number' ? Date.now() - data.t : null)

    return
  }

  const began = Date.now()
  const action = actionAt(data.x, data.y, data.isCell === true)

  try {
    if (action) await act($, action, 'terminal')
  } catch (error) {
    void trace($, 'act-error', { action, ...errorFields(error) })
  }
  void trace($, 'click', { action, actMs: Date.now() - began, isCell: data.isCell === true })
  redraw($)
}

export async function closePane($: Engine) {
  resetPane()
  await resetPaneState($).catch(() => {})
  await stop($)
}
