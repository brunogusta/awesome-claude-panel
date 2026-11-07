import { expect, test } from 'claude-code/testing'

import { estimateHeight, pageOf, type PageModel } from '../hooks/page/page'

const model = (over: Partial<PageModel> = {}): PageModel => ({
  project: '/proj',
  now: { kind: 'idle' },
  touched: [],
  scope: 'session',
  git: null,
  openDiff: null,
  tree: null,
  editors: [{ name: 'VS Code', cli: 'code' }],
  hasFolderApp: false,
  showSizes: false,
  showHidden: false,
  ...over,
})

const GIT = { root: '/proj', branch: 'main', ahead: 2, lines: {} }

const touch = (abs: string, at: number, isEdited = true, isEditedThisTurn = isEdited) => ({ abs, isEdited, isEditedThisTurn, at, turn: 1 })

test('os arquivos mexidos vêm do mais recente ao mais antigo, com +N −N do git', () => {
  const html = pageOf(
    model({
      touched: [touch('/proj/old.ts', 1), touch('/proj/new.ts', 2)],
      git: { ...GIT, lines: { '/proj/new.ts': [11, 2] } },
    }),
  )

  expect(html.indexOf('new.ts')).toBeLessThan(html.indexOf('old.ts'))
  expect(html).toContain('+11')
  expect(html).toContain('−2')
})

test('o diff aberto vem logo abaixo do arquivo, com linhas verdes e vermelhas e as ações depois', () => {
  const rows = [
    { kind: 'hunk' as const, line: 1, context: 'fn' },
    { kind: 'same' as const, line: 1, text: 'keep' },
    { kind: 'del' as const, line: 2, text: 'old' },
    { kind: 'add' as const, line: 2, text: 'new' },
  ]
  const html = pageOf(model({ touched: [touch('/proj/hooks/pane.tsx', 1)], openDiff: { abs: '/proj/hooks/pane.tsx', rows, more: 0 } }))
  const file = html.indexOf('data-act="file:/proj/hooks/pane.tsx"')

  expect(file).toBeGreaterThan(-1)
  expect(html.indexOf('class="ln a"')).toBeGreaterThan(file)
  expect(html.indexOf('class="ln d"')).toBeGreaterThan(file)

  const end = html.indexOf('class="ln a"')

  for (const act of ['open:code:/proj/hooks/pane.tsx', 'copy:/proj/hooks/pane.tsx', 'mention:/proj/hooks/pane.tsx']) {
    expect(html.indexOf(`data-act="${act}"`)).toBeGreaterThan(end)
  }
  expect(html).toContain('Abrir no VS Code')
  expect(html).not.toContain('folder:')
})

test('o botão da pasta só existe com aplicativo de pastas', () => {
  const openDiff = { abs: '/proj/a.ts', rows: [], more: 0 }

  expect(pageOf(model({ openDiff, hasFolderApp: true }))).toContain('data-act="folder:/proj/a.ts"')
  expect(pageOf(model({ openDiff }))).not.toContain('data-act="folder:')
})

test('a árvore fica fechada até ser pedida', () => {
  const html = pageOf(model({ tree: null }))

  expect(html).toContain('data-act="tree"')
  expect(html).not.toContain('data-act="dir:')
})

test('nomes com < & " aparecem como texto', () => {
  const html = pageOf(model({ touched: [touch('/proj/a<b&"c.ts', 1)] }))

  expect(html).toContain('a&lt;b&amp;&quot;c.ts')
  expect(html).not.toContain('a<b')
})

test('caminho com acento, espaço, dois-pontos e aspas vira ato escapado e nome legível', () => {
  const abs = `/proj/São João/a b:c'd.ts`
  const html = pageOf(model({ touched: [touch(abs, 1)], openDiff: { abs, rows: [], more: 0 } }))

  expect(html).toContain(`data-act="file:/proj/São João/a b:c&#39;d.ts"`)
  expect(html).toContain(`data-act="open:code:/proj/São João/a b:c&#39;d.ts"`)
  expect(html).toContain('<span class="name">a b:c&#39;d.ts</span>')
  expect(html).toContain('<span class="dir">São João</span>')
})

test('diff enorme é cortado em 300 linhas', () => {
  const rows = Array.from({ length: 5000 }, (_, i) => ({ kind: 'add' as const, line: i + 1, text: `line ${i}` }))
  const html = pageOf(model({ openDiff: { abs: '/proj/big.ts', rows, more: 7 } }))

  expect(html.split('class="ln').length - 1).toBeLessThanOrEqual(300)
  expect(html).toContain('linhas não mostradas')
})

