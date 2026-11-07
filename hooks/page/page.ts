import type { Now, Scope, Touch } from '../../types'
import type { DiffRow } from '../core/diff'
import type { Editor } from '../core/editors'
import type { GitInfo } from '../core/git'
import type { TreeRow } from '../core/tree'
import { baseOf, dirOf, esc, plural, sizeOf, timeOf, whereOf } from './format'
import { iconFor } from './icons'
import { STYLE } from './style'

export type PageModel = {
  project: string
  now: Now
  touched: Touch[]
  scope: Scope
  git: GitInfo | null
  openDiff: { abs: string; rows: DiffRow[]; more: number; isBinary?: boolean } | null
  tree: TreeRow[] | null
  editors: Editor[]
  hasFolderApp: boolean
  showSizes: boolean
  showHidden: boolean
  seen?: Record<string, number>
}

const READ = '#ad8cf2'
const EDIT = '#e8914f'
const DONE = '#3fb950'
const TOOL = '#58a6ff'
const MUTED = '#7d8590'

const MAX_DIFF_LINES = 300
const MAX_LIST = 40
const MAX_TREE = 200
const PAGE_BUDGET_PX = 8000
const FIXED_PX = 400
const ROW_PX = 36
const LN_PX = 20
const HUNK_PX = 28
const DIFF_FRAME_PX = 90
const TREE_ROW_PX = 36
const RECENT_MS = 60_000

const BRANCH_ICON =
  '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="4.5" cy="3.5" r="1.7"/><circle cx="4.5" cy="12.5" r="1.7"/><circle cx="11.5" cy="5.5" r="1.7"/><path d="M4.5 5.2v5.6M11.5 7.2c0 2.6-3.2 2.2-6 4"/></svg>'
const EXTERNAL_ICON =
  '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2h5v5M14 2 7 9M12 9v4.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5H7"/></svg>'
const FOLDER_LINE_ICON =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1.5 4.5a1 1 0 0 1 1-1h3.5l1.5 1.5h6a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z"/></svg>'
const chevron = (isOpen: boolean) =>
  `<svg class="chev" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${isOpen ? '<path d="M3 4.5 6 7.5 9 4.5"/>' : '<path d="M4.5 3 7.5 6 4.5 9"/>'}</svg>`

const chip = (act: string, label: string, isOn = false) => `<span class="chip${isOn ? ' on' : ''}" data-act="${esc(act)}">${esc(label)}</span>`

const countsOf = (git: GitInfo | null, abs: string) => {
  const pair = git?.lines[abs]

  return pair ? `<span class="cnt"><span class="p">+${pair[0]}</span><span class="m">−${pair[1]}</span></span>` : ''
}

const stampOf = (at: number) => (Math.max(0, Date.now() - at) < RECENT_MS ? 'agora' : timeOf(at))

const isMarked = (touch: Touch, scope: Scope) => (scope === 'turn' ? touch.isEditedThisTurn : touch.isEdited)

function nowOf(model: PageModel) {
  const { now, project } = model
  const make = (color: string, title: string, sub: string, isMono = false) =>
    `<div class="now"><span class="dot" style="background:${color}"></span><div class="body"><div class="kick">Agora</div><div class="title">${esc(title)}</div>${
      sub ? `<div class="sub${isMono ? ' mono' : ''}">${esc(sub)}</div>` : ''
    }<div class="legend"><span style="color:${READ}">● Claude leu</span><span style="color:${EDIT}">● Claude editou</span></div></div></div>`
  const inDir = (abs: string) => `em ${whereOf(dirOf(abs), project) || baseOf(project)}`

  switch (now.kind) {
    case 'idle':
      return make(MUTED, 'Aguardando', `em ${baseOf(project)}`)
    case 'thinking':
      return make(MUTED, 'Pensando', `em ${baseOf(project)}`)
    case 'reading':
      return make(READ, `Lendo ${baseOf(now.abs)}`, inDir(now.abs))
    case 'editing':
      return make(EDIT, `Editando ${baseOf(now.abs)}`, inDir(now.abs))
    case 'running':
      return make(TOOL, now.title, now.detail, Boolean(now.detail))
    case 'done': {
      const count = now.edited.length

      return make(DONE, `Pronto · Claude editou ${count === 0 ? 'nenhum arquivo' : plural(count, 'arquivo')}`, '')
    }
  }
}

