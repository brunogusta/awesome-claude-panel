import { expect, test } from 'claude-code/testing'

import { gitInfo } from '../hooks/core/git'

type Replies = { root?: string | null; status?: string; numstat?: string; head?: boolean; files?: Record<string, string> }

const boot = (replies: Replies, calls: (readonly string[])[] = []) => {
  const { root = '/r', status = '', numstat = '', head = true, files = {} } = replies
  const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '' })

  return {
    process: {
      run: async (argv: readonly string[]) => {
        calls.push(argv)
        const cmd = argv.join(' ')
        if (cmd.includes('--show-toplevel')) return root === null ? { exitCode: 128, stdout: '', stderr: 'fatal' } : ok(`${root}\n`)
        if (cmd.includes('rev-parse --verify')) return head ? ok('abc\n') : { exitCode: 128, stdout: '', stderr: '' }
        if (cmd.includes('hash-object')) return ok('4b825dc\n')
        if (cmd.includes('status')) return ok(status)
        if (cmd.includes('--numstat')) return ok(numstat)
        return { exitCode: 1, stdout: '', stderr: '' }
      },
    },
    fs: {
      stat: async (path: string) => ({ size: path in files ? files[path].length : 0 }),
      read: async (path: string) => {
        if (!(path in files)) throw new Error('ENOENT')
        return files[path]
      },
    },
  } as any
}

const z = (...parts: string[]) => parts.join('\0') + '\0'

test('outside a repository gitInfo is null', async () => {
  const $ = boot({ root: null })

  expect(await gitInfo($, '/tmp/nada')).toBeNull()
})

test('numstat becomes absolute-path lines and the branch is read', async () => {
  const $ = boot({
    status: z('# branch.oid abc', '# branch.head main', '# branch.ab +2 -0'),
    numstat: z('3\t1\tsrc/a b:ç.ts', '-\t-\timg.png', '0\t5\tz.ts'),
  })

  expect(await gitInfo($, '/r/src')).toEqual({
    root: '/r',
    branch: 'main',
    ahead: 2,
    lines: { '/r/src/a b:ç.ts': [3, 1], '/r/z.ts': [0, 5] },
  })
})

test('without upstream ahead is null', async () => {
  const $ = boot({ status: z('# branch.oid abc', '# branch.head feat/x') })

  const info = await gitInfo($, '/r')
  expect(info?.branch).toBe('feat/x')
  expect(info?.ahead).toBeNull()
})

test('a rename in numstat is keyed by the new path', async () => {
  const $ = boot({ numstat: '1\t2\t\0old.ts\0new name.ts\0' })

  expect((await gitInfo($, '/r'))?.lines).toEqual({ '/r/new name.ts': [1, 2] })
})

test('untracked files count their lines as additions', async () => {
  const $ = boot({
    status: z('# branch.head main', '? novo arquivo.ts', '? vazio.ts', '1 .M N... 100644 100644 100644 a b src/a.ts'),
    files: { '/r/novo arquivo.ts': 'a\nb\nc\n', '/r/vazio.ts': '' },
  })

  expect((await gitInfo($, '/r'))?.lines).toEqual({ '/r/novo arquivo.ts': [3, 0], '/r/vazio.ts': [0, 0] })
})

test('binary and unreadable untracked files are skipped, long ones capped at 10 000', async () => {
  const $ = boot({
    status: z('# branch.head main', '? bin.dat', '? gone.ts', '? huge.ts'),
    files: { '/r/bin.dat': 'x\0y', '/r/huge.ts': 'l\n'.repeat(12_000) },
  })

  expect((await gitInfo($, '/r'))?.lines).toEqual({ '/r/huge.ts': [10_000, 0] })
})

test('a fresh repository without HEAD diffs against the empty tree', async () => {
  const calls: (readonly string[])[] = []
  const $ = boot({ head: false, numstat: '4\t0\ta.ts\0' }, calls)

  expect((await gitInfo($, '/r'))?.lines).toEqual({ '/r/a.ts': [4, 0] })
  const numstat = calls.find(c => c.includes('--numstat'))!
  expect(numstat).toContain('4b825dc')
  expect(numstat).not.toContain('HEAD')
})

test('every git call is rooted with -C and unquoted paths', async () => {
  const calls: (readonly string[])[] = []
  const $ = boot({}, calls)

  await gitInfo($, '/r/dir com espaço')

  expect(calls[0].slice(0, 2)).toEqual(['git', '-C'])
  expect(calls[0][2]).toBe('/r/dir com espaço')
  for (const c of calls) expect(c).toContain('core.quotePath=false')
})

test('files inside a new directory are listed one by one', async () => {
  const calls: (readonly string[])[] = []
  const $ = boot({ status: z('# branch.head main', '? pasta nova/f.ts'), files: { '/r/pasta nova/f.ts': 'a\nb' } }, calls)

  expect((await gitInfo($, '/r'))?.lines).toEqual({ '/r/pasta nova/f.ts': [2, 0] })
  expect(calls.find(c => c.includes('status'))).toContain('--untracked-files=all')
})

test('a rename entry in status does not leak its old path as untracked', async () => {
  const $ = boot({
    status: z('# branch.head main', '2 R. N... 100644 100644 100644 a b R100 new.ts', '? old.ts', '? u.ts'),
    files: { '/r/old.ts': 'x\n', '/r/u.ts': 'y\n', '/r/new.ts': 'z\n' },
  })

  expect(Object.keys((await gitInfo($, '/r'))!.lines)).toEqual(['/r/u.ts'])
})

test('untracked files over 1 MB are skipped', async () => {
  const $ = boot({ status: z('# branch.head main', '? big.log'), files: { '/r/big.log': 'x\n'.repeat(600_000) } })

  expect((await gitInfo($, '/r'))?.lines).toEqual({})
})
