import { expect, test } from 'claude-code/testing'

import { findEditors, hasFolderApp, openInEditor, resetEditorsCache, showInFolder } from '../hooks/core/editors'

type Opts = { os?: 'Darwin' | 'Linux'; wsl?: boolean; installed?: Record<string, string>; calls?: (readonly string[])[] }

const boot = ({ os = 'Linux', wsl = false, installed = {}, calls = [] }: Opts = {}) => {
  resetEditorsCache()
  return {
    env: { get: async (n: string) => (n === 'WSL_DISTRO_NAME' && wsl ? 'Ubuntu' : undefined) },
    process: {
      run: async (argv: readonly string[]) => {
        calls.push(argv)
        const ok = (stdout = '') => ({ exitCode: 0, stdout, stderr: '' })
        const no = { exitCode: 1, stdout: '', stderr: '' }
        if (argv[0] === 'uname') return ok(`${os}\n`)
        if (argv[0] === 'which') return argv[1] in installed ? ok(installed[argv[1]] + '\n') : no
        if (argv[0] === 'open' && argv[1] === '-Ra') return argv[2] in installed ? ok() : no
        return ok()
      },
    },
  } as any
}

test('Linux finds editors by which', async () => {
  const eds = await findEditors(boot({ installed: { code: '/usr/bin/code', zed: '/usr/bin/zed' } }))

  expect(eds).toEqual([
    { name: 'VS Code', cli: 'code' },
    { name: 'Zed', cli: 'zed' },
  ])
})

test('an editor whose path has a colon is dropped', async () => {
  const eds = await findEditors(boot({ installed: { code: 'C:\\bin\\code', cursor: '/usr/bin/cursor' } }))

  expect(eds.map((e) => e.cli)).toEqual(['cursor'])
})

test('macOS probes apps with open -Ra and opens with open -a', async () => {
  const calls: (readonly string[])[] = []
  const $ = boot({ os: 'Darwin', installed: { 'Visual Studio Code': '' }, calls })
  const eds = await findEditors($)

  expect(eds).toEqual([{ name: 'VS Code', cli: 'Visual Studio Code' }])
  expect(calls).toContainEqual(['open', '-Ra', 'Sublime Text'])
  expect(await openInEditor($, eds[0], '/a b/c.ts')).toBe(true)
  expect(calls.at(-1)).toEqual(['open', '-a', 'Visual Studio Code', '/a b/c.ts'])
})

test('openInEditor runs the cli with the absolute path and reports failure', async () => {
  const calls: (readonly string[])[] = []
  const $ = boot({ calls })
  await openInEditor($, { name: 'Zed', cli: 'zed' }, "/p/ç:'x.ts")

  expect(calls.at(-1)).toEqual(['zed', "/p/ç:'x.ts"])
  const bad = { process: { run: async () => ({ exitCode: 2, stdout: '', stderr: '' }) }, env: { get: async () => undefined } } as any
  expect(await openInEditor(bad, { name: 'Zed', cli: 'zed' }, '/x')).toBe(false)
})

test('the editor list is cached', async () => {
  const calls: (readonly string[])[] = []
  const $ = boot({ installed: { code: '/c' }, calls })
  await findEditors($)
  const n = calls.length
  await findEditors($)

  expect(calls).toHaveLength(n)
})

test('WSL builds the explorer.exe /select command through wslpath', async () => {
  const calls: (readonly string[])[] = []
  const $ = boot({ wsl: true, calls })

  expect(await hasFolderApp($)).toBe(true)
  expect(await showInFolder($, '/home/u/a b/x.ts')).toBe(true)
  expect(calls.at(-1)).toEqual(['sh', '-c', 'explorer.exe /select,"$(wslpath -w "$1")"; exit 0', 'sh', '/home/u/a b/x.ts'])
})

test('macOS reveals with open -R; Linux opens the containing folder', async () => {
  const mac: (readonly string[])[] = []
  await showInFolder(boot({ os: 'Darwin', calls: mac }), '/a/b.ts')
  expect(mac.at(-1)).toEqual(['open', '-R', '/a/b.ts'])

  const lin: (readonly string[])[] = []
  await showInFolder(boot({ calls: lin }), '/a/b.ts')
  expect(lin.at(-1)).toEqual(['xdg-open', '/a'])
})

test('hasFolderApp on plain Linux needs xdg-open', async () => {
  expect(await hasFolderApp(boot({ installed: { 'xdg-open': '/usr/bin/xdg-open' } }))).toBe(true)
  expect(await hasFolderApp(boot())).toBe(false)
})