function diffOf(rows: DiffRow[], more: number, budgetPx: number) {
  let lines = 0
  let px = DIFF_FRAME_PX
  let hidden = more
  let html = ''
  let isFull = false

  for (const row of rows) {
    const cost = row.kind === 'hunk' ? HUNK_PX : LN_PX

    if (!isFull && lines >= MAX_DIFF_LINES) isFull = true
    if (!isFull && px + cost + HUNK_PX > budgetPx) isFull = true

    if (isFull) {
      if (row.kind !== 'hunk') hidden++
      continue
    }

    px += cost

    if (row.kind === 'hunk') {
      html += `<div class="hunk">@@ linha ${row.line}${row.context ? ` · ${esc(row.context)}` : ''}</div>`
      continue
    }

    lines++

    const cls = row.kind === 'add' ? ' a' : row.kind === 'del' ? ' d' : ''
    const sign = row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ''

    html += `<div class="ln${cls}"><span class="n">${row.line}</span><span class="s">${sign}</span><code>${esc(row.text)}</code></div>`
  }

  if (hidden > 0) {
    html += `<div class="more">+${hidden} linhas não mostradas</div>`
    px += HUNK_PX
  }

  return { html: `<div class="diff">${html}</div>`, px }
}

const binaryOf = () => ({ html: '<div class="diff"><div class="more">arquivo binário</div></div>', px: DIFF_FRAME_PX })

function blockOf(model: PageModel, budgetPx: number) {
  const open = model.openDiff

  if (!open) return null

  return open.isBinary ? binaryOf() : diffOf(open.rows, open.more, budgetPx)
}

function actionsOf(model: PageModel, abs: string) {
  const open = model.editors.map(
    (editor, i) =>
      `<span class="btn${i === 0 ? ' pri' : ''}" data-act="${esc(`open:${editor.cli}:${abs}`)}">${i === 0 ? EXTERNAL_ICON : ''}Abrir no ${esc(editor.name)}</span>`,
  )
  const rest = [
    `<span class="btn" data-act="${esc(`copy:${abs}`)}">Copiar caminho</span>`,
    `<span class="btn" data-act="${esc(`mention:${abs}`)}">@ Mencionar</span>`,
    ...(model.hasFolderApp ? [`<span class="btn" data-act="${esc(`folder:${abs}`)}">Mostrar na pasta</span>`] : []),
  ]

  return `<div class="acts">${[...open, ...rest].join('')}</div>`
}

type Plan = { list: number; diffBudget: number; tree: number }

const listPxOf = (count: number, list: number) => (list + (count > list ? 1 : 0) || 1) * ROW_PX

function planOf(model: PageModel): Plan {
  const count = model.touched.length
  const list = Math.min(count, MAX_LIST)
  const listPx = listPxOf(count, list)
  const diffBudget = model.openDiff ? PAGE_BUDGET_PX - FIXED_PX - listPx - 2 * ROW_PX : 0
  const diffPx = model.openDiff ? (blockOf(model, diffBudget)?.px ?? 0) : 0
  const left = PAGE_BUDGET_PX - FIXED_PX - listPx - (model.openDiff ? ROW_PX : 0) - diffPx - ROW_PX
  const tree = model.tree ? Math.max(0, Math.min(MAX_TREE, model.tree.length, Math.floor(left / TREE_ROW_PX))) : 0

  return { list, diffBudget, tree }
}

export function estimateHeight(model: PageModel): number {
  const plan = planOf(model)
  const listPx = listPxOf(model.touched.length, plan.list)
  const diffPx = model.openDiff ? (blockOf(model, plan.diffBudget)?.px ?? 0) + ROW_PX : 0
  const treeRows = model.tree ? plan.tree + (model.tree.length > plan.tree ? 1 : 0) : 0

  return FIXED_PX + listPx + diffPx + treeRows * TREE_ROW_PX
}

