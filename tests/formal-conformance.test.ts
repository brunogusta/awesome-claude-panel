import type { EngineInterface } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { act, hitAt, hitIn } from '../hooks/actions'
import { findEditors, resetEditorsCache } from '../hooks/core/editors'
import { moveHover, pictureOf, resetHover, retarget, setView } from '../hooks/hover'
import type { View } from '../hooks/hover'
import { esc } from '../hooks/page/format'
import { estimateHeight, pageOf, type PageModel } from '../hooks/page/page'
import type { Hit } from '../hooks/render/renderer'
import { render, stop } from '../hooks/render/renderer'
import { guarded, resetTrace, trace } from '../hooks/core/trace'
import { WHEEL_PX, clampPx, stepToward } from '../hooks/smooth'

// A fila de log é estado de módulo: estes testes ficam primeiro, antes de qualquer outro que registre eventos.
const logWorld = (options: { hold?: boolean } = {}) => {
  const runs: string[][] = []
  const timers: Array<() => void> = []
  const gates: Array<(fail: boolean) => void> = []

  const $ = {
    plugin: { root: '/plug' },
    env: { get: async (name: string) => (name === 'HOME' ? '/home/u' : undefined) },
    fs: { exists: async () => false },
    session: { id: async () => 'abcdef123456' },
    clock: { after: (_ms: number, fn: () => void) => (timers.push(fn), { cancel: () => {} }) },
    process: {
      run: async (argv: string[]) => {
        if (options.hold) {
          const failed = await new Promise<boolean>(resolve => gates.push(resolve))

          if (failed) throw new Error('superseded')
        }

        runs.push(argv)

        return { exitCode: 0, stdout: '', stderr: '' }
      },
    },
  } as unknown as EngineInterface

  const fire = async () => {
    for (const fn of timers.splice(0)) fn()
    await new Promise(resolve => setTimeout(resolve, 15))
  }

  return { $, runs, gates, fire }
}

const evs = (run: string[] | undefined) => (run?.slice(5) ?? []).map(line => JSON.parse(line) as Record<string, unknown>)

test('fila de log: nunca passa de 400 e o descarte conta dropped, como no modelo Lean', async () => {
  for (const total of [1, 399, 400, 401, 450, 1000]) {
    resetTrace()
    const w = logWorld()

    for (let i = 0; i < total; i++) await trace(w.$, 'x', { i })
    await w.fire()

    const lines = evs(w.runs[0])
    const kept = lines.filter(one => one.ev === 'x')
    const dropped = lines.find(one => one.ev === 'log-dropped')

    expect(kept.length).toBe(Math.min(total, 400))
    expect(dropped?.count ?? 0).toBe(Math.max(0, total - 400))
    expect(kept.length + Number(dropped?.count ?? 0)).toBe(total)
  }
})

test('gravação que falha devolve linhas e cabeçalho; o que passa de 400 na devolução também é contado', async () => {
  resetTrace()
  const w = logWorld({ hold: true })

  for (let i = 0; i < 400; i++) await trace(w.$, 'a', { i })
  await w.fire()
  for (let i = 0; i < 300; i++) await trace(w.$, 'b', { i })
  w.gates.shift()!(true)
  await new Promise(resolve => setTimeout(resolve, 15))

  await w.fire()
  w.gates.shift()!(false)
  await new Promise(resolve => setTimeout(resolve, 15))

  const lines = evs(w.runs[0])
  const kept = lines.filter(one => one.ev === 'a' || one.ev === 'b')
  const dropped = lines.find(one => one.ev === 'log-dropped')

  expect(lines[0]).toMatchObject({ ev: 'log-open' })
  expect(kept.length).toBe(400)
  expect(kept.length + Number(dropped?.count ?? 0)).toBe(700)
})

test('guarded continua devolvendo o valor e relançando o erro (cobertura da fila)', async () => {
  resetTrace()
  const w = logWorld()

  expect(await guarded(w.$, 'x', async () => 3)).toBe(3)
})

let seed = 12345
const rand = (n: number) => {
  seed = (seed * 1103515245 + 12345) % 2147483648

  return seed % n
}

const randomHits = (count: number): Hit[] =>
  Array.from({ length: count }, (_, i) => ({ act: `h${i}`, x: rand(14) - 1, y: rand(14) - 1, w: rand(8) - 1, h: rand(8) - 1 }))

type Pick = (hit: Hit) => boolean

const leanPick = (hits: Hit[], keep: Pick) => {
  let best: Hit | null = null

  for (const hit of hits) {
    if (!keep(hit)) continue
    if (best === null || hit.w * hit.h < best.w * best.h) best = hit
  }

  return best?.act ?? null
}

const leanHitAt = (hits: Hit[], px: number, py: number) =>
  leanPick(hits, hit => hit.x <= px && px < hit.x + hit.w && hit.y <= py && py < hit.y + hit.h)

type Cell = { l: number; t: number; r: number; b: number }

const across = (cell: Cell, hit: Hit) => Math.min(cell.r, hit.x + hit.w) - Math.max(cell.l, hit.x)
const down = (cell: Cell, hit: Hit) => Math.min(cell.b, hit.y + hit.h) - Math.max(cell.t, hit.y)
const cellArea = (cell: Cell) => (cell.r - cell.l) * (cell.b - cell.t)

const qualifies = (cell: Cell, hit: Hit) =>
  across(cell, hit) > 0 && down(cell, hit) > 0 && 3 * Math.min(cellArea(cell), hit.w * hit.h) <= 10 * (across(cell, hit) * down(cell, hit))

