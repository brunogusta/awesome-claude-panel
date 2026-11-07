import { expect, test } from 'claude-code/testing'

import { now, scope, touched, turn } from '../hooks/core/state'
import { visibleTouched } from '../hooks/core/activity'

const CWD = '/home/u/proj'

const store = new Map<string, { value: unknown; version: number }>()
const key = (e: any) => `${e.plugin}/${e.key}/${e.id ?? ''}`

const read = async (_: unknown, a: { ref: { key: string } }) => {
  const held: any = store.get(`panel/${a.ref.key}/`)?.value
  return held === undefined ? (a as any).initial : held.value !== undefined && held.shape ? held.value : held
}

const boot = async ($: any, on: any) => {
  store.clear()
  on('state.get', (_: any, e: any) => ({ value: store.get(key(e)) ?? { value: undefined, version: 0 } }))
  on('state.set', (_: any, e: any) => {
    const version = (store.get(key(e))?.version ?? 0) + 1
    store.set(key(e), { value: e.value, version })
    return { value: { isSet: true, version } }
  })
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: CWD }))
  on('tool.call', () => ({ result: {} }))
  on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
}

const complete = ($: any, turnId: string) =>
  $.turn.complete({ turnId, answer: '', durationMs: 1, isAborted: false, reason: 'answer' })

test('a relative Read becomes an absolute, unedited Touch', async ($, on) => {
  await boot($, on)
  await $.tool.call({ tool: 'Read', file_path: 'src/a b:c.ts' })

  const list = await read($, touched)
  expect(list).toHaveLength(1)
  expect(list[0]).toMatchObject({ abs: '/home/u/proj/src/a b:c.ts', isEdited: false })
  expect((await read($, now)).kind).toBe('reading')
})

test('absolute paths are normalized, accents and spaces untouched', async ($, on) => {
  await boot($, on)
  await $.tool.call({ tool: 'Read', file_path: '/home/u/proj/./src/../ação nova/x.ts/' })

  expect((await read($, touched))[0].abs).toBe('/home/u/proj/ação nova/x.ts')
})

test('Edit, Write, MultiEdit and NotebookEdit mark the file edited', async ($, on) => {
  await boot($, on)
  await $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'x', new_string: 'y' })
  await $.tool.call({ tool: 'Write', file_path: 'b.ts', content: '' })
  await $.tool.call({ tool: 'MultiEdit', file_path: 'c.ts', edits: [] })
  await $.tool.call({ tool: 'NotebookEdit', notebook_path: 'd.ipynb', new_source: '' })

  const list = await read($, touched)
  expect(list.map(t => t.abs)).toEqual([
    '/home/u/proj/a.ts',
    '/home/u/proj/b.ts',
    '/home/u/proj/c.ts',
    '/home/u/proj/d.ipynb',
  ])
  expect(list.every(t => t.isEdited)).toBe(true)
  expect(await read($, now)).toEqual({ kind: 'editing', abs: '/home/u/proj/d.ipynb' })
})

test('Grep and Glob are not tracked', async ($, on) => {
  await boot($, on)
  await $.tool.call({ tool: 'Grep', pattern: 'x' })
  await $.tool.call({ tool: 'Glob', pattern: '*.ts' })

  expect(await read($, touched)).toEqual([])
  expect(await read($, now)).toEqual({ kind: 'running', title: 'Usando Glob', detail: '' })
})

test('a file read and then edited shows once, edited, with a newer at', async ($, on) => {
  await boot($, on)
  await $.tool.call({ tool: 'Read', file_path: 'a.ts' })
  const first = (await read($, touched))[0].at
  await new Promise(r => setTimeout(r, 5))
  await $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'x', new_string: 'y' })
  await $.tool.call({ tool: 'Read', file_path: 'a.ts' })

  const list = await read($, touched)
  expect(list).toHaveLength(1)
  expect(list[0].isEdited).toBe(true)
  expect(list[0].at).toBeGreaterThan(first)
})

