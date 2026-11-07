#!/usr/bin/env node
// Confere os requisitos do painel nesta máquina. Uso: node scripts/doctor.mjs [--json]
import { execFileSync } from 'node:child_process'
import { accessSync, constants, existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const MIN_NODE = 22
const MIN_CLAUDE = [2, 1, 316]
const isJson = process.argv.includes('--json')

const run = (command, args) => {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000 }).trim()
  } catch (error) {
    return error.code === 'ENOENT' ? null : `${error.stdout ?? ''}${error.stderr ?? ''}`.trim() || ''
  }
}

const results = []
const check = (id, status, message, fix = '') => results.push({ id, status, message, fix: status === 'ok' ? '' : fix })

const isWsl = process.platform === 'linux' && /microsoft/i.test(run('uname', ['-r']) ?? '')

if (process.platform === 'linux') check('so', 'ok', isWsl ? 'Linux dentro do WSL2' : 'Linux')
else if (process.platform === 'darwin') check('so', 'fail', 'macOS ainda não é suportado (o painel usa /dev/shm e o cache do Playwright do Linux)')
else check('so', 'fail', 'Windows nativo não é suportado', 'Instale o WSL2 e rode tudo dentro dele (veja o README, "Windows")')

const nodeMajor = Number(process.versions.node.split('.')[0])
check('node', nodeMajor >= MIN_NODE ? 'ok' : 'fail', `Node ${process.versions.node}`, nodeMajor >= MIN_NODE ? '' : `Instale o Node ${MIN_NODE} ou mais novo (nvm install ${MIN_NODE})`)

check('git', run('git', ['--version']) ? 'ok' : 'fail', run('git', ['--version']) ?? 'git não encontrado', 'sudo apt install -y git')

const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), '.cache', 'ms-playwright')
let chrome = null
if (existsSync(browsers)) {
  const builds = readdirSync(browsers)
    .filter(name => name.startsWith('chromium_headless_shell-'))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))

  for (const build of builds) {
    for (const dir of ['chrome-headless-shell-linux64', 'chrome-linux64']) {
      const exe = join(browsers, build, dir, 'chrome-headless-shell')
      if (!chrome && existsSync(exe)) chrome = exe
    }
  }
}

if (!chrome) check('chromium', 'fail', `Chromium headless não encontrado em ${browsers}`, 'npx --yes playwright install --only-shell chromium')
else {
  const missing = (run('ldd', [chrome]) ?? '').split('\n').filter(line => line.includes('not found')).map(line => line.trim().split(' ')[0])

  if (missing.length > 0) check('chromium', 'fail', `Chromium encontrado, mas faltam bibliotecas: ${missing.join(', ')}`, 'sudo npx --yes playwright install-deps chromium')
  else check('chromium', 'ok', `Chromium headless: ${chrome}`)
}

try {
  accessSync('/dev/shm', constants.W_OK)
  check('shm', 'ok', '/dev/shm gravável')
} catch {
  check('shm', 'fail', '/dev/shm não está gravável', 'O painel guarda as imagens em /dev/shm')
}

const term = `${process.env.TERM ?? ''} ${process.env.TERM_PROGRAM ?? ''}`
const hasGraphicsTerminal = /ghostty|kitty/i.test(term) || Boolean(process.env.GHOSTTY_RESOURCES_DIR) || Boolean(process.env.KITTY_WINDOW_ID)
check('terminal', hasGraphicsTerminal ? 'ok' : 'fail', hasGraphicsTerminal ? `Terminal com protocolo gráfico (${term.trim()})` : `Terminal sem Ghostty/kitty (TERM=${process.env.TERM ?? '?'})`, hasGraphicsTerminal ? '' : 'Abra o Claude Code dentro do Ghostty ou do kitty')
if (process.env.TMUX) check('tmux', 'warn', 'Dentro do tmux o painel mostra só um aviso', 'Rode o Claude Code fora do tmux')

const claudeText = run('claude', ['--version'])
const claude = claudeText?.match(/(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number)
if (!claude) check('claude', 'fail', 'Claude Code não encontrado', 'curl -fsSL https://claude.ai/install.sh | bash')
else {
  const isNew = claude[0] !== MIN_CLAUDE[0] ? claude[0] > MIN_CLAUDE[0] : claude[1] !== MIN_CLAUDE[1] ? claude[1] > MIN_CLAUDE[1] : claude[2] >= MIN_CLAUDE[2]
  check('claude', isNew ? 'ok' : 'fail', `Claude Code ${claude.join('.')}`, isNew ? '' : `Atualize para ${MIN_CLAUDE.join('.')} ou mais novo (claude update)`)

  const listed = run('claude', ['plugin', 'list'])
  if (listed !== null) check('plugin', /panel@brunogusta/.test(listed) ? 'ok' : 'warn', /panel@brunogusta/.test(listed) ? 'Plugin panel instalado' : 'Plugin panel ainda não instalado', 'claude plugin marketplace add brunogusta/awesome-claude-panel && claude plugin install panel@brunogusta')
}

const failed = results.filter(one => one.status === 'fail')

if (isJson) console.log(JSON.stringify({ ok: failed.length === 0, results }, null, 2))
else {
  const mark = { ok: '✔', warn: '⚠', fail: '✘' }
  for (const one of results) console.log(`${mark[one.status]} ${one.message}${one.fix ? `\n    → ${one.fix}` : ''}`)
  console.log(failed.length === 0 ? '\nTudo pronto: abra o Claude Code e rode /panel.' : `\n${failed.length} requisito(s) faltando.`)
}

process.exit(failed.length === 0 ? 0 : 1)
