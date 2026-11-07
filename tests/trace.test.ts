import type { EngineInterface } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { guarded, resetTrace, trace, traceVerbose } from '../hooks/core/trace'

type Run = { argv: string[] }

const world = (options: { files?: string[]; failRuns?: number } = {}) => {
  const runs: Run[] = []
  const timers: Array<() => void> = []
  let failures = options.failRuns ?? 0

  const $ = {
    plugin: { root: '/plug' },
    env: { get: async (name: string) => (name === 'HOME' ? '/home/u' : name === 'TERM_PROGRAM' ? 'ghostty' : undefined) },
    fs: { exists: async (path: string) => (options.files ?? []).some(name => path.endsWith(name)) },
    session: { id: async () => 'abcdef123456' },
    clock: {
      after: (_ms: number, fn: () => void) => {
        timers.push(fn)

        return { cancel: () => {} }
      },
    },
    process: {
      run: async (argv: string[]) => {
        if (failures > 0) {
          failures -= 1
          throw new Error('superseded')
        }

        runs.push({ argv })

        return { exitCode: 0, stdout: '', stderr: '' }
      },
    },
  } as unknown as EngineInterface

  const fire = async () => {
    const due = timers.splice(0)
    for (const fn of due) fn()
    await new Promise(resolve => setTimeout(resolve, 15))
  }

  return { $, runs, fire }
}

const linesOf = (run: Run | undefined) => (run?.argv.slice(5) ?? []).map(line => JSON.parse(line) as Record<string, unknown>)

test('várias linhas viram uma única gravação, com cabeçalho e o id curto da sessão em cada uma', async () => {
  resetTrace()
  const w = world()

  await trace(w.$, 'a', { n: 1 })
  await trace(w.$, 'b')
  await traceVerbose(w.$, 'detalhe')
  await w.fire()

  expect(w.runs).toHaveLength(1)
  expect(w.runs[0]?.argv.slice(0, 3)).toEqual(['sh', '-c', expect.stringContaining('>> "$f"')])
  expect(w.runs[0]?.argv[4]).toBe('/home/u/.cache/panel/debug.log')

  const lines = linesOf(w.runs[0])

  expect(lines.map(one => one.ev)).toEqual(['log-open', 'a', 'b'])
  expect(lines[0]).toMatchObject({ program: 'ghostty', isGhostty: false, verbose: false })
  expect(lines.slice(1).every(one => one.s === 'abcdef12')).toBe(true)
  expect(lines[1]).toMatchObject({ ev: 'a', n: 1 })
})

test('o arquivo debug.off desliga o log sem gravar nada', async () => {
  resetTrace()
  const w = world({ files: ['debug.off'] })

  await trace(w.$, 'a')
  await w.fire()

  expect(w.runs).toHaveLength(0)
})

test('o arquivo debug.verbose liga as linhas detalhadas', async () => {
  resetTrace()
  const w = world({ files: ['debug.verbose'] })

  await traceVerbose(w.$, 'detalhe', { x: 1 })
  await w.fire()

  expect(linesOf(w.runs[0]).map(one => one.ev)).toEqual(['log-open', 'detalhe'])
})

test('fila cheia descarta as mais antigas e avisa quantas', async () => {
  resetTrace()
  const w = world()

  for (let i = 0; i < 450; i += 1) await trace(w.$, 'x', { i })
  await w.fire()

  const lines = linesOf(w.runs[0])

  expect(lines.find(one => one.ev === 'log-dropped')).toMatchObject({ count: 50 })
  expect(lines.filter(one => one.ev === 'x')).toHaveLength(400)
  expect(lines.filter(one => one.ev === 'x')[0]).toMatchObject({ i: 50 })
})

test('gravação que falha guarda as linhas e grava junto com as seguintes', async () => {
  resetTrace()
  const w = world({ failRuns: 1 })

  await trace(w.$, 'primeira')
  await w.fire()
  expect(w.runs).toHaveLength(0)

  await trace(w.$, 'segunda')
  await w.fire()

  expect(linesOf(w.runs[0]).map(one => one.ev)).toEqual(['log-open', 'primeira', 'segunda'])
})

test('guarded registra o erro do hook com a pilha e o relança', async () => {
  resetTrace()
  const w = world()

  await expect(guarded(w.$, 'ui.render', async () => Promise.reject(new Error('quebrou')))).rejects.toThrow('quebrou')
  await w.fire()

  expect(linesOf(w.runs[0]).find(one => one.ev === 'hook-error')).toMatchObject({ hook: 'ui.render', message: 'quebrou' })
  expect(await guarded(w.$, 'x', async () => 7)).toBe(7)
})