test('Bash becomes running with the first line of the command', async ($, on) => {
  await boot($, on)
  await $.tool.call({ tool: 'Bash', command: 'git status\necho hi' })
  expect(await read($, now)).toEqual({
    kind: 'running',
    title: 'Rodando um comando',
    detail: 'git status',
  })

  await $.tool.call({ tool: 'Bash', command: 'x'.repeat(300) })
  const n = await read($, now)
  expect(n.kind === 'running' && n.detail.length).toBe(120)
})

test('turn.start sets thinking and bumps the turn; turn.complete is done with that turn lists', async ($, on) => {
  await boot($, on)
  await $.turn.start({ text: 'oi', turnId: 't1' })
  expect(await read($, now)).toEqual({ kind: 'thinking' })
  expect(await read($, turn)).toBe(1)

  await $.tool.call({ tool: 'Read', file_path: 'r.ts' })
  await $.tool.call({ tool: 'Edit', file_path: 'e.ts', old_string: 'x', new_string: 'y' })
  await complete($, 't1')
  expect(await read($, now)).toEqual({
    kind: 'done',
    edited: ['/home/u/proj/e.ts'],
    read: ['/home/u/proj/r.ts'],
  })

  await $.turn.start({ text: 'de novo', turnId: 't2' })
  expect(await read($, turn)).toBe(2)
  await $.tool.call({ tool: 'Read', file_path: 'z.ts' })
  await complete($, 't2')
  expect(await read($, now)).toEqual({ kind: 'done', edited: [], read: ['/home/u/proj/z.ts'] })
})

test('scope turn shows only the current turn, session shows all', async ($, on) => {
  await boot($, on)
  await $.turn.start({ text: 'a', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: 'old.ts' })
  await $.turn.start({ text: 'b', turnId: 't2' })
  await $.tool.call({ tool: 'Read', file_path: 'new.ts' })

  const list = await read($, touched)
  const current = await read($, turn)
  expect(await read($, scope)).toBe('turn')
  expect(visibleTouched(list, 'turn', current).map(t => t.abs)).toEqual(['/home/u/proj/new.ts'])
  expect(visibleTouched(list, 'session', current)).toHaveLength(2)
})

test('re-touching moves a file to the end and refreshes at', async ($, on) => {
  await boot($, on)
  await $.tool.call({ tool: 'Read', file_path: 'a.ts' })
  const first = (await read($, touched))[0].at
  await $.tool.call({ tool: 'Read', file_path: 'b.ts' })
  await new Promise(r => setTimeout(r, 5))
  await $.tool.call({ tool: 'Read', file_path: 'a.ts' })

  const list = await read($, touched)
  expect(list.map(t => t.abs)).toEqual(['/home/u/proj/b.ts', '/home/u/proj/a.ts'])
  expect(list[1].at).toBeGreaterThan(first)
})

test('edited in an earlier turn and only read now: sticky edited, not edited this turn', async ($, on) => {
  await boot($, on)
  await $.turn.start({ text: 'a', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: 'a.ts', old_string: 'x', new_string: 'y' })
  await complete($, 't1')
  await $.turn.start({ text: 'b', turnId: 't2' })
  await $.tool.call({ tool: 'Read', file_path: 'a.ts' })
  await complete($, 't2')

  expect((await read($, touched))[0]).toMatchObject({ isEdited: true, isEditedThisTurn: false, turn: 2 })
  expect(await read($, now)).toEqual({ kind: 'done', edited: [], read: ['/home/u/proj/a.ts'] })
})

test('Windows absolute paths are not prefixed with the cwd', async ($, on) => {
  await boot($, on)
  await $.tool.call({ tool: 'Read', file_path: 'C:\\Users\\u\\a.ts' })
  await $.tool.call({ tool: 'Read', file_path: 'D:/x/b.ts' })

  expect((await read($, touched)).map(t => t.abs)).toEqual(['C:\\Users\\u\\a.ts', 'D:/x/b.ts'])
})

test('the Bash command is trimmed before its first line is taken', async ($, on) => {
  await boot($, on)
  await $.tool.call({ tool: 'Bash', command: '\n  ls -la\necho' })

  expect(await read($, now)).toMatchObject({ detail: 'ls -la' })
})
