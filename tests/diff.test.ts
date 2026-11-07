import { expect, test } from 'claude-code/testing'

import { fileDiff, parseDiff } from '../hooks/core/diff'

type Call = { argv: readonly string[] }

const answer = (calls: Call[], files: Record<string, string>, tracked: boolean, diff = '', existing = ['/r']) =>
  ({
    process: {
      run: async (argv: readonly string[]) => {
        calls.push({ argv })
        const cmd = argv.join(' ')
        if (cmd.includes('--show-toplevel')) return { exitCode: 0, stdout: '/r\n', stderr: '' }
        if (cmd.includes('ls-files')) return { exitCode: tracked ? 0 : 1, stdout: '', stderr: '' }
        if (cmd.includes('rev-parse --verify')) return { exitCode: 0, stdout: 'abc\n', stderr: '' }
        if (cmd.includes(' diff ')) return { exitCode: 0, stdout: diff, stderr: '' }
        return { exitCode: 1, stdout: '', stderr: '' }
      },
    },
    fs: {
      exists: async (path: string) => existing.some(d => d === path || path.startsWith(`${d}/`)) && !path.includes('gone'),
      read: async (path: string) => {
        if (!(path in files)) throw new Error('ENOENT')
        return files[path]
      },
    },
  }) as any

test('parseDiff reads the hunk header with function context and numbers each row', () => {
  const text = [
    '@@ -10,4 +20,5 @@ function build(a, b) {',
    ' keep',
    '-old',
    '+new1',
    '+new2',
    ' tail',
    '\\ No newline at end of file',
  ].join('\n')

  expect(parseDiff(text)).toEqual([
    { kind: 'hunk', line: 20, context: 'function build(a, b) {' },
    { kind: 'same', line: 20, text: 'keep' },
    { kind: 'del', line: 11, text: 'old' },
    { kind: 'add', line: 21, text: 'new1' },
    { kind: 'add', line: 22, text: 'new2' },
    { kind: 'same', line: 23, text: 'tail' },
  ])
})

test('parseDiff ignores the file header and handles several hunks without context', () => {
  const text = ['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -1 +1 @@', '-a', '+b', '@@ -9,2 +9,2 @@', ' c', '+d'].join('\n')
  const rows = parseDiff(text)

  expect(rows[0]).toEqual({ kind: 'hunk', line: 1, context: '' })
  expect(rows.filter(r => r.kind === 'hunk')).toHaveLength(2)
  expect(rows[rows.length - 1]).toEqual({ kind: 'add', line: 10, text: 'd' })
})

test('parseDiff of empty text is empty', () => {
  expect(parseDiff('')).toEqual([])
})

test('an untracked file shows every line as an addition', async () => {
  const calls: Call[] = []
  const $ = answer(calls, { '/r/novo arquivo:ç.ts': 'a\nb\nc\n' }, false)

  const { text, more, isBinary } = await fileDiff($, '/r/novo arquivo:ç.ts')

  expect(isBinary).toBeFalsy()
  expect(more).toBe(0)
  const rows = parseDiff(text)
  expect(rows[0]).toEqual({ kind: 'hunk', line: 1, context: '' })
  expect(rows.slice(1)).toEqual([
    { kind: 'add', line: 1, text: 'a' },
    { kind: 'add', line: 2, text: 'b' },
    { kind: 'add', line: 3, text: 'c' },
  ])
})

test('an untracked binary file is flagged and has no text', async () => {
  const $ = answer([], { '/r/img.png': 'PNG\0\0data' }, false)

  expect(await fileDiff($, '/r/img.png')).toEqual({ text: '', more: 0, isBinary: true })
})

test('a long untracked file is cut at 300 lines and counts the rest', async () => {
  const body = Array.from({ length: 450 }, (_, i) => `l${i}`).join('\n')
  const $ = answer([], { '/r/big.ts': body }, false)

  const { text, more } = await fileDiff($, '/r/big.ts')

  expect(text.split('\n')).toHaveLength(300)
  expect(more).toBe(151)
})

test('a tracked file asks git with the path as its own argv entry after --', async () => {
  const calls: Call[] = []
  const $ = answer(calls, {}, true, '@@ -1 +1 @@\n-a\n+b\n')

  const { text, more } = await fileDiff($, '/r/com espaço:ã.ts')

  expect(parseDiff(text).map(r => r.kind)).toEqual(['hunk', 'del', 'add'])
  expect(more).toBe(0)
  const diffCall = calls.find(c => c.argv.includes('diff'))!
  expect(diffCall.argv).toContain('core.quotePath=false')
  expect(diffCall.argv.slice(-2)).toEqual(['--', '/r/com espaço:ã.ts'])
})

test('a tracked binary file is flagged', async () => {
  const $ = answer([], {}, true, 'Binary files a/x and b/x differ\n')

  expect(await fileDiff($, '/r/x.bin')).toEqual({ text: '', more: 0, isBinary: true })
})

test('a vanished untracked file gives an empty diff', async () => {
  const $ = answer([], {}, false)

  expect(await fileDiff($, '/r/gone.ts')).toEqual({ text: '', more: 0 })
})

test('parseDiff strips a trailing CR from the row text', () => {
  const rows = parseDiff('@@ -1,2 +1,2 @@\n-a\r\n+b\r\n same\r')

  expect(rows.slice(1).map(r => (r as { text: string }).text)).toEqual(['a', 'b', 'same'])
})

test('a deleted file whose directory is gone still shows its deletion, run from the repo root', async () => {
  const calls: Call[] = []
  const $ = answer(calls, {}, true, '@@ -1 +0,0 @@\n-x\n')

  const { text } = await fileDiff($, '/r/gone/dir/f.ts')

  expect(parseDiff(text).map(r => r.kind)).toEqual(['hunk', 'del'])
  expect(calls.find(c => c.argv.includes('diff'))!.argv.slice(0, 3)).toEqual(['git', '-C', '/r'])
  expect(calls.find(c => c.argv.includes('diff'))!.argv).toContain('--no-textconv')
})