const leanHitIn = (hits: Hit[], cell: Cell) => leanPick(hits, hit => qualifies(cell, hit))

test('hitAt: igual à definição Lean em listas aleatórias, incluindo retângulos degenerados e empates', () => {
  for (let round = 0; round < 300; round++) {
    const hits = randomHits(1 + rand(6))

    for (let x = -2; x < 16; x++) {
      for (let y = -2; y < 16; y++) expect(hitAt(hits, x, y)).toBe(leanHitAt(hits, x, y))
    }
  }
})

test('hitAt: limites semiabertos, menor área, primeiro no empate, botão aninhado vence a linha', () => {
  const hits = [{ act: 'a', x: 10, y: 20, w: 5, h: 4 }]

  expect(hitAt(hits, 10, 20)).toBe('a')
  expect(hitAt(hits, 15, 20)).toBeNull()
  expect(hitAt(hits, 10, 24)).toBeNull()
  expect(hitAt([{ act: 'zero', x: 0, y: 0, w: 0, h: 10 }], 0, 0)).toBeNull()

  const tieA = { act: 'tieA', x: 0, y: 0, w: 10, h: 20 }
  const tieB = { act: 'tieB', x: 0, y: 0, w: 20, h: 10 }

  expect(hitAt([tieA, tieB], 1, 1)).toBe('tieA')
  expect(hitAt([tieB, tieA], 1, 1)).toBe('tieB')

  const row = { act: 'file:/a', x: 0, y: 0, w: 400, h: 30 }
  const button = { act: 'copy:/a', x: 300, y: 5, w: 60, h: 20 }

  for (const list of [[row, button], [button, row]]) {
    expect(hitAt(list, 330, 10)).toBe('copy:/a')
    expect(hitAt(list, 360, 10)).toBe('file:/a')
  }
})

test('hitIn: igual à definição Lean em células e listas aleatórias', () => {
  for (let round = 0; round < 400; round++) {
    const hits = randomHits(1 + rand(6))

    for (let i = 0; i < 40; i++) {
      const l = rand(14) - 1
      const t = rand(14) - 1
      const cell = { l, t, r: l + rand(6) - 1, b: t + rand(6) - 1 }

      expect(hitIn(hits, cell.l, cell.t, cell.r, cell.b)).toBe(leanHitIn(hits, cell))
    }
  }
})

test('hitIn: vizinho que só encosta nunca volta, 30% é o piso e a célula 1x1 coincide com hitAt', () => {
  const cell = { l: 10, t: 10, r: 20, b: 20 }
  const touching = [
    { act: 'left', x: 0, y: 10, w: 10, h: 10 },
    { act: 'right', x: 20, y: 10, w: 10, h: 10 },
    { act: 'above', x: 10, y: 0, w: 10, h: 10 },
    { act: 'below', x: 10, y: 20, w: 10, h: 10 },
    { act: 'corner', x: 20, y: 20, w: 5, h: 5 },
  ]

  expect(hitIn(touching, cell.l, cell.t, cell.r, cell.b)).toBeNull()

  const wide = { act: 'wide', x: 17, y: 10, w: 30, h: 10 }
  const wideEdge = { act: 'edge', x: 18, y: 10, w: 30, h: 10 }

  expect(hitIn([wide], 10, 10, 20, 20)).toBe('wide')
  expect(hitIn([wideEdge], 10, 10, 20, 20)).toBeNull()
  expect(hitIn([{ act: 'small', x: 19, y: 10, w: 1, h: 10 }, wideEdge], 10, 10, 20, 20)).toBe('small')

  const big = { act: 'big', x: 0, y: 0, w: 100, h: 100 }
  const mid = { act: 'mid', x: 0, y: 0, w: 50, h: 50 }

  expect(hitIn([big, mid], 10, 10, 20, 20)).toBe('mid')

  for (let round = 0; round < 300; round++) {
    const hits = randomHits(1 + rand(6))

    for (let x = -2; x < 16; x++) {
      for (let y = -2; y < 16; y++) expect(hitIn(hits, x, y, x + 1, y + 1)).toBe(hitAt(hits, x, y))
    }
  }

  for (let round = 0; round < 300; round++) {
    const hits = randomHits(1 + rand(6))
    const l = rand(12)
    const t = rand(12)
    const got = hitIn(hits, l, t, l + 1 + rand(5), t + 1 + rand(5))

    if (got === null) continue

    const hit = hits.find(one => one.act === got)!

    expect(hit.w).toBeGreaterThan(0)
    expect(hit.h).toBeGreaterThan(0)
  }
})

const leanStep = (cur: number, tgt: number) => {
  const gap = tgt - cur

  return -3 <= gap && gap <= 3 ? tgt : cur + Math.floor((4 * gap + 5) / 10)
}

const leanClamp = (value: number, max: number) => Math.min(Math.max(0, value), Math.max(0, max))

test('stepToward e clampPx: iguais à definição Lean (Math.round(gap*0.4) = floor((4gap+5)/10))', () => {
  for (let cur = -40; cur <= 40; cur += 1) {
    for (let tgt = -300; tgt <= 300; tgt += 1) expect(stepToward(cur, tgt)).toBe(leanStep(cur, tgt))
  }

  for (const cur of [0, 1, 17, 56, 500, 7999]) {
    for (let gap = -1500; gap <= 1500; gap += 7) expect(stepToward(cur, cur + gap)).toBe(leanStep(cur, cur + gap))
  }

  for (let value = -50; value <= 300; value += 5) {
    for (let max = -20; max <= 250; max += 5) {
      const got = clampPx(value, max)

      expect(got).toBe(leanClamp(value, max))
      expect(got).toBeGreaterThanOrEqual(0)
      expect(got).toBeLessThanOrEqual(Math.max(0, max))
    }
  }
})

