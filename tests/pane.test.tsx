import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { closePane, renderPane } from '../hooks/pane'

const PANE = {
  plugin: 'panel',
  component: 'Pane',
  requestId: 'panel',
  props: { title: 'Painel', isFocused: false, bodyColumns: 48, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

const GHOSTTY = { TERM_PROGRAM: 'ghostty' }

const entry = (name: string, kind: 'file' | 'dir') => ({ name, kind, size: 0, mtimeMs: 0, isLink: false })

type World = {
  idles: Array<() => void>
  dies: Array<() => void>
  clips: Array<{ y: number; height: number }>
  ran: string[][]
  renders: Array<{ width: number; height: number; html: string }>
  quits: number
  quitBodies: Array<{ keepLast?: boolean }>
  removed: string[][]
  toasts: string[]
  spawns: number
  hovers: Array<{ act: string; rev: number; y: number; height: number }>
  blits: Array<{ file: string; columns: number; rows: number }>
}

type Options = { supersede?: number; holdFirst?: boolean; hold?: Array<() => void>; hasChrome?: boolean; clipFails?: boolean; failRendersFrom?: number; frameHeight?: number; hits?: unknown[] }

const engine = (on: Parameters<TestBody>[1], env: Record<string, string>, options: Options = {}): World => {
  const world: World = { idles: [], dies: [], clips: [], ran: [], renders: [], quits: 0, quitBodies: [], removed: [], toasts: [], spawns: 0, hovers: [], blits: [] }
  const hasChrome = options.hasChrome ?? true
  const store = new Map<string, { value: unknown; version: number }>()
  const key = (e: any) => `${e.plugin}/${e.key}/${e.id ?? ''}`

  on('state.get', (_, e) => ({ value: store.get(key(e)) ?? { value: undefined, version: 0 } }))
  on('state.set', (_, e: any) => {
    const version = (store.get(key(e))?.version ?? 0) + 1
    store.set(key(e), { value: e.value, version })

    return { value: { isSet: true, version } }
  })
  on('command.register', () => ({ value: { command: 'panel' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', (_, e) => {
    world.toasts.push((e as { text: string }).text)

    return { value: undefined }
  })
  on('clock.after', (_, e) => {
    if ((e as { ms: number }).ms === 250) return new Promise(resolve => setTimeout(() => resolve({ value: undefined }), 10)) as never
    if ((e as { ms: number }).ms !== 120_000) return new Promise(() => {}) as never

    return new Promise(resolve => world.idles.push(() => resolve({ value: undefined }))) as never
  })
  on('session.end', (_, e) => ({ sessionId: (e as { sessionId?: string }).sessionId ?? 'sess' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('session.id', () => ({ value: 'sess' }))
  on('tool.call', () => ({ result: {} }))
  on('turn.start', (_, e: any) => ({ turnId: e.turnId }))
  on('env.get', (_, e) => {
    const name = (e as { name: string }).name

    return { value: name === 'HOME' ? '/home/u' : env[name] }
  })
  on('fs.list', (_, e) => {
    const path = (e as { path?: string }).path ?? ''

    if (path.endsWith('ms-playwright')) return { value: hasChrome ? [entry('chromium_headless_shell-1200', 'dir')] : [] }

    return { value: [entry('README.md', 'file'), entry('src', 'dir')] }
  })
  on('fs.exists', (_, e) => ({ value: hasChrome && ((e as { path: string }).path ?? '').includes('chrome-headless-shell') }))
  on('process.run', (_, e) => {
    const { argv } = e as { argv: string[] }
    world.ran.push(argv)
    const out = (code: number, stdout = '') => ({ value: { exitCode: code, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

    if (argv[0] === 'id') return out(0, '1000\n')
    if (argv[0] === 'rm') world.removed.push(argv.slice(2))
    if (argv[0] === 'uname') return out(0, 'Linux\n')
    if (argv[0] === 'git' && argv.includes('--show-toplevel')) return out(0, '/proj\n')
    if (argv[0] === 'git' && argv.includes('ls-files')) return out(0, '/proj/a.ts\n')
    if (argv[0] === 'git' && argv.includes('diff') && !argv.includes('--numstat')) return out(0, '@@ -1 +1 @@\n-velho\n+novo\n')

    return out(argv[0] === 'git' || argv[0] === 'which' ? 1 : 0)
  })
  on('process.spawn', async function* () {
    world.spawns += 1
    await new Promise<void>(resolve => world.dies.push(resolve))
    yield { stream: 'stdout', text: 'x' }

    return { value: { code: 0, signal: null } }
  } as never)
  on('clock.sleep', () => ({ value: undefined }))
  on('ui.blit', (_, e) => {
    const { source, columns, rows } = e as { source: { file: string }; columns: number; rows: number }
    world.blits.push({ file: source.file, columns, rows })

    return { value: {} }
  })
  on('http.fetch', (_, e) => {
    const { url, init } = e as { url: string; init?: { body?: string } }
    const body = init?.body ? JSON.parse(init.body) : {}
    const reply = (value: unknown) => ({ value: { ok: true, status: 200, headers: {}, text: JSON.stringify(value) } })

    if (url.endsWith('/render')) {
      world.renders.push(body)

      if (options.supersede && world.renders.length > 1 && world.renders.length <= 1 + options.supersede) {
        throw new Error('ui.render: superseded')
      }

      if (options.hold && (options.holdFirst || world.renders.length > 1)) {
        return new Promise(resolve => {
          options.hold!.push(() =>
            resolve(reply({ file: '/dev/shm/page.png', height: 560, ms: 3, hits: [] }) as never),
          )
        }) as never
      }

      if (options.failRendersFrom && world.renders.length >= options.failRendersFrom) return { value: { ok: false, status: 500, headers: {}, text: '{}' } }

      return reply({
        file: '/dev/shm/page.png',
        rev: 2 + world.renders.length,
        height: options.frameHeight ?? 560,
        ms: 3,
        hits: options.hits ?? [{ act: 'file:/proj/a.ts', x: 120, y: 80, w: 100, h: 20 }],
      })
    }
    if (url.endsWith('/hover')) {
      world.hovers.push(body)

      return reply({ file: `/dev/shm/hover-${world.hovers.length}.png` })
    }
    if (url.endsWith('/clip')) {
      world.clips.push(body)

      if (options.clipFails) return { value: { ok: false, status: 500, headers: {}, text: '{}' } }

      return reply({ file: `/dev/shm/clip-${world.clips.length}.png` })
    }
    if (url.endsWith('/quit')) {
      world.quits += 1
      world.quitBodies.push(body)

      return reply({ kept: body.keepLast ? ['/dev/shm/page.png'] : [] })
    }

    return reply({})
  })

  return world
}

const draw = async () => {
  for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 5))
}

const SETTLED_MS = 170

const resized = async (ui: { redraw: (props?: never) => Promise<void> }, props: object) => {
  await ui.redraw(props as never)
  await new Promise(resolve => setTimeout(resolve, SETTLED_MS))
  await ui.redraw(props as never)
  await draw()
}

const start = ($: any) => $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })

test('página mais alta que o painel mostra só a janela, sem barra de botões em cima', async ($, on) => {
  const world = engine(on, GHOSTTY)
  await start($)
  const props = { ...PANE.props, scroll: { offset: 0, bodyRows: 12 } }
  const ui = await $.ui.mount({ ...PANE, props, surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: /linhas/ })).toBeUndefined()
  expect(await ui.find({ type: 'Button' })).toBeUndefined()
  expect(world.clips).toEqual([{ y: 0, height: 336 }])
  expect(world.renders.length).toBe(1)
  await ui.unmount()
})

test('no Ghostty o painel é só a imagem com o overlay, sem busca', async ($, on) => {
  engine(on, GHOSTTY)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  const image = (await ui.find({ type: 'Image' })) as { props: { source: { file: string }; columns: number; rows: number } } | undefined
  const client = (await ui.find({ type: 'Client' })) as { props: { module: string } } | undefined

  expect(await ui.find({ type: 'Input' })).toBeUndefined()
  expect(image?.props.source.file).toBe('/dev/shm/page.png')
  expect(image?.props.columns).toBe(48)
  expect(image?.props.rows).toBe(20)
  expect(client?.props.module).toMatch(/overlay\.tsx$/)
  await ui.unmount()
})

test('fora do Ghostty o painel é uma linha só e nada é desenhado', async ($, on) => {
  const world = engine(on, {})
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /O painel precisa do Ghostty ou do kitty/ })).toBeDefined()
  expect(world.renders.length).toBe(0)
  await ui.unmount()
})

test('no tmux ou em sessão bg sem a variável de imagens, a linha aparece', async ($, on) => {
  engine(on, { ...GHOSTTY, CLAUDE_CODE_SESSION_KIND: 'bg' })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: /precisa do Ghostty/ })).toBeDefined()
  await ui.unmount()
})

