import { atom, read } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { act, hitAt, hitIn, mentionText } from '../hooks/actions'
import { resetEditorsCache } from '../hooks/core/editors'

const seenAtom = atom({ plugin: 'panel', key: 'seen' } as const, {} as Record<string, number>, { shape: 'seen-1' })
const openDiffAbs = atom({ plugin: 'panel', key: 'openDiffAbs' } as const, null as string | null, { shape: 'openDiffAbs-1' })
const scope = atom({ plugin: 'panel', key: 'scope' } as const, 'turn', { shape: 'scope-1' })
const isTreeOpen = atom({ plugin: 'panel', key: 'isTreeOpen' } as const, false, { shape: 'isTreeOpen-1' })
const expanded = atom({ plugin: 'panel', key: 'expanded' } as const, [] as string[], { shape: 'expanded-1' })
const showHidden = atom({ plugin: 'panel', key: 'showHidden' } as const, false, { shape: 'showHidden-1' })
const showSizes = atom({ plugin: 'panel', key: 'showSizes' } as const, false, { shape: 'showSizes-1' })

const exit = (code: number, stdout = '') => ({ exitCode: code, stdout, stderr: '' })

const world = (options: { isLaunchRefused?: boolean } = {}) => {
  resetEditorsCache()
  const ran: string[][] = []
  const copied: string[] = []
  const toasts: string[] = []
  const filled: string[] = []
  const invalidated: string[] = []
  const state = new Map<string, { value: unknown; version: number }>()

  const $ = {
    state: {
      get: async (ref: { key: string }) => state.get(ref.key) ?? { value: undefined, version: 0 },
      set: async (ref: { key: string }, value: unknown) => {
        const version = (state.get(ref.key)?.version ?? 0) + 1
        state.set(ref.key, { value, version })

        return { isSet: true, version }
      },
    },
    env: { get: async () => undefined },
    session: { cwd: async () => '/proj' },
    ui: {
      invalidate: (event: string) => void invalidated.push(event),
      copy: async (args: { text: string }) => {
        copied.push(args.text)

        return { isCopied: true }
      },
      toast: (text: string) => void toasts.push(text),
    },
    prompt: {
      fill: async (args: { text: string }) => {
        filled.push(args.text)
      },
    },
    process: {
      run: async (argv: string[]) => {
        ran.push(argv)

        if (argv[0] === 'uname') return exit(0, 'Linux\n')
        if (argv[0] === 'which') return exit(argv[1] === 'code' ? 0 : 1, '/usr/bin/code\n')
        if (argv[0] === 'git') return exit(128)

        return exit(options.isLaunchRefused ? 1 : 0)
      },
    },
  } as unknown as EngineInterface

  return { $, ran, copied, toasts, filled, invalidated }
}

test('hitAt acha o botão dentro da linha, não a linha', () => {
  const hits = [
    { act: 'file:/a', x: 0, y: 0, w: 400, h: 30 },
    { act: 'copy:/a', x: 300, y: 5, w: 60, h: 20 },
  ]

  expect(hitAt(hits, 310, 10)).toBe('copy:/a')
  expect(hitAt(hits, 10, 10)).toBe('file:/a')
  expect(hitAt(hits, 500, 500)).toBeNull()
})

test('file: abre e fecha o diff, mesmo com : no caminho', async () => {
  const { $ } = world()

  await act($, 'file:/proj/a b:c.ts', 'terminal')
  expect(await read($, openDiffAbs)).toBe('/proj/a b:c.ts')

  await act($, 'file:/proj/a b:c.ts', 'terminal')
  expect(await read($, openDiffAbs)).toBeNull()
})

test('abrir o diff de um arquivo marca como visto naquele instante, mesmo com : no caminho', async () => {
  const { $ } = world()
  const before = Date.now()

  await act($, 'file:/proj/a b:c.ts', 'terminal')
  const marks = await read($, seenAtom)

  expect(Object.keys(marks)).toEqual(['/proj/a b:c.ts'])
  expect(marks['/proj/a b:c.ts']).toBeGreaterThanOrEqual(before)
})

test('open:<cli>:<abs> rejunta o caminho com : e abre no editor', async () => {
  const { $, ...seen } = world()

  await act($, 'open:code:/proj/a b:c.ts', 'terminal')
  expect(seen.ran).toContainEqual(['code', '/proj/a b:c.ts'])
  expect(seen.toasts).toEqual([])
})

test('open: avisa quando o editor recusa', async () => {
  const { $, ...seen } = world({ isLaunchRefused: true })

  await act($, 'open:code:/proj/a.ts', 'terminal')
  expect(seen.toasts).toEqual(['Não consegui abrir a.ts no VS Code'])
})

test('copy: copia o caminho e avisa; mention: preenche o prompt', async () => {
  const { $, ...seen } = world()

  await act($, 'copy:/proj/src/a.ts', 'terminal')
  expect(seen.copied).toEqual(['/proj/src/a.ts'])
  expect(seen.toasts).toEqual(['Copiado /proj/src/a.ts'])

  await act($, 'mention:/proj/src/a.ts', 'terminal')
  await act($, 'mention:/proj/my file.ts', 'terminal')
  expect(seen.filled).toEqual(['@src/a.ts ', '@"my file.ts" '])
})

test('tree, dir:, scope, sizes, hidden, collapse e refresh mudam o estado', async () => {
  const { $, invalidated } = world()

  await act($, 'tree', 'terminal')
  expect(await read($, isTreeOpen)).toBe(true)
  await act($, 'tree', 'terminal')
  expect(await read($, isTreeOpen)).toBe(false)

  await act($, 'dir:/proj/src', 'terminal')
  await act($, 'dir:/proj/lib', 'terminal')
  expect(await read($, expanded)).toEqual(['/proj/src', '/proj/lib'])
  await act($, 'dir:/proj/src', 'terminal')
  expect(await read($, expanded)).toEqual(['/proj/lib'])
  await act($, 'collapse', 'terminal')
  expect(await read($, expanded)).toEqual([])

  await act($, 'scope', 'terminal')
  expect(await read($, scope)).toBe('session')
  await act($, 'scope', 'terminal')
  expect(await read($, scope)).toBe('turn')

  await act($, 'sizes', 'terminal')
  expect(await read($, showSizes)).toBe(true)
  await act($, 'hidden', 'terminal')
  expect(await read($, showHidden)).toBe(true)

  await act($, 'refresh', 'terminal')
  expect(invalidated).toContain('ui.render')

  await act($, 'nada', 'terminal')
})

test('mention: raiz / e aspas escapadas', async () => {
  expect(mentionText('a"b.ts')).toBe('@"a\\"b.ts" ')
  expect(mentionText('a b.ts')).toBe('@"a b.ts" ')
  expect(mentionText('a.ts')).toBe('@a.ts ')
})

test('hitIn acha o botão baixo mesmo quando o centro da célula cai fora dele, e ignora a vizinha', () => {
  const hits = [
    { act: 'a', x: 100, y: 4, w: 80, h: 22 },
    { act: 'b', x: 186, y: 4, w: 80, h: 22 },
    { act: 'row', x: 0, y: 0, w: 400, h: 90 },
  ]

  expect(hitAt(hits, 104 + 6, 28 + 14)).toBe('row')
  expect(hitIn(hits, 99, 0, 112, 28)).toBe('a')
  expect(hitIn(hits, 182, 0, 195, 28)).toBe('b')
  expect(hitIn(hits, 181, 0, 194, 28)).toBe('b')
  expect(hitIn(hits, 600, 0, 613, 28)).toBeNull()
})
