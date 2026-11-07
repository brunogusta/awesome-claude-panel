#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const flag = name => {
  const at = args.indexOf(name)

  return at === -1 ? null : (args[at + 1] ?? '')
}
const file = flag('--file') ?? join(homedir(), '.cache', 'panel', 'debug.log')
const sinceMs = (() => {
  const raw = flag('--since')
  const match = /^(\d+)([smhd])$/.exec(raw ?? '')

  return match ? Number(match[1]) * { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]] : null
})()
const session = flag('--session')

const read = path => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : [])
const rows = [...read(`${file}.1`), ...read(file)]
  .map(line => {
    try {
      const one = JSON.parse(line)

      return { ...one, ev: one.ev ?? one.event }
    } catch {
      return { ev: 'unparsable', raw: line.slice(0, 120) }
    }
  })
  .filter(one => (sinceMs === null || !one.t || Date.parse(one.t) >= Date.now() - sinceMs) && (!session || one.s === session))

const ERRORS = new Set(['hook-error', 'ui-fault', 'fail', 'toast', 'blit-denied', 'start-error', 'scroll-error', 'act-error', 'srv-error', 'srv-chrome-failed', 'log-dropped', 'unparsable', 'prefill-stopped', 'cooling-down'])

const stats = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const at = fraction => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]

  return { n: sorted.length, p50: at(0.5), p95: at(0.95), max: sorted.at(-1) }
}
const show = (label, values, unit = 'ms') => {
  const one = stats(values)
  if (one) console.log(`  ${label.padEnd(28)} n=${one.n}  p50=${one.p50}${unit}  p95=${one.p95}${unit}  max=${one.max}${unit}`)
}

console.log(`${rows.length} eventos em ${file}${sinceMs ? ` (últimos ${flag('--since')})` : ''}${session ? ` · sessão ${session}` : ''}`)

const counts = new Map()
for (const one of rows) counts.set(one.ev, (counts.get(one.ev) ?? 0) + 1)
console.log('\nEventos:')
for (const [name, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${name}${ERRORS.has(name) ? '   <-- atenção' : ''}`)

console.log('\nTempos:')
const of = (ev, field) => rows.filter(one => one.ev === ev).map(one => one[field])
show('desenho (plugin, total)', of('render-done', 'ms'))
show('desenho (Chrome)', of('render-done', 'serverMs'))
show('tamanho do PNG', of('render-done', 'bytes').map(bytes => Math.round(bytes / 1024)), 'KB')
show('clique (ação)', of('click', 'actMs'))
show('servidor: desenho', of('srv-render', 'ms'))
show('servidor: memória RSS', of('srv-render', 'rssMb'), 'MB')
show('hover (detalhado)', of('hover', 'ms'))

const replaced = rows.filter(one => one.ev === 'render-threw').length
if (replaced) console.log(`\n  (${replaced} desenhos foram derrubados por redesenho novo e refeitos: esperado)`)

const issues = rows.filter(one => ERRORS.has(one.ev))
if (issues.length) {
  console.log(`\nProblemas (${issues.length}), os 15 mais recentes:`)
  for (const one of issues.slice(-15)) console.log(`  ${one.t?.slice(11, 23) ?? ''}  ${one.ev}  ${JSON.stringify(Object.fromEntries(Object.entries(one).filter(([key]) => !['t', 'ev', 's', 'stack'].includes(key)))).slice(0, 200)}`)
}

const sizes = rows.filter(one => one.ev === 'size')
if (sizes.length) {
  console.log(`\nTamanhos vistos (${sizes.length}), os 8 mais recentes:`)
  for (const one of sizes.slice(-8)) console.log(`  ${one.t?.slice(11, 23)}  ${one.columns}x${one.rows} colunas  ${Math.round((one.pixels ?? 0) / 1000)}k px  grade ${one.grid?.w}x${one.grid?.h}`)
}

const renders = rows.filter(one => one.ev === 'render-done' || one.ev === 'render-lost').map(one => Date.parse(one.t))
let storm = 0
for (let i = 0; i < renders.length; i += 1) {
  const window = renders.filter(at => at >= renders[i] && at < renders[i] + 1000).length
  storm = Math.max(storm, window)
}
if (storm > 8) console.log(`\nTempestade de desenhos: até ${storm} em 1 s`)

const sessions = new Set(rows.map(one => one.s).filter(Boolean))
console.log(`\nSessões: ${[...sessions].join(', ') || '(sem id)'}`)
