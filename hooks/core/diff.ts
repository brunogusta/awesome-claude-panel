import type { EngineInterface as Engine } from 'claude-code'

import { baseRef, git, looksBinary } from './git'

export type DiffRow =
  | { kind: 'hunk'; line: number; context: string }
  | { kind: 'add' | 'del' | 'same'; line: number; text: string }

export type FileDiff = { text: string; more: number; isBinary?: boolean }

const DIFF_LINES_MAX = 300
const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/

const cut = (text: string): FileDiff => {
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  if (lines.length <= DIFF_LINES_MAX) return { text: lines.join('\n'), more: 0 }

  return { text: lines.slice(0, DIFF_LINES_MAX).join('\n'), more: lines.length - DIFF_LINES_MAX }
}

const dirOf = (abs: string) => abs.slice(0, abs.lastIndexOf('/')) || '/'

async function untrackedDiff($: Engine, abs: string): Promise<FileDiff> {
  let content: string
  try {
    content = await $.fs.read(abs)
  } catch {
    return { text: '', more: 0 }
  }
  if (looksBinary(content)) return { text: '', more: 0, isBinary: true }
  if (content === '') return { text: '', more: 0 }

  const lines = content.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()

  return cut([`@@ -0,0 +1,${lines.length} @@`, ...lines.map(l => `+${l}`)].join('\n'))
}

async function repoRootOf($: Engine, abs: string): Promise<string | null> {
  let dir = dirOf(abs)
  while (dir !== '/' && !(await $.fs.exists(dir))) dir = dirOf(dir)

  const top = await git($, dir, ['rev-parse', '--show-toplevel'])

  return top.exitCode === 0 && top.stdout.trim() ? top.stdout.trim() : null
}

export async function fileDiff($: Engine, abs: string): Promise<FileDiff> {
  const root = await repoRootOf($, abs)
  if (!root) return untrackedDiff($, abs)

  const tracked = await git($, root, ['ls-files', '--error-unmatch', '--', abs])
  if (tracked.exitCode !== 0) return untrackedDiff($, abs)

  const base = await baseRef($, root)
  const out = await git($, root, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', '-U3', base, '--', abs])
  if (/^Binary files .* differ$/m.test(out.stdout)) return { text: '', more: 0, isBinary: true }

  return cut(out.stdout)
}

export function parseDiff(text: string): DiffRow[] {
  const rows: DiffRow[] = []
  let oldLine = 0
  let newLine = 0
  let inHunk = false

  for (const raw of text.split('\n')) {
    const hunk = HUNK.exec(raw)
    if (hunk) {
      oldLine = Number(hunk[1])
      newLine = Number(hunk[2])
      inHunk = true
      rows.push({ kind: 'hunk', line: newLine, context: hunk[3] })
      continue
    }
    if (!inHunk || raw.startsWith('\\')) continue
    if (raw.startsWith('diff --git')) {
      inHunk = false
      continue
    }

    const body = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    const mark = body[0]
    if (mark === '+') rows.push({ kind: 'add', line: newLine++, text: body.slice(1) })
    else if (mark === '-') rows.push({ kind: 'del', line: oldLine++, text: body.slice(1) })
    else if (mark === ' ' || raw === '') rows.push({ kind: 'same', line: (oldLine++, newLine++), text: body.slice(1) })
  }

  return rows
}
