import type { EngineInterface as Engine } from 'claude-code'

export type TreeRow = { abs: string; name: string; depth: number; isDir: boolean; isOpen: boolean; size?: number }

const ROWS_MAX = 2_000

const byName = (a: string, b: string) => a.localeCompare(b, 'pt', { sensitivity: 'base', numeric: true })

const join = (dir: string, name: string) => (dir.endsWith('/') ? dir + name : `${dir}/${name}`)

export async function treeRows(
  $: Engine,
  root: string,
  expanded: string[],
  showHidden: boolean,
  showSizes: boolean,
): Promise<TreeRow[]> {
  const open = new Set(expanded)
  const rows: TreeRow[] = []

  const walk = async (dir: string, depth: number) => {
    let entries
    try {
      entries = await $.fs.list(dir)
    } catch {
      return
    }
    const visible = entries.filter((e) => e.name !== '.git' && (showHidden || !e.name.startsWith('.')))
    const dirs = visible.filter((e) => e.kind === 'dir').sort((a, b) => byName(a.name, b.name))
    const files = visible.filter((e) => e.kind !== 'dir').sort((a, b) => byName(a.name, b.name))

    for (const e of [...dirs, ...files]) {
      if (rows.length >= ROWS_MAX) return
      const abs = join(dir, e.name)
      const isDir = e.kind === 'dir'
      const isOpen = isDir && open.has(abs)
      const row: TreeRow = { abs, name: e.name, depth, isDir, isOpen }
      if (showSizes && !isDir) row.size = e.size
      rows.push(row)
      if (isOpen) await walk(abs, depth + 1)
    }
  }

  await walk(root, 0)
  return rows
}