test('arquivo binário mostra o aviso no lugar das linhas', () => {
  const html = pageOf(model({ openDiff: { abs: '/proj/a.png', rows: [], more: 0, isBinary: true } }))

  expect(html).toContain('arquivo binário')
  expect(html).not.toContain('class="ln')
  expect(html).toContain('data-act="copy:/proj/a.png"')
})

test('Agora mostra o que o Claude faz', () => {
  expect(pageOf(model())).toContain('Aguardando')
  expect(pageOf(model({ now: { kind: 'thinking' } }))).toContain('Pensando')
  expect(pageOf(model({ now: { kind: 'reading', abs: '/proj/src/a.ts' } }))).toContain('Lendo a.ts')
  expect(pageOf(model({ now: { kind: 'editing', abs: '/proj/src/a.ts' } }))).toContain('Editando a.ts')

  const running = pageOf(model({ now: { kind: 'running', title: 'Rodando testes', detail: 'pnpm test' } }))

  expect(running).toContain('Rodando testes')
  expect(running).toContain('pnpm test')
})

test('Pronto conta arquivos: nenhum, 1 arquivo, N arquivos', () => {
  const done = (edited: string[]) => pageOf(model({ now: { kind: 'done', edited, read: [] } }))

  expect(done([])).toContain('Pronto · Claude editou nenhum arquivo')
  expect(done(['a'])).toContain('Pronto · Claude editou 1 arquivo<')
  expect(done(['a', 'b'])).toContain('Pronto · Claude editou 2 arquivos<')
})

test('o cartão Agora traz a legenda de cores', () => {
  const html = pageOf(model())

  expect(html).toContain('● Claude leu')
  expect(html).toContain('● Claude editou')
  expect(html).toContain('#ad8cf2')
  expect(html).toContain('#e8914f')
})

test('a barra lateral colorida segue o escopo: sessão usa isEdited, turno usa isEditedThisTurn', () => {
  const touched = [touch('/proj/a.ts', 1, true, false)]

  expect(pageOf(model({ touched, scope: 'session' }))).toContain('background:#e8914f')
  expect(pageOf(model({ touched, scope: 'turn' }))).toContain('background:#ad8cf2')
  expect(pageOf(model({ touched, scope: 'turn' }))).not.toContain('class="mark" style="background:#e8914f"')
})

test('o selo de Claude mexeu mostra a contagem e agora ou a hora', () => {
  const recent = pageOf(model({ touched: [touch('/proj/a.ts', Date.now()), touch('/proj/b.ts', Date.now() - 5)] }))
  const old = pageOf(model({ touched: [touch('/proj/a.ts', new Date(2026, 0, 2, 9, 5).getTime())] }))

  expect(recent).toContain('2 arquivos · agora')
  expect(old).toContain('1 arquivo · 09:05')
})

test('o chip de escopo diz Este turno ou Sessão inteira', () => {
  expect(pageOf(model({ scope: 'turn' }))).toContain('data-act="scope">Este turno')
  expect(pageOf(model({ scope: 'session' }))).toContain('class="chip on" data-act="scope">Sessão inteira')
})

const worst = (over: Partial<PageModel> = {}) => {
  const rows = Array.from({ length: 150 }, (_, i) => [
    { kind: 'hunk' as const, line: i * 10 + 1, context: `fn${i}` },
    { kind: 'del' as const, line: i * 10 + 1, text: `old ${i}` },
    { kind: 'add' as const, line: i * 10 + 1, text: `new ${i}` },
  ]).flat()

  return model({
    touched: Array.from({ length: 60 }, (_, i) => touch(`/proj/dir/file${i}.ts`, i)),
    git: GIT,
    openDiff: { abs: '/proj/dir/file59.ts', rows, more: 40 },
    tree: Array.from({ length: 2000 }, (_, i) => ({ abs: `/proj/t${i}`, name: `t${i}.ts`, depth: i % 4, isDir: i % 5 === 0, isOpen: false, size: 1234 })),
    showSizes: true,
    ...over,
  })
}

test('o pior caso (lista cheia, diff em muitos trechos, árvore enorme) cabe em 8 000 px', () => {
  expect(estimateHeight(worst())).toBeLessThanOrEqual(8000)
  expect(estimateHeight(worst({ openDiff: null }))).toBeLessThanOrEqual(8000)
  expect(estimateHeight(worst({ tree: null }))).toBeLessThanOrEqual(8000)
})

test('trechos do diff contam no corte, e a árvore perde linhas para caber', () => {
  const html = pageOf(worst())

  expect(html.split('class="ln').length - 1).toBeLessThanOrEqual(300)
  expect(html.split('class="hunk"').length - 1).toBeLessThan(150)
  expect(html).toContain('itens</div>')
  expect(html).toContain('+20 arquivos')
})