test('sessão bg com CLAUDE_CODE_FORCE_TERMINAL_IMAGES desenha', async ($, on) => {
  engine(on, { ...GHOSTTY, CLAUDE_CODE_SESSION_KIND: 'bg', CLAUDE_CODE_FORCE_TERMINAL_IMAGES: '1' })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Image' })).toBeDefined()
  await ui.unmount()
})

test('página de altura 0 não divide por zero: nada de imagem', async ($, on) => {
  engine(on, GHOSTTY, { frameHeight: 0 })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Text' })).toBeDefined()
  await ui.unmount()
})

test('sem chrome, um aviso só e nada de imagem', async ($, on) => {
  const world = engine(on, GHOSTTY, { hasChrome: false })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  for (let i = 0; i < 3; i++) {
    await ui.redraw()
    await draw()
    expect(await ui.find({ type: 'Image' })).toBeUndefined()
  }

  expect(world.toasts).toEqual(['Painel indisponível: Chromium não encontrado'])
  await ui.unmount()
})

test('mesma página não é redesenhada', async ($, on) => {
  const world = engine(on, GHOSTTY)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await ui.redraw()
  await draw()
  await ui.redraw()

  expect(world.renders.length).toBe(1)
  await ui.unmount()
})

test('largura nova redesenha', async ($, on) => {
  const world = engine(on, GHOSTTY)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await resized(ui, { ...PANE.props, bodyColumns: 60 })

  expect(world.renders.map(one => one.width)).toEqual([624, 780])
  await ui.unmount()
})

