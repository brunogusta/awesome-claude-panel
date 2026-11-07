import type { EngineInterface as Engine } from 'claude-code'

import { fileDiff } from './diff'
import type { FileDiff } from './diff'
import { hasFolderApp } from './editors'
import { gitInfo } from './git'
import type { GitInfo } from './git'
import { treeRows } from './tree'
import type { TreeRow } from './tree'

let info: { cwd: string; value: GitInfo | null } | null = null
let generation = 0
let diffHeld: { key: string; value: FileDiff } | null = null
let treeHeld: { key: string; value: TreeRow[] } | null = null
let folderApp: boolean | null = null

export function forgetGit() {
  info = null
  generation += 1
}

export function resetCache() {
  forgetGit()
  diffHeld = null
  treeHeld = null
  folderApp = null
}

export async function cachedGit($: Engine, cwd: string): Promise<GitInfo | null> {
  for (;;) {
    if (info?.cwd === cwd) return info.value

    const born = generation
    const value = await gitInfo($, cwd).catch(() => null)

    if (born === generation) {
      info = { cwd, value }

      return value
    }
  }
}

export async function cachedDiff($: Engine, abs: string): Promise<FileDiff> {
  for (;;) {
    const born = generation
    const key = `${born}\n${abs}`
    if (diffHeld?.key === key) return diffHeld.value

    const value = await fileDiff($, abs)

    if (born === generation) {
      diffHeld = { key, value }

      return value
    }
  }
}

export async function cachedTree(
  $: Engine,
  root: string,
  open: string[],
  hidden: boolean,
  sizes: boolean,
): Promise<TreeRow[]> {
  for (;;) {
    const born = generation
    const key = JSON.stringify([born, root, open, hidden, sizes])
    if (treeHeld?.key === key) return treeHeld.value

    const value = await treeRows($, root, open, hidden, sizes)

    if (born === generation) {
      treeHeld = { key, value }

      return value
    }
  }
}

export async function cachedFolderApp($: Engine): Promise<boolean> {
  folderApp ??= await hasFolderApp($)

  return folderApp
}