test('Tamanhos e Arquivos ocultos ficam acesos quando ligados', () => {
  const off = pageOf(model({ scope: 'turn' }))
  const on = pageOf(model({ showSizes: true, showHidden: true }))

  expect(off).not.toContain('chip on')
  expect(on).toContain('class="chip on" data-act="sizes"')
  expect(on).toContain('class="chip on" data-act="hidden"')
})

test('o arquivo aberto presente na lista e na árvore recebe o diff uma única vez', () => {
  const abs = '/proj/a.ts'
  const rows = [{ kind: 'add' as const, line: 1, text: 'x' }]
  const html = pageOf(
    model({
      touched: [touch(abs, 1)],
      tree: [{ abs, name: 'a.ts', depth: 0, isDir: false, isOpen: false }],
      openDiff: { abs, rows, more: 0 },
    }),
  )

  expect(html.split('class="diff"').length - 1).toBe(1)
  expect(html.split(`data-act="copy:${abs}"`).length - 1).toBe(1)
})

test('o arquivo aberto fora da lista (inclusive além do corte de 40) aparece com marca e contagem', () => {
  const abs = '/proj/dir/file0.ts'
  const touched = Array.from({ length: 60 }, (_, i) => touch(`/proj/dir/file${i}.ts`, 100 + i))
  const html = pageOf(
    model({ touched, git: { ...GIT, lines: { [abs]: [5, 1] } }, openDiff: { abs, rows: [], more: 0 } }),
  )

  expect(html.split(`data-act="file:${abs}"`).length - 1).toBe(1)
  expect(html.split('class="diff"').length - 1).toBe(1)
  expect(html.indexOf('+5')).toBeGreaterThan(html.indexOf(`data-act="file:${abs}"`))
  expect(html.slice(html.indexOf(`data-act="file:${abs}"`)).startsWith(`data-act="file:${abs}"><span class="mark"`)).toBe(true)

  const absent = pageOf(model({ openDiff: { abs: '/proj/z.ts', rows: [], more: 0 } }))

  expect(absent.split('data-act="file:/proj/z.ts"').length - 1).toBe(1)
})

test('horário no futuro conta como agora', () => {
  expect(pageOf(model({ touched: [touch('/proj/a.ts', Date.now() + 3_600_000)] }))).toContain('1 arquivo · agora')
})

test('arquivo editado e ainda não visto leva a bolinha laranja; ler não leva; abrir o diff tira', () => {
  const touched = [
    { abs: '/proj/a.ts', isEdited: true, isEditedThisTurn: true, at: 1000, turn: 1 },
    { abs: '/proj/b.ts', isEdited: false, isEditedThisTurn: false, at: 2000, turn: 1 },
  ]
  const dots = (html: string) => html.match(/<span class="newdot">/g)?.length ?? 0

  expect(dots(pageOf(model({ touched })))).toBe(1)
  expect(dots(pageOf(model({ touched, seen: { '/proj/a.ts': 999 } })))).toBe(1)
  expect(dots(pageOf(model({ touched, seen: { '/proj/a.ts': 1000 } })))).toBe(0)
  expect(dots(pageOf(model({ touched, seen: { '/proj/a.ts': 1500 }, scope: 'session' })))).toBe(0)
  expect(dots(pageOf(model({ touched: [{ ...touched[0]!, at: 3000 }], seen: { '/proj/a.ts': 1500 } })))).toBe(1)
})

test('o arquivo em edição vai para o topo com destaque e etiqueta; lendo ganha o destaque roxo', () => {
  const touched = [
    { abs: '/proj/a.ts', isEdited: true, isEditedThisTurn: true, at: 3000, turn: 1 },
    { abs: '/proj/b.ts', isEdited: true, isEditedThisTurn: true, at: 1000, turn: 1 },
  ]
  const order = (html: string) => [...html.matchAll(/data-act="file:([^"]*)"/g)].map(one => one[1])

  const editing = pageOf(model({ touched, now: { kind: 'editing', abs: '/proj/b.ts' } }))
  expect(order(editing)).toEqual(['/proj/b.ts', '/proj/a.ts'])
  expect(editing).toContain('class="file live-edit"')
  expect(editing).toContain('<span class="livetag e">editando</span>')
  expect(editing.match(/live-edit"/g)).toHaveLength(1)

  const reading = pageOf(model({ touched, now: { kind: 'reading', abs: '/proj/b.ts' } }))
  expect(reading).toContain('class="file live-read"')
  expect(reading).toContain('<span class="livetag r">lendo</span>')

  expect(pageOf(model({ touched }))).not.toContain('<span class="livetag')
})