test('Edit de arquivo -> desenho com o arquivo -> clique na linha pede o diff', async ($, on) => {
  const world = engine(on, GHOSTTY)
  await start($)
  await $.turn.start({ turnId: 't1' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/proj/a.ts', old_string: 'velho', new_string: 'novo' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(world.renders.at(-1)?.html).toContain('a.ts')

  await ui.post({ x: 10, y: 3 })
  await draw()

  expect(world.ran.some(argv => argv[0] === 'git' && argv.includes('diff') && argv.includes('/proj/a.ts'))).toBe(true)
  await ui.redraw()
  await draw()
  expect(world.renders.at(-1)?.html).toContain('novo')
  await ui.unmount()
})

test('encerrar a sessão desliga o navegador', async ($, on) => {
  const world = engine(on, GHOSTTY)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await draw()
  await $.session.end({ reason: 'other' } as never)

  expect(world.quits).toBe(1)
  await ui.unmount()
})

test('clip que falha não é guardado: mostra o topo da página sem barra', async ($, on) => {
  const world = engine(on, GHOSTTY, { clipFails: true })
  await start($)
  const props = { ...PANE.props, scroll: { offset: 0, bodyRows: 12 } }
  const ui = await $.ui.mount({ ...PANE, props, surface: 'terminal' })

  const image = (await ui.find({ type: 'Image' })) as { props: { source: { file: string }; rows: number } } | undefined

  expect(image?.props.source.file).toBe('/dev/shm/page.png')
  expect(image?.props.rows).toBe(12)
  expect(await ui.find({ type: 'Text', text: /linhas/ })).toBeUndefined()

  const before = world.clips.length
  await ui.redraw()
  await ui.redraw()

  expect(world.clips.length).toBe(before)
  await ui.unmount()
})

test('parada por ociosidade mantém o quadro: sem redesenho, sem novo servidor', async ($, on) => {
  const world = engine(on, GHOSTTY)
  await start($)
  const props = { ...PANE.props, scroll: { offset: 0, bodyRows: 12 } }
  const ui = await $.ui.mount({ ...PANE, props, surface: 'terminal' })

  expect(world.renders.length).toBe(1)

  world.idles.at(-1)?.()
  await draw()
  await ui.redraw()

  expect(world.quitBodies).toEqual([{ keepLast: true }])
  expect(world.renders.length).toBe(1)
  expect(world.spawns).toBe(1)
  expect(world.removed).toEqual([])
  expect(await ui.find({ type: 'Image' })).toBeDefined()
  await ui.unmount()
})

test('depois da parada por ociosidade, só uma mudança real sobe o servidor de novo e apaga o quadro velho', async ($, on) => {
  const world = engine(on, GHOSTTY)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  world.idles.at(-1)?.()
  await draw()
  await resized(ui, { ...PANE.props, bodyColumns: 60 })

  expect(world.spawns).toBe(2)
  expect(world.renders.length).toBe(2)
  expect(world.removed).toEqual([['/dev/shm/page.png']])
  await ui.unmount()
})

test('encerrar a sessão depois da ociosidade apaga o que ficou', async ($, on) => {
  const world = engine(on, GHOSTTY)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  world.idles.at(-1)?.()
  await draw()
  expect(world.removed).toEqual([])
  await $.session.end({ reason: 'other' } as never)

  expect(world.removed).toEqual([['/dev/shm/page.png']])
  await ui.unmount()
})

test('fechar e reabrir o painel sem Chrome não repete o aviso', async () => {
  const toasts: string[] = []
  const state = new Map<string, { value: unknown; version: number }>()
  const leaf = (props: { children?: unknown }) => props.children
  const $ = {
    env: { get: async (name: string) => (name === 'TERM_PROGRAM' ? 'ghostty' : undefined) },
    session: { cwd: async () => '/proj', id: async () => 'sess' },
    state: {
      get: async (ref: { key: string }) => state.get(ref.key) ?? { value: undefined, version: 0 },
      set: async (ref: { key: string }, value: unknown) => {
        state.set(ref.key, { value, version: 1 })

        return { isSet: true, version: 1 }
      },
    },
    fs: { list: async () => [], exists: async () => false },
    process: { run: async () => ({ exitCode: 1, stdout: '', stderr: '' }) },
    clock: { after: () => ({ cancel: () => {} }), sleep: async () => {} },
    ui: {
      resolve: () => ({ Box: leaf, Text: leaf, Button: leaf, Image: leaf, Client: leaf }),
      toast: (text: string) => void toasts.push(text),
      invalidate: () => {},
    },
  } as any
  const e = { surface: 'terminal', props: PANE.props } as any

  await renderPane($, e)
  await new Promise(resolve => setTimeout(resolve, 20))
  await closePane($)
  await renderPane($, e)
  await new Promise(resolve => setTimeout(resolve, 20))

  expect(toasts).toEqual(['Painel indisponível: Chromium não encontrado'])
})

test('servidor que morre logo ao subir: avisa uma vez e não entra em laço', async ($, on) => {
  const world = engine(on, GHOSTTY)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  world.dies[0]?.()
  await draw()
  await ui.redraw()
  await ui.redraw()

  expect(world.spawns).toBe(1)
  expect(world.renders.length).toBe(1)
  expect(world.toasts).toHaveLength(1)
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  await ui.unmount()
})

test('largura 0 no meio do redimensionamento não desenha nem conta como falha', async ($, on) => {
  const world = engine(on, GHOSTTY)
  await start($)
  const ui = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 0 }, surface: 'terminal' })

  await draw()

  expect(world.renders.length).toBe(0)
  expect(world.toasts).toEqual([])
  expect(await ui.find({ type: 'Image' })).toBeUndefined()

  await ui.redraw({ ...PANE.props, bodyColumns: 48 } as never)
  await draw()

  expect(world.renders.length).toBe(1)
  expect(await ui.find({ type: 'Image' })).toBeDefined()
  await ui.unmount()
})

