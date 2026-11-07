// Gera as imagens do README com a página e o desenhista reais. Uso: bun scripts/screenshots.ts
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseDiff } from '../hooks/core/diff'
import { pageOf, type PageModel } from '../hooks/page/page'

const OUT = join(import.meta.dir, '..', 'docs', 'img')
const WIDTH = 880
const HEIGHT = 700
const SCALE = 1.3
const NOW = Date.now()

const P = '/home/dev/meu-projeto'
const diffText = `@@ -12,6 +12,11 @@ export function saudacao(nome: string): string {
   const hora = new Date().getHours()
-  return \`Olá, \${nome}!\`
+  const periodo = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite'
+
+  return \`\${periodo}, \${nome}!\`
 }
 
 export function despedida(nome: string): string {`

const base: PageModel = {
  project: P,
  now: { kind: 'editing', abs: `${P}/src/app.tsx` },
  touched: [
    { abs: `${P}/src/app.tsx`, isEdited: true, isEditedThisTurn: true, at: NOW - 2_000, turn: 3 },
    { abs: `${P}/src/saudacao.ts`, isEdited: true, isEditedThisTurn: true, at: NOW - 60_000, turn: 3 },
    { abs: `${P}/README.md`, isEdited: true, isEditedThisTurn: true, at: NOW - 140_000, turn: 3 },
    { abs: `${P}/package.json`, isEdited: false, isEditedThisTurn: false, at: NOW - 200_000, turn: 3 },
  ],
  scope: 'turn',
  git: {
    root: P,
    branch: 'main',
    ahead: 2,
    lines: { [`${P}/src/app.tsx`]: [14, 3], [`${P}/src/saudacao.ts`]: [4, 1], [`${P}/README.md`]: [9, 0] },
  },
  openDiff: null,
  tree: null,
  editors: [
    { name: 'VS Code', cli: 'code' },
    { name: 'Cursor', cli: 'cursor' },
  ],
  hasFolderApp: true,
  showSizes: false,
  showHidden: false,
  seen: { [`${P}/README.md`]: NOW },
}

const withDiff: PageModel = { ...base, now: { kind: 'done', edited: [`${P}/src/app.tsx`, `${P}/src/saudacao.ts`, `${P}/README.md`], read: [`${P}/package.json`] }, openDiff: { abs: `${P}/src/saudacao.ts`, rows: parseDiff(diffText), more: 0 } }

const dir = (name: string, depth: number, isOpen: boolean) => ({ abs: `${P}/${name}`, name: name.split('/').pop()!, depth, isDir: true, isOpen })
const file = (name: string, depth: number) => ({ abs: `${P}/${name}`, name: name.split('/').pop()!, depth, isDir: false, isOpen: false })
const withTree: PageModel = {
  ...base,
  now: { kind: 'idle' },
  tree: [dir('src', 0, true), file('src/app.tsx', 1), file('src/saudacao.ts', 1), file('src/estilo.css', 1), dir('tests', 0, false), file('package.json', 0), file('README.md', 0), file('tsconfig.json', 0)],
}

const root = join(homedir(), '.cache', 'ms-playwright')
const call = (socket: string, path: string, body: unknown) =>
  new Promise<any>((resolve, reject) => {
    const req = request({ socketPath: socket, path, method: 'POST' }, res => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString())))
    })
    req.on('error', reject)
    req.end(JSON.stringify(body))
  })

import { homedir } from 'node:os'

if (!existsSync(root)) throw new Error('instale o Chromium: npx playwright install --only-shell chromium')

const dirTmp = mkdtempSync(join(tmpdir(), 'panel-shots-'))
const socket = join(dirTmp, 's.sock')
const server = spawn('node', [join(import.meta.dir, '..', 'renderer', 'server.mjs'), socket], { stdio: 'inherit' })
await new Promise(resolve => setTimeout(resolve, 800))

mkdirSync(OUT, { recursive: true })

const shoot = async (name: string, model: PageModel, hover?: string) => {
  const page = await call(socket, '/render', { html: pageOf(model), width: WIDTH, height: HEIGHT, scale: SCALE })
  const file = hover ? (await call(socket, '/hover', { act: hover, y: 0, height: HEIGHT, rev: page.rev })).file : page.file
  copyFileSync(file, join(OUT, `${name}.png`))
  console.log(name, page.height)
}

await shoot('panel-diff', withDiff)
await shoot('panel-hover', base, `file:${P}/src/saudacao.ts`)
await shoot('panel-arvore', withTree)

const bar = (width: number, color: string) => `<div style="height:24px;width:${width}px;border-radius:12px;background:${color}"></div>`
const line = (mark: string, width: number) => `<div style="display:flex;align-items:center;gap:22px"><div style="width:12px;height:44px;border-radius:6px;background:${mark}"></div>${bar(width, '#c9d1d9')}</div>`
const icon = `<body style="margin:0;width:512px;height:512px;background:#0d1117;display:grid;place-items:center"><div style="box-sizing:border-box;width:384px;height:416px;border:12px solid #30363d;border-radius:56px;background:#161b22;padding:40px 44px;display:flex;flex-direction:column;gap:24px"><div style="display:flex;align-items:center;gap:22px"><div style="width:40px;height:40px;border-radius:50%;background:#e8914f;box-shadow:0 0 28px #e8914f"></div>${bar(170, '#e6edf3')}</div>${line('#e8914f', 190)}${line('#e8914f', 150)}${line('#ad8cf2', 210)}${line('#ad8cf2', 120)}</div></body>`
const iconPage = await call(socket, '/render', { html: icon, width: 512, height: 512, scale: 1 })
mkdirSync(join(import.meta.dir, '..', '.claude-plugin'), { recursive: true })
copyFileSync(iconPage.file, join(import.meta.dir, '..', '.claude-plugin', 'icon.png'))

await call(socket, '/quit', {}).catch(() => {})
server.kill('SIGKILL')
rmSync(dirTmp, { recursive: true, force: true })
