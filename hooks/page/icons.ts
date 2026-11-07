const svg = (body: string) => `<svg viewBox="0 0 16 16" width="16" height="16">${body}</svg>`

const SHEET = '<path d="M3.5 1.5h6l3 3v10h-9z" fill="#21262d" stroke="#484f58"/><path d="M9.5 1.5v3h3" fill="none" stroke="#484f58"/>'

const badge = (fill: string, label: string, ink = '#fff') =>
  svg(
    `${SHEET}<rect x="1" y="8" width="14" height="6" rx="1.5" fill="${fill}"/>` +
      `<text x="8" y="12.9" font-family="Helvetica,Arial,sans-serif" font-size="5" font-weight="700" text-anchor="middle" fill="${ink}">${label}</text>`,
  )

const glyph = (fill: string, shape: string) =>
  svg(`${SHEET}<rect x="1" y="8" width="14" height="6" rx="1.5" fill="${fill}"/>${shape}`)

const FOLDER_CLOSED = svg(
  '<path d="M1.5 3.5a1 1 0 0 1 1-1h3.2l1.3 1.5h6.5a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" fill="#5b6b7f"/>' +
    '<path d="M1.5 6h13v6.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" fill="#8b9bb0"/>',
)

const FOLDER_OPEN = svg(
  '<path d="M1.5 3.5a1 1 0 0 1 1-1h3.2l1.3 1.5h6.5a1 1 0 0 1 1 1v1.5h-13z" fill="#5b6b7f"/>' +
    '<path d="M3 6.5h12.5l-1.7 6.3a1 1 0 0 1-1 .7H2.5a1 1 0 0 1-1-1.3z" fill="#9fb0c5"/>',
)

const ICONS: Record<string, string> = {
  ts: badge('#3178c6', 'TS'),
  js: badge('#f7df1e', 'JS', '#1b1b1b'),
  json: badge('#d29922', '{ }'),
  md: badge('#6e7f95', 'MD'),
  css: badge('#8957e5', 'CSS'),
  html: badge('#e8602c', '&lt;&gt;'),
  py: svg(
    `${SHEET}<rect x="1" y="8" width="14" height="6" rx="1.5" fill="#3572a5"/>` +
      '<text x="8" y="12.9" font-family="Helvetica,Arial,sans-serif" font-size="5" font-weight="700" text-anchor="middle" fill="#ffd43b">PY</text>',
  ),
  sh: badge('#2ea043', '&gt;_'),
  image: glyph('#1a9e96', '<circle cx="5.5" cy="11" r="1" fill="#fff"/><path d="M4 13l3-3 2 2 1.5-1.5L13 13z" fill="#fff"/>'),
  file: svg(SHEET + '<path d="M5.5 8h5M5.5 10.5h5M5.5 13h3" stroke="#7d8590" stroke-linecap="round"/>'),
}

const BY_EXT: Record<string, string> = {
  ts: 'ts', tsx: 'ts', mts: 'ts', cts: 'ts',
  js: 'js', jsx: 'js', mjs: 'js', cjs: 'js',
  json: 'json', jsonc: 'json',
  md: 'md', mdx: 'md',
  css: 'css', scss: 'css',
  html: 'html', htm: 'html',
  py: 'py',
  sh: 'sh', bash: 'sh', zsh: 'sh',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', ico: 'image', bmp: 'image',
}

export const ICON_NAMES = [...Object.keys(ICONS), 'folder', 'folder-open']

export function iconFor(name: string, isDir: boolean, isOpen: boolean): string {
  if (isDir) return isOpen ? FOLDER_OPEN : FOLDER_CLOSED
  const dot = name.lastIndexOf('.')
  const kind = dot > 0 ? BY_EXT[name.slice(dot + 1).toLowerCase()] : undefined
  return ICONS[kind ?? 'file']
}