test('desenho que falha depois de um quadro bom mantém a imagem em vez de "indisponível"', async ($, on) => {
  const world = engine(on, GHOSTTY, { failRendersFrom: 2 })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await resized(ui, { ...PANE.props, bodyColumns: 60 })
  await ui.redraw({ ...PANE.props, bodyColumns: 60 } as never)

  expect(world.renders.length).toBe(2)
  expect(await ui.find({ type: 'Image' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /indisponível/ })).toBeUndefined()
  await ui.unmount()
})

test('desenho antigo superado por outro de mesmo tamanho não vira falha', async ($, on) => {
  const hold: Array<() => void> = []
  const world = engine(on, GHOSTTY, { hold })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  for (const columns of [60, 70, 60]) await resized(ui, { ...PANE.props, bodyColumns: columns })

  expect(world.renders.length).toBe(4)
  for (const release of hold) release()
  await draw()
  await ui.redraw({ ...PANE.props, bodyColumns: 60 } as never)

  expect(world.toasts).toEqual([])
  expect(await ui.find({ type: 'Image' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /indisponível/ })).toBeUndefined()
  await ui.unmount()
})

test('pedido de rede derrubado por um redesenho novo é refeito sem aviso nem espera', async ($, on) => {
  const world = engine(on, GHOSTTY, { supersede: 1 })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await resized(ui, { ...PANE.props, bodyColumns: 60 })
  await resized(ui, { ...PANE.props, bodyColumns: 60 })

  expect(world.renders.length).toBe(3)
  expect(world.toasts).toEqual([])
  expect(await ui.find({ type: 'Image' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /indisponível/ })).toBeUndefined()
  await ui.unmount()
})

