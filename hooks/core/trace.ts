import type { EngineInterface as Engine } from 'claude-code'

type Setup = { file: string; isVerbose: boolean; sid: string; head: Record<string, unknown> } | null

const FLUSH_MS = 500
const QUEUE_MAX = 400
const ROTATE_BYTES = 5_000_000
const WRITE = `f=$1; shift
mkdir -p "$(dirname "$f")"
if [ -f "$f" ] && [ "$(wc -c < "$f")" -gt ${ROTATE_BYTES} ]; then mv -f "$f" "$f.1"; fi
printf '%s\\n' "$@" >> "$f"`

let queue: string[] = []
let dropped = 0
let setup: Promise<Setup> | null = null
let isScheduled = false
let isWriting = false
let isHeadSent = false

async function open($: Engine): Promise<Setup> {
  const home = await $.env.get('HOME').catch(() => undefined)
  if (!home) return null

  const dir = `${home}/.cache/panel`
  if (await $.fs.exists(`${dir}/debug.off`).catch(() => false)) return null

  const [term, program, ghostty, kitty, kind, forced, tmux] = await Promise.all([
    $.env.get('TERM').catch(() => undefined),
    $.env.get('TERM_PROGRAM').catch(() => undefined),
    $.env.get('GHOSTTY_RESOURCES_DIR').catch(() => undefined),
    $.env.get('KITTY_WINDOW_ID').catch(() => undefined),
    $.env.get('CLAUDE_CODE_SESSION_KIND').catch(() => undefined),
    $.env.get('CLAUDE_CODE_FORCE_TERMINAL_IMAGES').catch(() => undefined),
    $.env.get('TMUX').catch(() => undefined),
  ])

  return {
    file: `${dir}/debug.log`,
    isVerbose: await $.fs.exists(`${dir}/debug.verbose`).catch(() => false),
    sid: String((await $.session.id().catch(() => '')) ?? '').slice(0, 8),
    head: { root: $.plugin.root, term, program, isGhostty: Boolean(ghostty), isKitty: Boolean(kitty), kind, forced, isTmux: Boolean(tmux) },
  }
}

async function flush($: Engine) {
  isScheduled = false
  if (isWriting || queue.length === 0) return

  const on = await (setup ??= open($))
  if (!on) {
    queue = []

    return
  }

  isWriting = true
  const lines = queue
  queue = []
  const extra: string[] = []
  const wasHeadSent = isHeadSent
  const lostBefore = dropped

  if (!isHeadSent) {
    isHeadSent = true
    extra.push(JSON.stringify({ t: new Date().toISOString(), ev: 'log-open', verbose: on.isVerbose, ...on.head }))
  }
  if (dropped > 0) {
    extra.push(JSON.stringify({ t: new Date().toISOString(), ev: 'log-dropped', count: dropped }))
    dropped = 0
  }

  const tagged = lines.map(line => `{"s":"${on.sid}",${line.slice(1)}`)

  try {
    await $.process.run(['sh', '-c', WRITE, 'sh', on.file, ...extra, ...tagged], { timeoutMs: 5000 })
  } catch {
    const merged = [...lines, ...queue]
    queue = merged.slice(-QUEUE_MAX)
    isHeadSent = wasHeadSent
    dropped += lostBefore + merged.length - queue.length
    isWriting = false

    return
  }

  isWriting = false
  if (queue.length > 0) schedule($)
}

function schedule($: Engine) {
  if (isScheduled) return

  isScheduled = true
  $.clock.after(FLUSH_MS, () => void flush($))
}

function push($: Engine, ev: string, data: Record<string, unknown>) {
  if (queue.length >= QUEUE_MAX) {
    queue.shift()
    dropped += 1
  }

  queue.push(JSON.stringify({ t: new Date().toISOString(), ev, ...data }))
  schedule($)
}

export async function trace($: Engine, ev: string, data: Record<string, unknown> = {}) {
  push($, ev, data)
}

export async function traceVerbose($: Engine, ev: string, data: Record<string, unknown> = {}) {
  const on = await (setup ??= open($))
  if (on?.isVerbose) push($, ev, data)
}

export function errorFields(error: unknown) {
  const e = error as { message?: unknown; stack?: unknown } | null

  return { message: String(e?.message ?? error), stack: String(e?.stack ?? '').split('\n').slice(0, 6).join('\n') }
}

export async function guarded<T>($: Engine, name: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    push($, 'hook-error', { hook: name, ...errorFields(error) })

    throw error
  }
}

export const resetTrace = () => {
  setup = null
  isHeadSent = false
}
