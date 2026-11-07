#!/usr/bin/env node
// Confere se os arquivos de versão do projeto, o CHANGELOG e a tag de git concordam.
// Uso: node check-versions.mjs [pasta] [--tag vX.Y.Z]   (sai com código 1 se houver erro)
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const flag = name => {
  const at = args.indexOf(name)

  return at === -1 ? null : (args[at + 1] ?? null)
}
const root = resolve(args.find(one => !one.startsWith('--') && one !== flag('--tag')) ?? '.')
const expectedTag = flag('--tag') ?? process.env.GITHUB_REF_NAME ?? null

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

const read = rel => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : null)
const json = rel => {
  const text = read(rel)

  return text === null ? null : JSON.parse(text)
}
const grab = (rel, pattern) => read(rel)?.match(pattern)?.[1] ?? null

const carriers = []
const add = (file, version) => version && carriers.push({ file, version: String(version) })

add('package.json', json('package.json')?.version)
add('.claude-plugin/plugin.json', json('.claude-plugin/plugin.json')?.version)
for (const entry of json('.claude-plugin/marketplace.json')?.plugins ?? []) add(`.claude-plugin/marketplace.json (${entry.name})`, entry.version)
add('Cargo.toml', grab('Cargo.toml', /^version\s*=\s*"([^"]+)"/m))
add('pyproject.toml', grab('pyproject.toml', /^version\s*=\s*"([^"]+)"/m))
add('VERSION', read('VERSION')?.trim())

const errors = []
const notes = []

if (carriers.length === 0) errors.push('nenhum arquivo de versão encontrado (package.json, plugin.json, Cargo.toml, pyproject.toml, VERSION)')

for (const one of carriers) if (!SEMVER.test(one.version)) errors.push(`${one.file}: "${one.version}" não é SemVer 2.0.0 válido`)

const versions = new Set(carriers.map(one => one.version))
if (versions.size > 1) errors.push(`arquivos discordam: ${carriers.map(one => `${one.file}=${one.version}`).join(', ')}`)

const version = carriers[0]?.version ?? null
const pluginManifestVersion = json('.claude-plugin/plugin.json')?.version
const marketplaceVersioned = (json('.claude-plugin/marketplace.json')?.plugins ?? []).some(entry => entry.version)
if (pluginManifestVersion && marketplaceVersioned) errors.push('marketplace.json tem "version" na entrada do plugin: deixe a versão só no plugin.json (ela vence em silêncio e as duas podem divergir)')

const changelog = read('CHANGELOG.md')
if (version) {
  if (changelog === null) errors.push('CHANGELOG.md não existe')
  else if (!new RegExp(`^## \\[${version.replace(/[.+]/g, '\\$&')}\\]`, 'm').test(changelog)) errors.push(`CHANGELOG.md não tem a seção "## [${version}]"`)
  if (changelog !== null && !/^## \[Unreleased\]/mi.test(changelog)) notes.push('CHANGELOG.md sem seção [Unreleased] (útil para acumular mudanças)')
}

const git = args => {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return null
  }
}

if (git(['rev-parse', '--git-dir']) !== null && version) {
  const tags = (git(['tag', '--list', 'v*', '--sort=-v:refname']) ?? '').split('\n').filter(Boolean)
  const latest = tags[0] ?? null

  if (expectedTag && expectedTag !== `v${version}`) errors.push(`a tag ${expectedTag} não bate com a versão dos arquivos (v${version})`)
  if (latest === `v${version}`) notes.push(`versão ${version} já tem tag (${latest})`)
  else if (tags.includes(`v${version}`)) errors.push(`v${version} existe, mas não é a tag mais recente (${latest}): a versão sobe sempre`)
  else notes.push(`versão ${version} ainda sem tag (última: ${latest ?? 'nenhuma'})`)

  if (git(['status', '--porcelain'])) notes.push('há mudanças sem commit')
}

console.log(`Projeto: ${root}`)
for (const one of carriers) console.log(`  ${one.version.padEnd(14)} ${one.file}`)
for (const note of notes) console.log(`  · ${note}`)
for (const error of errors) console.error(`  ✘ ${error}`)
console.log(errors.length === 0 ? '✔ versões em ordem' : `✘ ${errors.length} problema(s)`)

process.exit(errors.length === 0 ? 0 : 1)