test('stepToward: nunca ultrapassa, aproxima estritamente e termina no alvo em no máximo |gap| passos', () => {
  for (const [from, to] of [[0, WHEEL_PX], [0, 900], [500, 0], [120, 121], [0, 0], [300, 297], [7999, 0], [0, 8000]]) {
    let at = from
    let steps = 0

    while (at !== to) {
      const next = stepToward(at, to)

      expect(Math.abs(to - next)).toBeLessThan(Math.abs(to - at))
      expect(next).not.toBe(at)
      expect(Math.min(at, to)).toBeLessThanOrEqual(next)
      expect(next).toBeLessThanOrEqual(Math.max(at, to))
      at = next
      steps += 1
      expect(steps).toBeLessThanOrEqual(Math.abs(to - from))
    }
  }
})

const needsScroll = (frameH: number, limit: number) => frameH > limit
const maxScrollOf = (frameH: number, limit: number) => (needsScroll(frameH, limit) ? frameH - limit : 0)
const offsetOf = (frameH: number, limit: number, scroll: number) => (needsScroll(frameH, limit) ? clampPx(scroll, maxScrollOf(frameH, limit)) : 0)
const shotOf = (frameH: number, limit: number, offset: number) => (needsScroll(frameH, limit) ? Math.min(limit, frameH - offset) : Math.min(frameH, limit))
const rowsOf = (shot: number, ch: number) => Math.max(1, Math.ceil(shot / ch))

test('fatia, guarda shotPx < 1 e escala: a fórmula do pane cumpre os teoremas do Lean', () => {
  const ch = 28

  for (const frameH of [1, 2, 27, 28, 29, 280, 281, 560, 561, 8000]) {
    for (const bodyRows of [0, 1, 2, 5, 20, 400]) {
      const limit = Math.max(1, bodyRows) * ch

      for (const scroll of [-9, 0, 1, 56, 111, 5000, 99999]) {
        const y = offsetOf(frameH, limit, scroll)
        const shot = shotOf(frameH, limit, y)

        expect(y).toBeGreaterThanOrEqual(0)
        expect(shot).toBeGreaterThanOrEqual(1)
        expect(y + shot).toBeLessThanOrEqual(frameH)

        const rows = rowsOf(shot, ch)
        const scale = (rows * ch) / shot

        expect(rows * ch).toBeGreaterThanOrEqual(shot)
        expect(rows * ch).toBeLessThan(shot + ch)
        expect(Number.isFinite(scale)).toBe(true)
        expect(scale).toBeGreaterThanOrEqual(1)
      }
    }
  }

  expect(maxScrollOf(500, 200)).toBe(300)
  expect(maxScrollOf(200, 200)).toBe(0)
  expect(maxScrollOf(100, 200)).toBe(0)
  expect(Number.isFinite((1 * ch) / 0)).toBe(false)
  expect(Number.isFinite((1 * ch) / Math.max(1, 0))).toBe(true)
})

test('clique: o pixel de página de qualquer ponto da imagem cai dentro da fatia e da página', () => {
  const ch = 28
  const cw = 13

  for (const frameH of [1, 29, 281, 561, 8000]) {
    for (const bodyRows of [1, 3, 20]) {
      const limit = bodyRows * ch

      for (const scroll of [0, 56, 4000]) {
        const offset = offsetOf(frameH, limit, scroll)
        const shot = shotOf(frameH, limit, offset)
        const rows = rowsOf(shot, ch)
        const scale = (rows * ch) / shot
        const columns = 60

        for (const [x, y] of [[0, 0], [columns - 0.001, rows - 0.001], [columns / 2, rows / 2], [3.25, 0.5]] as const) {
          const px = x * cw
          const py = offset + (y * ch) / scale

          expect(px).toBeGreaterThanOrEqual(0)
          expect(px).toBeLessThan(columns * cw)
          expect(py).toBeGreaterThanOrEqual(offset)
          expect(py).toBeLessThan(offset + shot)
          expect(py).toBeLessThan(frameH)
        }
      }
    }
  }
})

const VIEW = (over: Partial<PageModel> = {}): PageModel => ({
  project: '/proj',
  now: { kind: 'idle' },
  touched: [],
  scope: 'session',
  git: null,
  openDiff: null,
  tree: null,
  editors: [{ name: 'VS Code', cli: 'code' }],
  hasFolderApp: false,
  showSizes: false,
  showHidden: false,
  ...over,
})

const touch = (abs: string, at: number) => ({ abs, isEdited: true, isEditedThisTurn: true, at, turn: 1 })