test('passar o mouse troca a imagem pelo quadro destacado sem redesenhar a página, e sair volta ao normal', async ($, on) => {
  const world = engine(on, GHOSTTY, { hits: [{ act: 'tree', x: 120, y: 80, w: 100, h: 20 }] })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await ui.post({ hover: true, x: 10, y: 3 })
  await draw()

  expect(world.hovers).toEqual([{ act: 'tree', rev: 3, y: 0, height: 560 }])
  expect(world.blits).toEqual([{ file: '/dev/shm/hover-1.png', columns: 48, rows: 20 }])
  expect(world.renders.length).toBe(1)

  await ui.post({ hover: true, x: 10.4, y: 3.2 })
  await draw()
  expect(world.blits.length).toBe(1)

  await ui.post({ leave: true })
  await draw()
  expect(world.blits.at(-1)).toEqual({ file: '/dev/shm/page.png', columns: 48, rows: 20 })

  await ui.post({ hover: true, x: 10, y: 3 })
  await draw()
  expect(world.hovers.length).toBe(1)
  expect(world.blits.at(-1)?.file).toBe('/dev/shm/hover-1.png')
  expect(world.renders.length).toBe(1)
  await ui.unmount()
})

test('a página redesenhada com o mouse parado reaproveita o destaque guardado', async ($, on) => {
  const world = engine(on, GHOSTTY, { hits: [{ act: 'tree', x: 120, y: 80, w: 100, h: 20 }] })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await ui.post({ hover: true, x: 10, y: 3 })
  await draw()
  await ui.redraw()
  await draw()

  const image = (await ui.find({ type: 'Image' })) as { props: { source: { file: string } } } | undefined

  expect(image?.props.source.file).toBe('/dev/shm/hover-1.png')
  expect(world.hovers.length).toBe(1)
  await ui.unmount()
})

test('os destaques dos itens visíveis são gerados em segundo plano e depois o hover não pede nada ao servidor', async ($, on) => {
  const hits = [
    { act: 'a', x: 0, y: 0, w: 100, h: 20 },
    { act: 'b', x: 0, y: 40, w: 100, h: 20 },
    { act: 'fora', x: 0, y: 9000, w: 100, h: 20 },
  ]
  const world = engine(on, GHOSTTY, { hits })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await draw()
  await draw()

  expect(world.hovers.map(one => one.act)).toEqual(['a', 'b'])
  await ui.unmount()
})

test('sem posição em pixels, o hover usa a célula inteira e acha o botão baixo que o centro dela não alcança', async ($, on) => {
  const world = engine(on, GHOSTTY, { hits: [{ act: 'tree', x: 120, y: 100, w: 100, h: 20 }] })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await ui.post({ hover: true, x: 10.5, y: 3.5 })
  await draw()
  expect(world.blits).toEqual([])

  await ui.post({ hover: true, x: 10.5, y: 3.5, isCell: true })
  await draw()
  expect(world.blits.map(one => one.file)).toEqual(['/dev/shm/hover-1.png'])
  await ui.unmount()
})

const imageOf = async (ui: { find: (query: object) => Promise<unknown> }) =>
  (await ui.find({ type: 'Image' })) as { props: { source: { file: string }; columns: number; rows: number } } | undefined