export function pageOf(model: PageModel): string {
  const { project, git, openDiff } = model
  const plan = planOf(model)
  const diffBlock = openDiff ? blockOf(model, plan.diffBudget) : null
  let isPlaced = false
  const below = (abs: string) => {
    if (isPlaced || !openDiff || !diffBlock || openDiff.abs !== abs) return ''

    isPlaced = true

    return diffBlock.html + actionsOf(model, abs)
  }

  const live = model.now.kind === 'editing' || model.now.kind === 'reading' ? model.now : null
  const isUnseen = (abs: string) => model.touched.some(one => one.abs === abs && one.isEdited && one.at > (model.seen?.[abs] ?? 0))

  const fileRow = (abs: string, dirText: string, extra: string, mark = '') => {
    const isLive = live?.abs === abs
    const liveClass = isLive ? (live.kind === 'editing' ? ' live-edit' : ' live-read') : ''
    const tag = isLive ? (live.kind === 'editing' ? '<span class="livetag e">editando</span>' : '<span class="livetag r">lendo</span>') : ''
    const dot = isUnseen(abs) ? '<span class="newdot"></span>' : ''

    return `<div class="file${openDiff?.abs === abs ? ' on' : ''}${liveClass}" data-act="${esc(`file:${abs}`)}">${mark}<span class="ico">${iconFor(baseOf(abs), false, false)}</span><span class="name">${esc(baseOf(abs))}</span>${dot}${tag}<span class="dir">${esc(dirText)}</span>${extra}</div>${below(abs)}`
  }

  const touched = [...model.touched].sort((a, b) => Number(b.abs === live?.abs) - Number(a.abs === live?.abs) || b.at - a.at)
  const shown = touched.slice(0, plan.list)

  const markOf = (one: Touch) => `<span class="mark" style="background:${isMarked(one, model.scope) ? EDIT : READ}"></span>`

  const rowsHtml = shown.map(one => {
    return fileRow(one.abs, whereOf(dirOf(one.abs), project), isMarked(one, model.scope) ? countsOf(git, one.abs) : '', markOf(one))
  })

  if (touched.length > shown.length) rowsHtml.push(`<div class="rest">+${touched.length - shown.length} arquivos</div>`)

  const top = `<div class="top"><span class="proj">${esc(baseOf(project))}</span>${
    git ? `<span class="branch">${BRANCH_ICON}${esc(git.branch)}${git.ahead ? `<span class="up">↑${git.ahead}</span>` : ''}</span>` : ''
  }</div>`

  const bar = `<div class="bar">${chip('refresh', 'Atualizar')}${chip('collapse', 'Recolher')}${chip('sizes', 'Tamanhos', model.showSizes)}${chip('hidden', 'Arquivos ocultos', model.showHidden)}${chip('scope', model.scope === 'session' ? 'Sessão inteira' : 'Este turno', model.scope === 'session')}</div>`


  let tree: string

  if (model.tree === null) {
    tree = `<div class="tree" data-act="tree">${FOLDER_LINE_ICON}<span>Árvore do projeto</span><span class="open">abrir</span></div>`
  } else {
    const rows = model.tree.slice(0, plan.tree).map(row => {
      const pad = `style="padding-left:${9 + row.depth * 14}px"`
      const size = model.showSizes && !row.isDir && row.size !== undefined ? `<span class="size">${sizeOf(row.size)}</span>` : ''

      if (row.isDir) {
        return `<div class="file" ${pad} data-act="${esc(`dir:${row.abs}`)}">${chevron(row.isOpen)}<span class="ico">${iconFor(row.name, true, row.isOpen)}</span><span class="name">${esc(row.name)}</span><span class="dir"></span></div>`
      }

      return `<div class="file${openDiff?.abs === row.abs ? ' on' : ''}" ${pad} data-act="${esc(`file:${row.abs}`)}"><span class="ico">${iconFor(row.name, false, false)}</span><span class="name">${esc(row.name)}</span><span class="dir"></span>${size}</div>${below(row.abs)}`
    })

    if (model.tree.length > plan.tree) rows.push(`<div class="rest">+${model.tree.length - plan.tree} itens</div>`)

    tree = `<div class="sec"><span class="kick">Árvore do projeto</span><span class="pill" data-act="tree">fechar</span></div><div class="list">${rows.join('')}</div>`
  }

  if (!isPlaced && openDiff) {
    const own = touched.find(one => one.abs === openDiff.abs)

    rowsHtml.push(
      fileRow(openDiff.abs, whereOf(dirOf(openDiff.abs), project), own && isMarked(own, model.scope) ? countsOf(git, own.abs) : '', own ? markOf(own) : ''),
    )
  }


    const list = `<div class="sec"><span class="kick">Claude mexeu</span><span class="pill">${plural(touched.length, 'arquivo')}${touched[0] ? ` · ${stampOf(touched[0].at)}` : ''}</span></div><div class="list">${rowsHtml.join('') || '<div class="empty">Nada mexido ainda</div>'}</div>`

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><style>${STYLE}</style></head><body>${top}${nowOf(model)}${bar}${list}${tree}</body></html>`
}