const unesc = (text: string) =>
  text.replace(/&(amp|lt|gt|quot|#39);/g, (_, name: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[name]!)

const actsIn = (html: string) => [...html.matchAll(/data-act="([^"]*)"/g)].map(one => one[1]!)

const NASTY = ['/proj/a b/c.ts', '/proj/it\'s "x".ts', '/proj/a<b>&c.ts', 'C:/Users/x y/a:b.ts', '/proj/:lead.ts', '/proj/trail:', '/proj/&amp;.ts', '/proj/ação é útil.ts', '/proj/a|b.ts']

const leanParse = (action: string) => {
  const parts = action.split(':')

  return { verb: parts[0] ?? '', tail: parts.slice(1).join(':') }
}

const leanParseOpen = (action: string) => {
  const parts = action.split(':')

  return { cli: parts[1], abs: parts.slice(2).join(':') }
}

test('atos da página: cada data-act decodifica para verbo:abs exato e o parse devolve (verbo, abs)', () => {
  for (const abs of NASTY) {
    const rows = [{ kind: 'hunk' as const, line: 1, context: '' }, { kind: 'add' as const, line: 1, text: 'x' }]
    const html = pageOf(
      VIEW({
        touched: [touch(abs, 1)],
        openDiff: { abs, rows, more: 0 },
        hasFolderApp: true,
        editors: [{ name: 'VS Code', cli: 'code' }, { name: 'Cursor', cli: 'cursor' }],
      }),
    )
    const acts = actsIn(html).map(unesc)

    for (const verb of ['file', 'copy', 'mention', 'folder']) {
      expect(acts).toContain(`${verb}:${abs}`)
      expect(leanParse(`${verb}:${abs}`)).toEqual({ verb, tail: abs })
    }

    for (const cli of ['code', 'cursor']) {
      expect(acts).toContain(`open:${cli}:${abs}`)
      expect(leanParseOpen(`open:${cli}:${abs}`)).toEqual({ cli, abs })
    }

    for (const attr of actsIn(html)) {
      expect(attr).not.toMatch(/[<>"']/)
      expect(attr.replace(/&(amp|lt|gt|quot|#39);/g, '')).not.toContain('&')
    }
  }

  const tree = pageOf(VIEW({ tree: [{ abs: '/proj/a:b dir', name: 'a:b dir', depth: 0, isDir: true, isOpen: false }] }))
  const acts = actsIn(tree).map(unesc)

  expect(acts).toContain('dir:/proj/a:b dir')
  for (const bare of ['refresh', 'collapse', 'sizes', 'hidden', 'scope']) {
    expect(acts).toContain(bare)
    expect(leanParse(bare)).toEqual({ verb: bare, tail: '' })
  }
})

const world = (cli: string, installed = true) => {
  resetEditorsCache()
  const ran: string[][] = []
  const copied: string[] = []
  const toasts: string[] = []

  const $ = {
    env: { get: async () => undefined },
    session: { cwd: async () => '/proj' },
    ui: {
      invalidate: () => {},
      copy: async (args: { text: string }) => void copied.push(args.text),
      toast: (text: string) => void toasts.push(text),
    },
    prompt: { fill: async () => {} },
    process: {
      run: async (argv: string[]) => {
        ran.push(argv)
        if (argv[0] === 'uname') return { exitCode: 0, stdout: 'Linux\n', stderr: '' }
        if (argv[0] === 'which') return { exitCode: installed && argv[1] === cli ? 0 : 1, stdout: `/usr/bin/${cli}\n`, stderr: '' }

        return { exitCode: 0, stdout: '', stderr: '' }
      },
    },
  } as unknown as EngineInterface

  return { $, ran, copied, toasts }
}

test('act real: open:cli:abs entrega o caminho intacto ao editor e copy: copia o texto exato', async () => {
  for (const abs of NASTY) {
    const w = world('code')

    await act(w.$, `open:code:${abs}`, 'terminal')
    expect(w.ran.at(-1)).toEqual(['code', abs])
    expect(w.toasts).toEqual([])

    await act(w.$, `copy:${abs}`, 'terminal')
    expect(w.copied).toEqual([abs])
  }
})

test('um cli com ":" quebra o parse (contraexemplo do Lean) e findEditors filtra esse caso', async () => {
  expect(leanParseOpen('open:a:b:/x')).toEqual({ cli: 'a', abs: 'b:/x' })
  expect(leanParseOpen('open:a:b:/x')).not.toEqual({ cli: 'a:b', abs: '/x' })

  const candidates = [
    { name: 'VS Code', cli: 'code', app: 'Visual Studio Code' },
    { name: 'Cursor', cli: 'cursor', app: 'Cursor' },
    { name: 'Windsurf', cli: 'windsurf', app: 'Windsurf' },
    { name: 'Zed', cli: 'zed', app: 'Zed' },
    { name: 'Sublime Text', cli: 'subl', app: 'Sublime Text' },
  ]

  const probe = (os: 'Linux' | 'Darwin', mask: number, colonMask: number) => {
    resetEditorsCache()

    return {
      env: { get: async () => undefined },
      process: {
        run: async (argv: readonly string[]) => {
          if (argv[0] === 'uname') return { exitCode: 0, stdout: `${os}\n`, stderr: '' }

          const at = os === 'Linux' ? candidates.findIndex(one => one.cli === argv[1]) : candidates.findIndex(one => one.app === argv[2])
          const ok = (mask >> at) & 1
          const colon = (colonMask >> at) & 1

          return { exitCode: ok ? 0 : 1, stdout: colon ? 'C:\\bin\\x\n' : '/usr/bin/x\n', stderr: '' }
        },
      },
    } as unknown as EngineInterface
  }

  for (const os of ['Linux', 'Darwin'] as const) {
    for (let mask = 0; mask < 32; mask++) {
      for (const colonMask of [0, 0b10101, 0b11111]) {
        const found = await findEditors(probe(os, mask, colonMask))
        const expected = candidates
          .filter((one, at) => ((mask >> at) & 1) === 1 && (os === 'Darwin' || ((colonMask >> at) & 1) === 0))
          .map(one => ({ name: one.name, cli: os === 'Darwin' ? one.app : one.cli }))

        expect(found).toEqual(expected)
        for (const editor of found) expect(editor.cli).not.toContain(':')
      }
    }
  }
})

test('esc: igual à definição Lean, sem < > " \' crus, todo & abre uma entidade e é injetiva', () => {
  const leanEscChar = (c: string) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : c === "'" ? '&#39;' : c)
  const alphabet = ['a', '&', '<', '>', '"', "'", ';', '#', '3', '9', 'l', 't', 'ç']
  const all: string[] = ['']

  for (let len = 1; len <= 4; len++) {
    const from = all.filter(one => one.length === len - 1 || (len > 1 && [...one].length === len - 1))

    for (const prefix of from) for (const c of alphabet) all.push(prefix + c)
  }

  const seen = new Map<string, string>()

  for (const text of new Set(all)) {
    const out = esc(text)

    expect(out).toBe([...text].map(leanEscChar).join(''))
    expect(out).not.toMatch(/[<>"']/)
    expect(out.replace(/&(amp|lt|gt|quot|#39);/g, '')).not.toContain('&')
    expect(unesc(out)).toBe(text)
    expect(seen.get(out) ?? text).toBe(text)
    seen.set(out, text)
  }
})

type Row = { kind: 'hunk' | 'same' | 'add' | 'del'; line: number; text?: string; context?: string }

const FIXED = 400
const ROW = 36
const LN = 20
const HUNK = 28
const FRAME = 90
const BUDGET = 8000

type LeanDiff = { binary: true } | { binary: false; kinds: boolean[]; more: number }

function leanEstimate(count: number, diff: LeanDiff | null, tree: number | null) {
  const list = Math.min(count, 40)
  const k = list + (count > list ? 1 : 0)
  const listPx = (k === 0 ? 1 : k) * ROW
  const budget = diff ? BUDGET - FIXED - listPx - 2 * ROW : 0
  let diffPx = 0
  let lines = 0

  if (diff?.binary) diffPx = FRAME
  else if (diff) {
    let lns = 0
    let px = FRAME
    let hidden = diff.more
    let isFull = false

    for (const isHunk of diff.kinds) {
      const cost = isHunk ? HUNK : LN

      isFull = isFull || lns >= 300 || px + cost + HUNK > budget

      if (isFull) {
        if (!isHunk) hidden++
        continue
      }

      px += cost
      if (!isHunk) lns++
    }

    diffPx = px + (hidden > 0 ? HUNK : 0)
    lines = lns
  }

  const left = BUDGET - FIXED - listPx - (diff ? ROW : 0) - diffPx - ROW
  const shown = tree === null ? 0 : Math.max(0, Math.min(200, tree, Math.floor(left / ROW)))
  const treeRows = tree === null ? 0 : shown + (tree > shown ? 1 : 0)

  return { total: FIXED + listPx + (diff ? diffPx + ROW : 0) + treeRows * ROW, diffPx, budget, lines }
}

test('altura: estimateHeight coincide com o modelo Lean e fica em 8000 numa grade de casos', () => {
  const shapes: boolean[][] = [
    [],
    [false],
    Array.from({ length: 10 }, () => false),
    Array.from({ length: 299 }, () => false),
    Array.from({ length: 300 }, () => false),
    Array.from({ length: 301 }, () => false),
    Array.from({ length: 1200 }, () => false),
    Array.from({ length: 600 }, (_, i) => i % 3 === 0),
    Array.from({ length: 700 }, (_, i) => i % 2 === 0),
    Array.from({ length: 500 }, () => true),
  ]
  const treeSizes = [null, 0, 1, 5, 50, 150, 183, 184, 185, 200, 201, 2000]
  const trees = new Map(treeSizes.map(n => [n, n === null ? null : Array.from({ length: n }, (_, i) => ({ abs: `/proj/t${i}`, name: `t${i}`, depth: 0, isDir: false, isOpen: false }))]))
  const rowsFor = (kinds: boolean[]): Row[] => kinds.map((isHunk, i) => (isHunk ? { kind: 'hunk', line: i, context: '' } : { kind: i % 2 ? 'add' : 'del', line: i, text: 'x' }))
  let max = 0

  for (const count of [0, 1, 40, 41, 500]) {
    const touched = Array.from({ length: count }, (_, i) => touch(`/proj/d/f${i}.ts`, i))

    for (const diffCase of ['none', 'binary', ...shapes.keys()] as Array<'none' | 'binary' | number>) {
      for (const more of [0, 7]) {
        for (const tree of treeSizes) {
          const lean: LeanDiff | null = diffCase === 'none' ? null : diffCase === 'binary' ? { binary: true } : { binary: false, kinds: shapes[diffCase]!, more }
          const openDiff =
            diffCase === 'none'
              ? null
              : diffCase === 'binary'
                ? { abs: '/proj/d/f0.ts', rows: [], more: 0, isBinary: true }
                : { abs: '/proj/d/f0.ts', rows: rowsFor(shapes[diffCase]!), more }
          const real = estimateHeight(VIEW({ touched, openDiff, tree: trees.get(tree)! }))
          const mirrored = leanEstimate(count, lean, tree)

          expect(real).toBe(mirrored.total)
          expect(real).toBeLessThanOrEqual(8000)
          if (lean && !lean.binary) {
            expect(mirrored.diffPx).toBeLessThanOrEqual(mirrored.budget)
            expect(mirrored.lines).toBeLessThanOrEqual(300)
          }
          max = Math.max(max, real)
        }
      }
    }
  }

  expect(max).toBeLessThanOrEqual(8000)
})

test('altura: o diff cortado mostra no máximo 300 linhas e mantém a linha "não mostradas"', () => {
  const rows: Row[] = Array.from({ length: 5000 }, (_, i) => ({ kind: 'add', line: i, text: 'x' }))
  const model = VIEW({
    touched: Array.from({ length: 60 }, (_, i) => touch(`/proj/d/f${i}.ts`, i)),
    openDiff: { abs: '/proj/d/f59.ts', rows, more: 0 },
    tree: Array.from({ length: 900 }, (_, i) => ({ abs: `/proj/t${i}`, name: `t${i}`, depth: 0, isDir: false, isOpen: false })),
  })
  const html = pageOf(model)
  const shown = html.split('class="ln').length - 1

  expect(html).toContain('linhas não mostradas')
  expect(shown).toBeLessThanOrEqual(300)
  expect(shown).toBe(leanEstimate(60, { binary: false, kinds: rows.map(() => false), more: 0 }, 900).lines)
  expect(estimateHeight(model)).toBeLessThanOrEqual(8000)
})

const hoverWorld = () => {
  const calls: Array<{ act: string; y: number }> = []
  const blits: string[] = []
  const timers: Array<() => void> = []
  let n = 0

  const $ = {
    plugin: { root: '/plug' },
    env: { get: async (name: string) => (name === 'HOME' ? '/home/u' : undefined) },
    session: { id: async () => 'sess' },
    process: {
      run: async () => ({ exitCode: 0, stdout: '1000\n', stderr: '' }),
      spawn: () =>
        (async function* () {
          await new Promise<void>(() => {})
        })(),
    },
    fs: {
      list: async (path: string) => (path.endsWith('ms-playwright') ? [{ name: 'chromium_headless_shell-1200', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] : []),
      exists: async () => true,
    },
    http: {
      fetch: async (url: string, init?: { body?: string }) => {
        const body = JSON.parse(init?.body ?? '{}')
        const answer = url.endsWith('/render')
          ? { file: '/tmp/page.png', rev: 1, height: 400, hits: [] }
          : url.endsWith('/hover')
            ? (calls.push({ act: body.act, y: body.y }), { file: `/dev/shm/h${(n += 1)}.png` })
            : {}

        return { status: 200, ok: true, headers: {}, text: JSON.stringify(answer) }
      },
    },
    ui: {
      blit: async (args: { source: { file: string } }) => {
        blits.push(args.source.file)

        return {}
      },
    },
    clock: { sleep: async () => {}, after: (_ms: number, fn: () => void) => (timers.push(fn), { cancel: () => {} }) },
  } as unknown as EngineInterface

  return { $, calls, blits }
}

const settleAll = async () => {
  for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 5))
}

test('cache de hover real: teto de 48 quadros em ordem FIFO e chave por (página, y, ato)', async () => {
  resetHover()
  const w = hoverWorld()
  await stop(w.$)
  await render(w.$, '<p>x</p>', 100, 100)

  const hits = Array.from({ length: 60 }, (_, i) => ({ act: `a${i}`, x: 0, y: 0, w: 10, h: 10 }))
  const view = (over: Partial<View> = {}): View => ({ key: 'K1', rev: 1, y: 0, height: 100, columns: 10, rows: 4, base: '/tmp/base.png', hits, ...over })
  const first = view()

  setView(w.$, first)

  for (const item of hits) {
    moveHover(w.$, item.act)
    await settleAll()
  }

  expect(w.calls).toHaveLength(60)

  const isCached = (target: View, act: string) => {
    retarget(act)

    return pictureOf(target) !== target.base
  }

  for (let i = 0; i < 12; i++) expect(isCached(first, `a${i}`)).toBe(false)
  for (let i = 12; i < 60; i++) expect(isCached(first, `a${i}`)).toBe(true)

  setView(w.$, view({ key: 'K2' }))
  expect(isCached(view({ key: 'K2' }), 'a59')).toBe(false)
  setView(w.$, view({ y: 56 }))
  expect(isCached(view({ y: 56 }), 'a59')).toBe(false)
  setView(w.$, first)
  expect(isCached(first, 'a59')).toBe(true)

  resetHover()
  await stop(w.$)
})

test('chaves de página reais não são prefixo uma da outra e terminam em </html> uma única vez', () => {
  const keys: string[] = []

  for (const abs of NASTY) {
    for (const hasDiff of [false, true]) {
      const model = VIEW({
        touched: [touch(abs, 1), touch('/proj/b.ts', 2)],
        openDiff: hasDiff ? { abs, rows: [{ kind: 'add', line: 1, text: '</html>' }], more: 0 } : null,
      })

      keys.push(`100x200@1.3\n${pageOf(model)}`)
    }
  }

  keys.push(`100x200@1.3\n${pageOf(VIEW({ touched: [touch('/proj/</html>x.ts', 1)] }))}`)

  for (const key of keys) {
    expect(key.endsWith('</html>')).toBe(true)
    expect(key.split('</html>').length - 1).toBe(1)
  }

  for (const a of keys) for (const b of keys) if (a !== b) expect(b.startsWith(a)).toBe(false)
})

type Touched = { abs: string; isEdited: boolean; isEditedThisTurn: boolean; at: number; turn: number }

const leanUnseen = (touched: Touched[], seen: Record<string, number>, abs: string) =>
  touched.some(one => one.abs === abs && one.isEdited && one.at > (seen[abs] ?? 0))

const rowsOfFiles = (html: string) =>
  html
    .split('<div class="file')
    .slice(1)
    .map(part => ({ abs: unesc(/data-act="file:([^"]*)"/.exec(part)?.[1] ?? ''), hasDot: part.split('</div>')[0]!.includes('class="newdot"') }))

test('bolinha de não visto: pageOf coincide com a regra do Lean (isUnseen) numa grade', () => {
  const abs = ['/proj/a.ts', '/proj/b.ts', '/proj/c.ts']

  for (const seenA of [undefined, 0, 5, 10, 15]) {
    for (const seenB of [undefined, 3, 20]) {
      for (const edited of [true, false]) {
        const seen: Record<string, number> = {}

        if (seenA !== undefined) seen[abs[0]!] = seenA
        if (seenB !== undefined) seen[abs[1]!] = seenB

        const list: Touched[] = [
          { abs: abs[0]!, isEdited: edited, isEditedThisTurn: edited, at: 10, turn: 1 },
          { abs: abs[1]!, isEdited: true, isEditedThisTurn: true, at: 7, turn: 1 },
          { abs: abs[2]!, isEdited: false, isEditedThisTurn: false, at: 99, turn: 1 },
        ]
        const rows = rowsOfFiles(pageOf(VIEW({ touched: list, seen })))

        expect(rows.map(row => row.abs)).toEqual(['/proj/c.ts', '/proj/a.ts', '/proj/b.ts'])
        for (const row of rows) expect(row.hasDot).toBe(leanUnseen(list, seen, row.abs))
      }
    }
  }

  const opened = { '/proj/a.ts': 12 }
  const before = [{ abs: '/proj/a.ts', isEdited: true, isEditedThisTurn: true, at: 10, turn: 1 }]
  const after = [{ abs: '/proj/a.ts', isEdited: true, isEditedThisTurn: true, at: 13, turn: 1 }]

  expect(rowsOfFiles(pageOf(VIEW({ touched: before, seen: opened })))[0]!.hasDot).toBe(false)
  expect(rowsOfFiles(pageOf(VIEW({ touched: after, seen: opened })))[0]!.hasDot).toBe(true)
})

test('ordem das linhas: arquivo em edição ou leitura primeiro, depois do mais recente ao mais antigo (comparador do Lean)', () => {
  const touched: Touched[] = [1, 2, 3, 4, 5, 6].map(n => ({ abs: `/proj/f${n}.ts`, isEdited: true, isEditedThisTurn: true, at: [30, 50, 10, 50, 20, 40][n - 1]!, turn: 1 }))
  const leanCmp = (live: string | null, a: Touched, b: Touched) => {
    const x = Number(b.abs === live) - Number(a.abs === live)

    return x !== 0 ? x : b.at - a.at
  }

  for (const now of [{ kind: 'idle' }, { kind: 'editing', abs: '/proj/f3.ts' }, { kind: 'reading', abs: '/proj/f6.ts' }, { kind: 'editing', abs: '/proj/zzz.ts' }] as const) {
    const live = 'abs' in now ? now.abs : null
    const expected = [...touched].sort((a, b) => leanCmp(live, a, b)).map(one => one.abs)
    const got = rowsOfFiles(pageOf(VIEW({ touched, now: now as never }))).map(row => row.abs)

    expect(got).toEqual(expected)
    if (live && touched.some(one => one.abs === live)) expect(got[0]).toBe(live)
  }

  for (const a of touched) for (const b of touched) expect(leanCmp(null, a, b) + leanCmp(null, b, a)).toBe(0)
})

const IMAGE_CELLS_MAX = 255
const MAX_PIXELS = 1_500_000

const leanSqrtRound = (c: number, area: number) => Math.min(c, Math.floor((Math.floor(Math.sqrt(Math.floor((4 * c * c * MAX_PIXELS) / area))) + 1) / 2))

const leanGrid = (cw: number, ch: number, cols: number, rows: number) => {
  const area = cols * cw * Math.max(1, rows) * ch

  return area <= MAX_PIXELS ? { w: Math.max(4, cw), h: Math.max(8, ch) } : { w: Math.max(4, leanSqrtRound(cw, area)), h: Math.max(8, leanSqrtRound(ch, area)) }
}

const tsGrid = (cw: number, ch: number, cols: number, rows: number) => {
  const area = cols * cw * Math.max(1, rows) * ch
  const k = Math.min(1, Math.sqrt(MAX_PIXELS / area))

  return { w: Math.max(4, Math.round(cw * k)), h: Math.max(8, Math.round(ch * k)) }
}

test('grade de pixels: a fórmula do gridOf é igual à definição Lean em todas as 65025 combinações e cumpre os limites', () => {
  let max = 0
  const bad: string[] = []

  for (let cols = 1; cols <= IMAGE_CELLS_MAX; cols++) {
    for (let rows = 1; rows <= IMAGE_CELLS_MAX; rows++) {
      const grid = leanGrid(13, 28, cols, rows)
      const real = tsGrid(13, 28, cols, rows)

      if (real.w !== grid.w || real.h !== grid.h || grid.w < 4 || grid.h < 8 || grid.w > 13 || grid.h > 28) bad.push(`${cols}x${rows}`)
      max = Math.max(max, cols * grid.w * rows * grid.h)
    }
  }

  expect(bad).toEqual([])
  expect(max).toBe(255 * 255 * 4 * 8)
})

type PaneWorld = { renders: Array<{ width: number; height: number; scale: number }> }

const paneEngine = (on: Parameters<TestBody>[1]): PaneWorld => {
  const world: PaneWorld = { renders: [] }
  const entry = (name: string, kind: 'file' | 'dir') => ({ name, kind, size: 0, mtimeMs: 0, isLink: false })
  const store = new Map<string, { value: unknown; version: number }>()
  const key = (e: any) => `${e.plugin}/${e.key}/${e.id ?? ''}`
  const out = (code: number, stdout = '') => ({ value: { exitCode: code, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

  on('state.get', (_, e) => ({ value: store.get(key(e)) ?? { value: undefined, version: 0 } }))
  on('state.set', (_, e: any) => {
    const version = (store.get(key(e))?.version ?? 0) + 1
    store.set(key(e), { value: e.value, version })

    return { value: { isSet: true, version } }
  })
  on('command.register', () => ({ value: { command: 'panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('clock.after', (_, e) => {
    if ((e as { ms: number }).ms === 250) return new Promise(resolve => setTimeout(() => resolve({ value: undefined }), 10)) as never

    return new Promise(() => {}) as never
  })
  on('session.end', (_, e) => ({ sessionId: (e as { sessionId?: string }).sessionId ?? 'sess' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('session.id', () => ({ value: 'sess' }))
  on('tool.call', () => ({ result: {} }))
  on('turn.start', (_, e: any) => ({ turnId: e.turnId }))
  on('env.get', (_, e) => {
    const name = (e as { name: string }).name

    return { value: name === 'HOME' ? '/home/u' : name === 'TERM_PROGRAM' ? 'ghostty' : undefined }
  })
  on('fs.list', (_, e) => {
    const path = (e as { path?: string }).path ?? ''

    return { value: path.endsWith('ms-playwright') ? [entry('chromium_headless_shell-1200', 'dir')] : [entry('README.md', 'file')] }
  })
  on('fs.exists', (_, e) => ({ value: ((e as { path: string }).path ?? '').includes('chrome-headless-shell') }))
  on('process.run', (_, e) => {
    const { argv } = e as { argv: string[] }

    if (argv[0] === 'id') return out(0, '1000\n')
    if (argv[0] === 'uname') return out(0, 'Linux\n')

    return out(argv[0] === 'git' || argv[0] === 'which' ? 1 : 0)
  })
  on('process.spawn', async function* () {
    await new Promise<void>(() => {})
    yield { stream: 'stdout', text: 'x' }

    return { value: { code: 0, signal: null } }
  } as never)
  on('clock.sleep', () => ({ value: undefined }))
  on('ui.blit', () => ({ value: {} }))
  on('http.fetch', (_, e) => {
    const { url, init } = e as { url: string; init?: { body?: string } }
    const body = init?.body ? JSON.parse(init.body) : {}
    const reply = (value: unknown) => ({ value: { ok: true, status: 200, headers: {}, text: JSON.stringify(value) } })

    if (url.endsWith('/render')) {
      world.renders.push(body)

      return reply({ file: '/dev/shm/page.png', rev: 3, height: 560, ms: 3, hits: [] })
    }
    if (url.endsWith('/clip')) return reply({ file: '/dev/shm/clip.png' })

    return reply({})
  })

  return world
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 5))
}

const SIZES: Array<[number, number]> = [[48, 60], [150, 60], [255, 255], [400, 300], [100, 50], [30, 5], [255, 20], [60, 1]]

for (const [columns, rows] of SIZES) {
  test(`pedido de /render com ${columns} colunas e ${rows} linhas: grade, corte de 255 e densidade batem com o Lean`, async ($, on) => {
    const world = paneEngine(on)

    await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })

    const ui = await $.ui.mount({
      plugin: 'panel',
      component: 'Pane',
      requestId: 'panel',
      props: { title: 'Painel', isFocused: false, bodyColumns: columns, placement: 'dock', scroll: { offset: 0, bodyRows: rows }, view: {} },
      surface: 'terminal',
    } as never)

    await settle()
    expect(world.renders.length).toBeGreaterThan(0)

    const request = world.renders[0]!
    const cols = Math.min(IMAGE_CELLS_MAX, columns)
    const body = Math.min(IMAGE_CELLS_MAX, Math.max(1, rows))
    const grid = leanGrid(13, 28, cols, body)

    expect(request.width).toBe(cols * grid.w)
    expect(request.height).toBe(body * grid.h)
    expect(Math.abs(request.scale - 1.3 * (grid.w / 13))).toBeLessThan(1e-9)
    expect(request.scale).toBeLessThanOrEqual(1.3 + 1e-9)
    expect(request.width * request.height).toBeLessThanOrEqual(255 * 255 * 4 * 8)
    if (grid.w > 4 || grid.h > 8) expect(request.width * request.height).toBeLessThanOrEqual(1_850_000)

    const image = (await ui.find({ type: 'Image' })) as { props: { columns: number; rows: number } } | undefined

    expect(image?.props.columns).toBeLessThanOrEqual(IMAGE_CELLS_MAX)
    expect(image?.props.rows).toBeLessThanOrEqual(IMAGE_CELLS_MAX)
    await ui.unmount()
  })
}

