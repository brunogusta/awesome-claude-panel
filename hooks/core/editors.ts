import type { EngineInterface as Engine } from 'claude-code'

export type Editor = { name: string; cli: string }

const OPEN_TIMEOUT_MS = 60_000
const PROBE_TIMEOUT_MS = 5_000

const CANDIDATES = [
  { name: 'VS Code', cli: 'code', app: 'Visual Studio Code' },
  { name: 'Cursor', cli: 'cursor', app: 'Cursor' },
  { name: 'Windsurf', cli: 'windsurf', app: 'Windsurf' },
  { name: 'Zed', cli: 'zed', app: 'Zed' },
  { name: 'Sublime Text', cli: 'subl', app: 'Sublime Text' },
]

let cache: Editor[] | null = null

export const resetEditorsCache = () => {
  cache = null
}

async function run($: Engine, argv: string[], timeoutMs = PROBE_TIMEOUT_MS) {
  try {
    return await $.process.run(argv, { timeoutMs })
  } catch {
    return { exitCode: -1, stdout: '', stderr: '' }
  }
}

async function isMac($: Engine) {
  const r = await run($, ['uname', '-s'])
  return r.exitCode === 0 && r.stdout.trim() === 'Darwin'
}

export async function findEditors($: Engine): Promise<Editor[]> {
  if (cache) return cache
  const mac = await isMac($)
  const found: Editor[] = []

  for (const c of CANDIDATES) {
    if (mac) {
      const r = await run($, ['open', '-Ra', c.app])
      if (r.exitCode === 0) found.push({ name: c.name, cli: c.app })
    } else {
      const r = await run($, ['which', c.cli])
      if (r.exitCode === 0 && !r.stdout.includes(':')) found.push({ name: c.name, cli: c.cli })
    }
  }

  cache = found.filter((e) => !e.cli.includes(':'))
  return cache
}

export async function openInEditor($: Engine, editor: Editor, abs: string): Promise<boolean> {
  const argv = (await isMac($)) ? ['open', '-a', editor.cli, abs] : [editor.cli, abs]
  return (await run($, argv, OPEN_TIMEOUT_MS)).exitCode === 0
}

const dirOf = (abs: string) => abs.slice(0, abs.lastIndexOf('/')) || '/'

async function folderMode($: Engine): Promise<'wsl' | 'mac' | 'linux'> {
  if (await $.env.get('WSL_DISTRO_NAME')) return 'wsl'
  return (await isMac($)) ? 'mac' : 'linux'
}

export async function hasFolderApp($: Engine): Promise<boolean> {
  const mode = await folderMode($)
  if (mode !== 'linux') return true
  return (await run($, ['which', 'xdg-open'])).exitCode === 0
}

export async function showInFolder($: Engine, abs: string): Promise<boolean> {
  const mode = await folderMode($)
  if (mode === 'wsl') {
    // explorer.exe devolve 1 mesmo quando abre a janela
    const r = await run($, ['sh', '-c', 'explorer.exe /select,"$(wslpath -w "$1")"; exit 0', 'sh', abs], OPEN_TIMEOUT_MS)
    return r.exitCode === 0
  }
  const argv = mode === 'mac' ? ['open', '-R', abs] : ['xdg-open', dirOf(abs)]
  return (await run($, argv, OPEN_TIMEOUT_MS)).exitCode === 0
}