test('painel enorme: colunas e linhas passam do limite de 255 do Claude Code e são cortadas', async ($, on) => {
  const world = engine(on, GHOSTTY)
  await start($)
  const props = { ...PANE.props, bodyColumns: 400, scroll: { offset: 0, bodyRows: 300 } }
  const ui = await $.ui.mount({ ...PANE, props, surface: 'terminal' })

  await draw()
  await ui.redraw()
  const image = await imageOf(ui)

  expect(image?.props.columns).toBeLessThanOrEqual(255)
  expect(image?.props.rows).toBeLessThanOrEqual(255)
  expect(world.renders.length).toBeGreaterThan(0)
  await ui.unmount()
})

test('painel grande reduz a densidade de pixels para a imagem não passar de 1,6 milhão', async ($, on) => {
  const world = engine(on, GHOSTTY)
  await start($)
  const props = { ...PANE.props, bodyColumns: 150, scroll: { offset: 0, bodyRows: 60 } }
  const ui = await $.ui.mount({ ...PANE, props, surface: 'terminal' })

  await draw()
  const first = world.renders[0] as { width: number; height: number; scale: number }

  expect(first.width * first.height).toBeLessThanOrEqual(1_600_000)
  expect(first.width).toBeGreaterThanOrEqual(150 * 4)
  expect(first.scale).toBeLessThan(1.3)
  await ui.unmount()
})

test('painel de tamanho comum mantém a densidade cheia', async ($, on) => {
  const world = engine(on, GHOSTTY)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await draw()

  expect(world.renders[0]).toMatchObject({ width: 48 * 13, height: 60 * 28, scale: 1.3 })
  await ui.unmount()
})

test('rajada de redimensionamentos desenha uma vez só, no tamanho final, depois da calma', async ($, on) => {
  const world = engine(on, GHOSTTY)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await draw()
  expect(world.renders.length).toBe(1)

  for (const columns of [52, 58, 66, 74, 90, 110]) await ui.redraw({ ...PANE.props, bodyColumns: columns } as never)

  expect(world.renders.length).toBe(1)
  expect((await imageOf(ui))?.props.columns).toBe(48)
  expect((await imageOf(ui) as { key?: string } | undefined)?.key).toBe('page-48x60')

  await new Promise(resolve => setTimeout(resolve, SETTLED_MS))
  await ui.redraw({ ...PANE.props, bodyColumns: 110 } as never)
  await draw()

  expect(world.renders.length).toBe(2)
  const last = world.renders[1] as { width: number; height: number }

  expect(last.width % 110).toBe(0)
  expect(last.width * last.height).toBeLessThanOrEqual(1_600_000)
  expect((await imageOf(ui))?.props.columns).toBe(110)
  expect(((await ui.find({ type: 'Image' })) as { key?: string } | undefined)?.key).toMatch(/^page-110x\d+$/)
  await ui.unmount()
})

test('a largada a frio devolve "Desenhando…" na hora, sem esperar o desenho acabar', async ($, on) => {
  const hold: Array<() => void> = []
  const world = engine(on, GHOSTTY, { hold, holdFirst: true })
  await start($)
  const mounted = await Promise.race([
    $.ui.mount({ ...PANE, surface: 'terminal' }).then(ui => ({ ui })),
    new Promise<null>(resolve => setTimeout(() => resolve(null), 800)),
  ])

  expect(mounted).not.toBeNull()
  const ui = mounted!.ui

  expect(await ui.find({ type: 'Text', text: /Desenhando/ })).toBeDefined()
  expect(await imageOf(ui)).toBeUndefined()

  for (const release of hold) release()
  await draw()
  await ui.redraw()

  expect(world.toasts).toEqual([])
  expect(await imageOf(ui)).toBeDefined()
  await ui.unmount()
})

const random = (seed: number) => {
  let state = seed

  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296

    return state / 4294967296
  }
}

