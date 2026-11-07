import type { EngineInterface } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { clip, hot, render, stop, whenLost } from '../hooks/render/renderer'

const FRAME = { file: '/tmp/f.png', rev: 7, height: 300, ms: 40, hits: [{ act: 'a', x: 1, y: 2, w: 3, h: 4 }] }

const entry = (name: string) => ({ name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false })
const tick = () => new Promise(resolve => setTimeout(resolve, 20))

// The kit's engine `$` cannot stand in for a plugin's: only the hooks module it loads may call env, fs, process and
// http. So the tests hand it a `$` of their own.
const world = (options: { chrome?: boolean; slowHome?: Promise<void>; refuse?: number; endWith?: string } = {}) => {
  const spawns: string[][] = []
  const calls: Array<{ url: string; body: string }> = []
  const gates: Array<() => void> = []
  const delays: Array<Promise<void>> = []
  const timers: Array<{ due: number; fn: () => void; live: boolean }> = []
  let now = 0
  let refused = 0

  const $ = {
    plugin: { root: '/plug' },
    env: {
      get: async (name: string) => {
        if (name === 'HOME') await options.slowHome

        return name === 'HOME' ? '/home/u' : undefined
      },
    },
    session: { id: async () => 'sess' },
    process: {
      run: async () => ({ exitCode: 0, stdout: '1000\n', stderr: '' }),
      spawn: (request: { argv: readonly string[] }) => {
        spawns.push([...request.argv])

        return (async function* () {
          await new Promise<void>(resolve => gates.push(resolve))
          if (options.endWith) throw new Error(options.endWith)

          return { code: 0, signal: null }
        })()
      },
    },
    fs: {
      list: async (path: string) => {
        if (options.chrome === false) return []
        if (path.endsWith('ms-playwright')) return [entry('chromium_headless_shell-1100'), entry('chromium_headless_shell-1200'), entry('other')]

        return []
      },
      exists: async (path: string) => path.includes('shell-1200') && path.includes('chrome-headless-shell-linux64'),
    },
    http: {
      fetch: async (url: string, init?: { body?: string }) => {
        if (refused < (options.refuse ?? 0)) {
          refused += 1

          throw new Error('ECONNREFUSED')
        }

        calls.push({ url, body: init?.body ?? '' })
        const wait = delays.shift()
        if (wait) await wait

        const answer = url.endsWith('/render') ? FRAME : url.endsWith('/hover') ? { file: '/tmp/hover.png' } : {}

        return { status: 200, ok: true, headers: {}, text: JSON.stringify(answer) }
      },
    },
    clock: {
      sleep: async () => {},
      after: (ms: number, fn: () => void) => {
        const timer = { due: now + ms, fn, live: true }
        timers.push(timer)

        return { cancel: () => void (timer.live = false) }
      },
    },
  } as unknown as EngineInterface

  const advance = async (ms: number) => {
    now += ms
    for (const timer of timers) {
      if (timer.live && timer.due <= now) {
        timer.live = false
        timer.fn()
      }
    }
    await tick()
  }

  const armed = () => timers.filter(timer => timer.live).length

  return { $, spawns, calls, gates, delays, advance, armed }
}

const renders = (calls: Array<{ url: string }>) => calls.filter(call => call.url.endsWith('/render'))
const quits = (calls: Array<{ url: string }>) => calls.filter(call => call.url.endsWith('/quit'))

test('render starts the server once and reuses it', async () => {
  const w = world()
  await stop(w.$)

  const first = await render(w.$, '<p>1</p>', 800, 600)
  await render(w.$, '<p>2</p>', 800, 600)
  await render(w.$, '<p>3</p>', 800, 600)

  expect(w.spawns).toHaveLength(1)
  expect(w.spawns[0]?.slice(0, 2)).toEqual(['node', '/plug/renderer/server.mjs'])
  expect(w.spawns[0]?.[3]).toBe('/home/u/.cache/ms-playwright/chromium_headless_shell-1200/chrome-headless-shell-linux64/chrome-headless-shell')
  expect(renders(w.calls)).toHaveLength(3)
  expect(first).toEqual({ file: FRAME.file, rev: 7, height: FRAME.height, hits: FRAME.hits })
  await stop(w.$)
})

test('without chrome, render returns null and starts nothing', async () => {
  const w = world({ chrome: false })
  await stop(w.$)

  expect(await render(w.$, '<p>x</p>', 800, 600)).toBeNull()
  expect(w.spawns).toHaveLength(0)
  expect(w.calls).toHaveLength(0)
})

test('after 120 s idle the server is told to quit', async () => {
  const w = world()
  await stop(w.$)

  await render(w.$, '<p>x</p>', 800, 600)
  await w.advance(119_999)
  expect(quits(w.calls)).toHaveLength(0)

  await w.advance(1)
  expect(quits(w.calls)).toHaveLength(1)
})

test('two renders at once: the older one returns null', async () => {
  const w = world()
  await stop(w.$)

  let release = () => {}
  w.delays.push(new Promise<void>(resolve => (release = resolve)))

  const first = render(w.$, '<p>old</p>', 800, 600)
  await tick()
  const second = await render(w.$, '<p>new</p>', 800, 600)
  release()

  expect(await first).toBeNull()
  expect(second).toMatchObject({ file: FRAME.file })
  await stop(w.$)
})

