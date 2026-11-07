import { expect, test } from 'claude-code/testing'

import { iconFor } from '../hooks/page/icons'

const samples: [string, boolean, boolean][] = [
  ['a.ts', false, false],
  ['a.js', false, false],
  ['a.json', false, false],
  ['a.md', false, false],
  ['a.css', false, false],
  ['a.html', false, false],
  ['a.py', false, false],
  ['a.sh', false, false],
  ['a.png', false, false],
  ['a.xyz', false, false],
  ['src', true, false],
  ['src', true, true],
]

test('every icon is a self-contained 16 px svg', () => {
  for (const [n, d, o] of samples) {
    const s = iconFor(n, d, o)
    expect(s.startsWith('<svg viewBox="0 0 16 16" width="16" height="16">')).toBe(true)
    expect(s.endsWith('</svg>')).toBe(true)
    expect(/<script|href=|url\(|xlink|http/i.test(s)).toBe(false)
  }
})

test('each type has its own icon', () => {
  const all = samples.map(([n, d, o]) => iconFor(n, d, o))
  expect(new Set(all).size).toBe(samples.length)
})

test('extensions map to families, case-insensitive; dotfiles and no-extension are generic', () => {
  expect(iconFor('x.tsx', false, false)).toBe(iconFor('y.ts', false, false))
  expect(iconFor('x.JPG', false, false)).toBe(iconFor('y.png', false, false))
  expect(iconFor('.gitignore', false, false)).toBe(iconFor('Makefile', false, false))
  expect(iconFor('.gitignore', false, false)).toBe(iconFor('a.xyz', false, false))
})