const walk = async (seed: number, steps: number, extra: Options, $: any, on: Parameters<TestBody>[1]) => {
  const world = engine(on, GHOSTTY, { hits: [{ act: 'tree', x: 120, y: 80, w: 100, h: 20 }, { act: 'file:/proj/a.ts', x: 40, y: 200, w: 300, h: 30 }], ...extra })
  await start($)
  const next = random(seed)
  const pick = (low: number, high: number) => low + Math.floor(next() * (high - low + 1))
  let props = { ...PANE.props } as typeof PANE.props & { bodyColumns: number }
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  const bounded = async () => {
    const image = await imageOf(ui)
    if (!image) return

    expect(image.props.columns).toBeGreaterThanOrEqual(1)
    expect(image.props.columns).toBeLessThanOrEqual(255)
    expect(image.props.rows).toBeGreaterThanOrEqual(1)
    expect(image.props.rows).toBeLessThanOrEqual(255)
  }

  for (let step = 0; step < steps; step += 1) {
    const roll = next()
    const columns = pick(8, 300)
    const rows = pick(3, 90)

    if (roll < 0.2) {
      props = { ...props, bodyColumns: columns, scroll: { offset: 0, bodyRows: rows } } as never
      await ui.redraw(props as never)
    } else if (roll < 0.3) {
      for (let burst = 0; burst < 5; burst += 1) {
        props = { ...props, bodyColumns: pick(8, 300), scroll: { offset: 0, bodyRows: pick(3, 90) } } as never
        await ui.redraw(props as never)
      }
    } else if (roll < 0.4) {
      await new Promise(resolve => setTimeout(resolve, SETTLED_MS))
      await ui.redraw(props as never)
      await draw()
    } else if (roll < 0.6) {
      await ui.post({ hover: true, x: next() * props.bodyColumns, y: next() * 20, ...(next() < 0.5 ? { isCell: true } : {}) })
    } else if (roll < 0.68) {
      await ui.post({ leave: true })
    } else if (roll < 0.78) {
      await ui.post({ x: next() * props.bodyColumns, y: next() * 20 })
    } else if (roll < 0.84) {
      world.idles.at(-1)?.()
      await draw()
    } else {
      await ui.redraw(props as never)
    }

    await bounded()
  }

  await new Promise(resolve => setTimeout(resolve, SETTLED_MS))
  await ui.redraw(props as never)
  await draw()
  await ui.redraw(props as never)
  await draw()

  return { world, ui, props }
}

for (const seed of [7, 99, 2024]) {
  test(`passeio aleatório ${seed}: nada passa dos limites, sem aviso, e o fim acompanha o tamanho final`, async ($, on) => {
    const { world, ui, props } = await walk(seed, 60, {}, $, on)
    const image = await imageOf(ui)

    expect(world.toasts).toEqual([])
    expect(await ui.find({ type: 'Text', text: /indisponível/ })).toBeUndefined()
    expect(image).toBeDefined()
    expect(image?.props.columns).toBe(Math.min(255, props.bodyColumns))
    expect(world.blits.every(one => one.columns <= 255 && one.rows <= 255)).toBe(true)
    expect(world.renders.length).toBeLessThanOrEqual(60 * 3)

    for (const one of world.renders as Array<{ width: number; height: number }>) expect(one.width * one.height).toBeLessThanOrEqual(1_600_000)
    await ui.unmount()
  })
}

test('passeio aleatório com desenhos derrubados no meio: ainda acaba mostrando a imagem, sem aviso', async ($, on) => {
  const { world, ui } = await walk(31, 50, { supersede: 6 }, $, on)

  expect(world.toasts).toEqual([])
  expect(await imageOf(ui)).toBeDefined()
  await ui.unmount()
})

test('arrastada longa de redimensionamento não deixa o painel parado: desenha no máximo 700 ms depois do primeiro tamanho novo', async ($, on) => {
  const world = engine(on, GHOSTTY)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await draw()
  expect(world.renders.length).toBe(1)

  for (let step = 0; step < 12; step += 1) {
    await ui.redraw({ ...PANE.props, bodyColumns: 50 + step } as never)
    await new Promise(resolve => setTimeout(resolve, 80))
  }

  expect(world.renders.length).toBeGreaterThanOrEqual(2)
  await ui.unmount()
})

test('depois de um desenho novo, o destaque pede ao servidor a revisão nova, não a velha', async ($, on) => {
  const world = engine(on, GHOSTTY, { hits: [{ act: 'tree', x: 120, y: 80, w: 100, h: 20 }] })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  await draw()
  await draw()
  expect(world.hovers.every(one => one.rev === 3)).toBe(true)
  const before = world.hovers.length

  await resized(ui, { ...PANE.props, bodyColumns: 60 })
  await draw()
  await draw()

  const after = world.hovers.slice(before)

  expect(world.renders.length).toBe(2)
  expect(after.length).toBeGreaterThan(0)
  expect(after.every(one => one.rev === 4)).toBe(true)
  await ui.unmount()
})
