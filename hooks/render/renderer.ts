import type { EngineInterface as Engine, Timer } from 'claude-code'

import { trace } from '../core/trace'

export type Hit = { act: string; x: number; y: number; w: number; h: number }
export type Frame = { file: string; rev: number; height: number; hits: Hit[] }

const IDLE_MS = 120_000
const CONNECT_TRIES = 40
const CONNECT_WAIT_MS = 50
const ABORT_WINDOW_MS = 10_000
const ABORTS_MAX = 3
const IS_REPLACED = /superseded|aborted/i

type Server = { sock: string; chrome: string }

let server: Server | null = null
let starting: Promise<Server | null> | null = null
let latest = 0
let idle: Timer | null = null
let stopping: Promise<void> | null = null
let kept: string[] = []
let onLost: ((isDeath: boolean, isAborted?: boolean) => void) | null = null
let aborts: number[] = []

export const whenLost = (fn: (isDeath: boolean, isAborted?: boolean) => void) => {
  onLost = fn
}

export const isRunning = () => server !== null

export async function findChrome($: Engine): Promise<string | null> {
  const home = await $.env.get('HOME')
  if (!home) return null

  const root = `${home}/.cache/ms-playwright`
  const builds = await $.fs.list(root).catch(() => [])
  const newest = builds
    .map(entry => entry.name)
    .filter(name => name.startsWith('chromium_headless_shell-'))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))

  for (const build of newest) {
    for (const dir of ['chrome-headless-shell-linux64', 'chrome-linux64']) {
      const exe = `${root}/${build}/${dir}/chrome-headless-shell`
      if (await $.fs.exists(exe)) return exe
    }
  }

  return null
}

async function tempRoot($: Engine) {
  const base = (await $.env.get('TMPDIR')) || '/tmp'
  const { stdout } = await $.process.run(['id', '-u'])

  return `${base}/claude-${stdout.trim()}`
}

const forget = (gone: Server) => {
  if (server !== gone) return false

  server = null
  idle?.cancel()
  idle = null

  return true
}

async function launch($: Engine): Promise<Server | null> {
  const chrome = await findChrome($)
  if (!chrome) return null

  const sock = `${await tempRoot($)}/panel-${await $.session.id()}-${Date.now().toString(36)}.sock`
  const spawned = { sock, chrome }
  const home = await $.env.get('HOME').catch(() => undefined)
  const isLogged = Boolean(home) && !(await $.fs.exists(`${home}/.cache/panel/debug.off`).catch(() => false))
  const stream = $.process.spawn({ argv: ['node', `${$.plugin.root}/renderer/server.mjs`, sock, chrome, isLogged ? `${home}/.cache/panel/debug.log` : ''] })

  void trace($, 'spawn', { sock, chrome, root: $.plugin.root })
  void (async () => {
    const output: string[] = []
    let ending = 'ended'
    try {
      for await (const chunk of stream) output.push(String((chunk as { text?: string }).text ?? '').slice(0, 300))
    } catch (error) {
      ending = `threw: ${String((error as Error)?.message ?? error)}`
    }

    const isCurrent = forget(spawned)
    void trace($, 'server-gone', { ending, isCurrent, output: output.slice(-5) })

    if (!isCurrent) return

    const isReplaced = IS_REPLACED.test(ending)
    const now = Date.now()
    aborts = isReplaced ? [...aborts.filter(at => now - at < ABORT_WINDOW_MS), now] : []

    onLost?.(true, isReplaced && aborts.length <= ABORTS_MAX)
  })()

  server = spawned

  return spawned
}

async function running($: Engine) {
  while (stopping) await stopping

  if (server) return server

  starting ??= launch($).finally(() => {
    starting = null
  })

  return starting
}

async function send($: Engine, target: Server, path: string, body: unknown, persist = false) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const reply = await $.http.fetch(`http://localhost${path}`, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
        socketPath: target.sock,
      })

      if (!reply.ok) void trace($, 'send-not-ok', { path, status: reply.status, text: reply.text.slice(0, 300) })

      return reply.ok ? (JSON.parse(reply.text) as Record<string, unknown>) : null
    } catch (error) {
      if (IS_REPLACED.test(String((error as Error)?.message ?? error))) throw error

      if ((!persist && server !== target) || attempt >= CONNECT_TRIES) {
        void trace($, 'send-gave-up', { path, attempt, isCurrent: server === target, error: String((error as Error)?.message ?? error) })

        return null
      }

      await $.clock.sleep(CONNECT_WAIT_MS)
    }
  }
}

function rearm($: Engine) {
  idle?.cancel()
  idle = $.clock.after(IDLE_MS, () => void stop($, true).then(() => onLost?.(false)))
}

export async function render($: Engine, html: string, width: number, height: number, scale = 1): Promise<Frame | null> {
  const mine = ++latest
  const began = Date.now()
  const target = await running($)
  if (!target) {
    void trace($, 'render-null', { why: 'no-target', mine })

    return null
  }

  const reply = await send($, target, '/render', { html, width, height, scale })
  if (reply && server === target) rearm($)

  const isSuperseded = mine !== latest
  if (isSuperseded || !reply) void trace($, 'render-lost', { mine, latest, ms: Date.now() - began, hasReply: reply !== null, isSuperseded })
  else void trace($, 'render-done', { mine, ms: Date.now() - began, serverMs: reply.ms, bytes: reply.bytes, rev: reply.rev, width, height, scale })
  if (isSuperseded || !reply) return null

  await forgetKept($)

  return { file: String(reply.file), rev: Number(reply.rev ?? 0), height: Number(reply.height), hits: (reply.hits as Hit[]) ?? [] }
}

export async function clip($: Engine, y: number, height: number): Promise<string | null> {
  if (!server) return null

  const target = server
  const reply = await send($, target, '/clip', { y, height })
  if (reply && server === target) rearm($)

  return reply ? String(reply.file) : null
}

export async function hot($: Engine, act: string, rev: number, y: number, height: number): Promise<string | null> {
  if (!server) return null

  const target = server
  const reply = await send($, target, '/hover', { act, rev, y, height })
  if (reply && server === target) rearm($)

  return reply ? String(reply.file) : null
}

async function forgetKept($: Engine) {
  const files = kept
  kept = []

  if (files.length) await $.process.run(['rm', '-f', ...files]).catch(() => null)
}

export function stop($: Engine, keepLast = false): Promise<void> {
  idle?.cancel()
  idle = null
  latest += 1

  const launching = starting
  let target = server
  server = null

  const done = (async () => {
    await launching?.catch(() => null)
    idle?.cancel()
    idle = null

    target ??= server
    server = null
    if (target) {
      const reply = await send($, target, '/quit', { keepLast }, true).catch(() => null)
      kept = Array.isArray(reply?.kept) ? (reply.kept as string[]) : []
    }

    if (!keepLast) await forgetKept($)
  })().finally(() => {
    if (stopping === done) stopping = null
  })

  stopping = done

  return done
}
