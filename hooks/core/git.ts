import type { EngineInterface as Engine } from 'claude-code'

export type GitInfo = {
  root: string
  branch: string
  ahead: number | null
  lines: Record<string, [number, number]>
}

const GIT_TIMEOUT_MS = 10_000
const UNTRACKED_LINES_MAX = 10_000
const UNTRACKED_BYTES_MAX = 1_000_000
const BINARY_SNIFF = 8192
const EMPTY_TREE_FALLBACK = '4b825dc642cb6eb9a060e54bf8d69288fbd8e5f'

export async function git($: Engine, dir: string, args: string[]) {
  try {
    return await $.process.run(['git', '-C', dir, '-c', 'core.quotePath=false', ...args], {
      timeoutMs: GIT_TIMEOUT_MS,
    })
  } catch {
    return { exitCode: -1, stdout: '', stderr: '' }
  }
}

export const looksBinary = (text: string) => text.slice(0, BINARY_SNIFF).includes('\0')

export async function baseRef($: Engine, root: string): Promise<string> {
  const head = await git($, root, ['rev-parse', '--verify', '-q', 'HEAD'])
  if (head.exitCode === 0) return 'HEAD'

  const tree = await git($, root, ['hash-object', '-t', 'tree', '/dev/null'])

  return tree.exitCode === 0 && tree.stdout.trim() ? tree.stdout.trim() : EMPTY_TREE_FALLBACK
}

function parseNumstat(out: string, root: string, lines: GitInfo['lines']) {
  const fields = out.split('\0')
  for (let i = 0; i < fields.length; i++) {
    const [added, removed, ...rest] = fields[i].split('\t')
    if (rest.length === 0) continue

    let path = rest.join('\t')
    if (path === '') {
      path = fields[i + 2] ?? ''
      i += 2
    }
    if (added === '-' || removed === '-' || !path) continue

    lines[`${root}/${path}`] = [Number(added), Number(removed)]
  }
}

function parseStatus(out: string) {
  let branch = ''
  let ahead: number | null = null
  const untracked: string[] = []

  const entries = out.split('\0')
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (entry.startsWith('# branch.head ')) branch = entry.slice('# branch.head '.length)
    else if (entry.startsWith('# branch.ab ')) ahead = Number(/\+(\d+)/.exec(entry)?.[1] ?? NaN) || 0
    else if (entry.startsWith('? ')) untracked.push(entry.slice(2))
    else if (entry.startsWith('2 ')) i++
  }

  return { branch, ahead, untracked }
}

async function countLines($: Engine, abs: string): Promise<number | null> {
  try {
    const { size } = await $.fs.stat(abs)
    if (size > UNTRACKED_BYTES_MAX) return null

    const text = await $.fs.read(abs)
    if (looksBinary(text)) return null
    if (text === '') return 0

    let total = 0
    for (let at = text.indexOf('\n'); at !== -1 && total < UNTRACKED_LINES_MAX; at = text.indexOf('\n', at + 1)) total++
    if (total < UNTRACKED_LINES_MAX && !text.endsWith('\n')) total++

    return total
  } catch {
    return null
  }
}

export async function gitInfo($: Engine, cwd: string): Promise<GitInfo | null> {
  const top = await git($, cwd, ['rev-parse', '--show-toplevel'])
  const root = top.stdout.trim()
  if (top.exitCode !== 0 || !root) return null

  const [status, base] = await Promise.all([
    git($, root, ['status', '--porcelain=v2', '--branch', '--untracked-files=all', '-z']),
    baseRef($, root),
  ])
  const numstat = await git($, root, ['diff', '--no-ext-diff', '--no-textconv', '--numstat', '-z', base])

  const lines: GitInfo['lines'] = {}
  if (numstat.exitCode === 0) parseNumstat(numstat.stdout, root, lines)

  const parsed = parseStatus(status.stdout)
  for (const rel of parsed.untracked) {
    const abs = `${root}/${rel}`
    const count = await countLines($, abs)
    if (count !== null) lines[abs] = [count, 0]
  }

  return { root, branch: parsed.branch, ahead: parsed.ahead, lines }
}