test('a server that died is replaced on the next render', async () => {
  const w = world()
  await stop(w.$)

  await render(w.$, '<p>1</p>', 800, 600)
  w.gates[0]?.()
  await tick()
  await render(w.$, '<p>2</p>', 800, 600)

  expect(w.spawns).toHaveLength(2)
  await stop(w.$)
})

test('a render in flight when stop runs does not re-arm the idle timer', async () => {
  const w = world()
  await stop(w.$)

  await render(w.$, '<p>0</p>', 800, 600)
  let release = () => {}
  w.delays.push(new Promise<void>(resolve => (release = resolve)))

  const inFlight = render(w.$, '<p>1</p>', 800, 600)
  await tick()
  await stop(w.$)
  release()
  await inFlight

  expect(w.armed()).toBe(0)
})

test('stop during launch quits the server that launch then starts', async () => {
  let release = () => {}
  const w = world({ slowHome: new Promise<void>(resolve => (release = resolve)), refuse: 3 })

  const pending = render(w.$, '<p>x</p>', 800, 600)
  await tick()
  const stopping = stop(w.$)
  release()
  await Promise.all([pending, stopping])

  expect(w.spawns).toHaveLength(1)
  expect(quits(w.calls)).toHaveLength(1)

  await render(w.$, '<p>y</p>', 800, 600)
  expect(w.spawns).toHaveLength(2)
  await stop(w.$)
})

test('clip keeps the server alive like render does', async () => {
  const w = world()
  await stop(w.$)

  await render(w.$, '<p>x</p>', 800, 600)
  await w.advance(100_000)
  await clip(w.$, 0, 100)
  await w.advance(100_000)
  expect(quits(w.calls)).toHaveLength(0)

  await w.advance(20_000)
  expect(quits(w.calls)).toHaveLength(1)
})

test('the idle stop tells the pane the renderer is gone', async () => {
  const w = world()
  await stop(w.$)
  let lost = 0
  whenLost(isDeath => void (lost += isDeath ? 100 : 1))

  await render(w.$, '<p>x</p>', 800, 600)
  await w.advance(120_000)
  expect(lost).toBe(1)

  await render(w.$, '<p>y</p>', 800, 600)
  expect(w.spawns).toHaveLength(2)
  await stop(w.$)
  expect(lost).toBe(1)
})

test('a render that arrives while stop is quitting gets a new server, not the dying one', async () => {
  const w = world()
  await stop(w.$)

  await render(w.$, '<p>1</p>', 800, 600)
  let release = () => {}
  w.delays.push(new Promise<void>(resolve => (release = resolve)))

  const stopping = stop(w.$)
  await tick()
  const next = render(w.$, '<p>2</p>', 800, 600)
  await tick()
  release()
  await stopping

  expect(await next).toMatchObject({ file: FRAME.file })
  expect(w.spawns).toHaveLength(2)
  await stop(w.$)
})

test('a server that dies on its own is reported as a death', async () => {
  const w = world()
  await stop(w.$)
  const seen: boolean[] = []
  whenLost(isDeath => void seen.push(isDeath))

  await render(w.$, '<p>x</p>', 800, 600)
  w.gates[0]?.()
  await tick()

  expect(seen).toEqual([true])
  await stop(w.$)
})

test('a server the engine aborted is reported as aborted, until it keeps happening', async () => {
  const w = world({ endWith: 'panel: $.process.spawn(node) aborted' })
  await stop(w.$)
  const seen: Array<[boolean, boolean | undefined]> = []
  whenLost((isDeath, isAborted) => void seen.push([isDeath, isAborted]))

  for (let i = 0; i < 5; i += 1) {
    await render(w.$, '<p>x</p>', 800, 600)
    w.gates.at(-1)?.()
    await tick()
  }

  expect(seen).toEqual([
    [true, true],
    [true, true],
    [true, true],
    [true, false],
    [true, false],
  ])
  await stop(w.$)
})

test('hot asks the running server for the hovered frame and answers null with none', async () => {
  const w = world()
  await stop(w.$)

  expect(await hot(w.$, 'tree', 1, 0, 100)).toBeNull()

  await render(w.$, '<p>x</p>', 800, 600)

  expect(await hot(w.$, 'file:/a b.ts', 7, 56, 560)).toBe('/tmp/hover.png')
  expect(JSON.parse(w.calls.at(-1)?.body ?? '{}')).toEqual({ act: 'file:/a b.ts', rev: 7, y: 56, height: 560 })
  await stop(w.$)
})

test('um servidor que morre sozinho leva o temporizador de ociosidade junto: nada de /quit nem aviso depois', async () => {
  const w = world()
  await stop(w.$)
  const seen: boolean[] = []
  whenLost(isDeath => void seen.push(isDeath))

  await render(w.$, '<p>x</p>', 800, 600)
  w.gates[0]?.()
  await tick()
  await w.advance(130_000)

  expect(seen).toEqual([true])
  expect(quits(w.calls)).toHaveLength(0)
  await stop(w.$)
})
