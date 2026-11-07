export const esc = (text: string) =>
  text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

export const baseOf = (path: string) => path.slice(path.lastIndexOf('/') + 1) || path

export const dirOf = (path: string) => {
  const cut = path.lastIndexOf('/')

  return cut > 0 ? path.slice(0, cut) : ''
}

export const whereOf = (dir: string, project: string) => {
  if (!project.startsWith('/')) return dir
  if (dir === project) return ''

  return dir.startsWith(`${project}/`) ? dir.slice(project.length + 1) : dir
}

export function sizeOf(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export const timeOf = (at: number) => {
  const date = new Date(at)

  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
