import { expect, test } from 'claude-code/testing'

import { treeRows } from '../hooks/core/tree'

type E = { name: string; kind: 'file' | 'dir' | 'other'; size?: number }

const boot = (dirs: Record<string, E[]>) =>
  ({
    fs: {
      list: async (p: string) => {
        if (!(p in dirs)) throw new Error('ENOENT')
        return dirs[p].map((e) => ({ size: 0, mtimeMs: 0, isLink: false, ...e }))
      },
    },
  }) as any

const root: E[] = [
  { name: 'zeta.ts', kind: 'file', size: 10 },
  { name: 'Alfa.md', kind: 'file', size: 20 },
  { name: 'src', kind: 'dir' },
  { name: '.git', kind: 'dir' },
  { name: '.env', kind: 'file', size: 5 },
  { name: 'docs', kind: 'dir' },
  { name: 'link', kind: 'other' },
  { name: 'f10.txt', kind: 'file' },
  { name: 'f2.txt', kind: 'file' },
]

test('folders first, alphabetical, hidden and .git left out', async () => {
  const rows = await treeRows(boot({ '/r': root }), '/r', [], false, false)

  expect(rows.map((r) => r.name)).toEqual(['docs', 'src', 'Alfa.md', 'f2.txt', 'f10.txt', 'link', 'zeta.ts'])
  expect(rows.slice(0, 2).every((r) => r.isDir)).toBe(true)
})

test('showHidden brings dotfiles but never .git', async () => {
  const rows = await treeRows(boot({ '/r': root }), '/r', [], true, false)

  expect(rows.map((r) => r.name)).toContain('.env')
  expect(rows.map((r) => r.name)).not.toContain('.git')
})

test('size only with showSizes, and only for files', async () => {
  const dirs = { '/r': root }
  const off = await treeRows(boot(dirs), '/r', [], false, false)
  const on = await treeRows(boot(dirs), '/r', [], false, true)

  expect(off.every((r) => r.size === undefined)).toBe(true)
  expect(on.find((r) => r.name === 'zeta.ts')?.size).toBe(10)
  expect(on.find((r) => r.name === 'src')?.size).toBeUndefined()
})

test('expanded folders list their children right after, one level deeper', async () => {
  const dirs = {
    '/r': [{ name: 'src', kind: 'dir' }, { name: 'a.ts', kind: 'file' }] as E[],
    '/r/src': [{ name: 'b.ts', kind: 'file' }, { name: 'lib', kind: 'dir' }] as E[],
  }
  const rows = await treeRows(boot(dirs), '/r', ['/r/src'], false, false)

  expect(rows.map((r) => [r.name, r.depth, r.isOpen])).toEqual([
    ['src', 0, true],
    ['lib', 1, false],
    ['b.ts', 1, false],
    ['a.ts', 0, false],
  ])
})

test('paths with spaces, colons and accents are kept verbatim', async () => {
  const dirs = {
    '/r/p r:ç': [{ name: 'ação "x".ts', kind: 'file' }] as E[],
    '/r': [{ name: 'p r:ç', kind: 'dir' }] as E[],
  }
  const rows = await treeRows(boot(dirs), '/r', ['/r/p r:ç'], false, false)

  expect(rows[1].abs).toBe('/r/p r:ç/ação "x".ts')
})

test('rows are capped at 2000 and an unreadable folder is skipped', async () => {
  const many = Array.from({ length: 2500 }, (_, i) => ({ name: `f${i}`, kind: 'file' as const }))
  const capped = await treeRows(boot({ '/r': many }), '/r', [], false, false)
  expect(capped).toHaveLength(2000)

  const broken = await treeRows(boot({ '/r': [{ name: 'x', kind: 'dir' }] }), '/r', ['/r/x'], false, false)
  expect(broken.map((r) => r.name)).toEqual(['x'])
})
