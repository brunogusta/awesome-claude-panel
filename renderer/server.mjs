import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const socketPath = process.argv[2]
const logFile = process.argv[4] || ''
const isVerbose = logFile !== '' && existsSync(join(logFile, '..', 'debug.verbose'))
const parent = process.ppid
const MAX_HEIGHT = 8000

const findChrome = () => {
  const root = join(homedir(), '.cache', 'ms-playwright')
  const builds = readdirSync(root)
    .filter(name => name.startsWith('chromium_headless_shell-'))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))

  for (const build of builds) {
    for (const dir of ['chrome-headless-shell-linux64', 'chrome-linux64']) {
      const exe = join(root, build, dir, 'chrome-headless-shell')
      if (existsSync(exe)) return exe
    }
  }

  throw new Error('chrome-headless-shell not found')
}

let chrome = null
let profile = null
let cdp = null
let metrics = { width: 0, height: 0, scale: 1 }
let page = { width: 0, height: 0, scale: 1, rev: 0 }
let revision = Date.now()

const log = (ev, data = {}, verboseOnly = false) => {
  if (!logFile || (verboseOnly && !isVerbose)) return

  try {
    appendFileSync(logFile, `${JSON.stringify({ t: new Date().toISOString(), ev, src: 'server', pid: process.pid, ...data })}\n`)
  } catch {}
}

const mb = bytes => Math.round(bytes / 1048576)

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const portOf = async (dir, proc) => {
  const file = join(dir, 'DevToolsActivePort')

  for (let i = 0; i < 200; i += 1) {
    if (existsSync(file)) return readFileSync(file, 'utf8').split('\n')[0]
    if (proc.exitCode !== null) throw new Error('chrome exited before listening')
    await sleep(25)
  }

  throw new Error('chrome did not open a debugging port')
}

const connect = async () => {
  const connectStarted = performance.now()
  const exe = findChrome()
  const dir = mkdtempSync(join(tmpdir(), 'panel-chrome-'))
  const proc = spawn(
    exe,
    [
      '--headless',
      '--remote-debugging-port=0',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-gpu-vsync',
      '--disable-frame-rate-limit',
      '--hide-scrollbars',
      `--user-data-dir=${dir}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )
  chrome = proc
  profile = dir
  cdp = null
  metrics = { width: 0, height: 0, scale: 1 }
  page = { width: 0, height: 0, scale: 1, rev: 0 }
  proc.on('exit', (code, signal) => {
    log('srv-chrome-exit', { code, signal, isCurrent: chrome === proc })
    rmSync(dir, { recursive: true, force: true })
    if (chrome !== proc) return

    chrome = null
    cdp = null
  })

  try {
    const port = await portOf(dir, proc)
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    const target = pages.find(entry => entry.type === 'page')
    const ws = new WebSocket(target.webSocketDebuggerUrl)
    const pending = new Map()
    let id = 0

    await new Promise((resolve, reject) => {
      ws.onopen = resolve
      ws.onerror = reject
    })
    ws.onmessage = ({ data }) => {
      const msg = JSON.parse(data)
      const wait = pending.get(msg.id)
      if (!wait) return

      pending.delete(msg.id)
      if (msg.error) wait.reject(new Error(msg.error.message))
      else wait.resolve(msg.result)
    }
    ws.onclose = () => {
      for (const wait of pending.values()) wait.reject(new Error('chrome closed'))
      pending.clear()
    }

    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        id += 1
        pending.set(id, { resolve, reject })
        ws.send(JSON.stringify({ id, method, params }))
      })

    await send('Page.enable')
    const { frameTree } = await send('Page.getFrameTree')
    cdp = { send, frameId: frameTree.frame.id }
    log('srv-chrome-ready', { chromePid: proc.pid, ms: Math.round(performance.now() - connectStarted) })
  } catch (error) {
    log('srv-chrome-failed', { message: String(error?.message ?? error) })
    proc.kill('SIGKILL')
    rmSync(dir, { recursive: true, force: true })
    if (chrome === proc) {
      chrome = null
      profile = null
      cdp = null
    }

    throw error
  }
}

const evaluate = async expression => {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, returnByValue: true })
  if (exceptionDetails) throw new Error(exceptionDetails.text)

  return result.value
}

const setViewport = async (width, height, scale) => {
  if (metrics.width === width && metrics.height === height && metrics.scale === scale) return

  metrics = { width, height, scale }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false })
}

const written = []
const hovered = []
const HOVERED_KEEP = 64
let counter = 0
let lastShot = { bytes: 0, ms: 0, height: 0 }

const shoot = async (y, height, width, pool = written, keep = 2, tag = '') => {
  const shotStarted = performance.now()
  const { data } = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    optimizeForSpeed: true,
    clip: { x: 0, y, width, height, scale: 1 },
  })
  counter += 1
  const file = `/dev/shm/panel-${parent}-${process.pid}-${tag}${counter}.png`
  const png = Buffer.from(data, 'base64')
  writeFileSync(file, png, { mode: 0o600 })
  lastShot = { bytes: png.length, ms: Math.round(performance.now() - shotStarted), height: Math.round(height) }
  pool.push(file)

  // The terminal reads the file after the reply, so the one just superseded is still on its way
  // to the screen; only the one before that is safe to delete.
  while (pool.length > keep) rmSync(pool.shift(), { force: true })

  return file
}

const HITS = `JSON.stringify([...document.querySelectorAll('[data-act]')].map(el => {
  const r = el.getBoundingClientRect()
  return { act: el.getAttribute('data-act'), x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }
}))`

let queue = Promise.resolve()
const serial = work => {
  const run = queue.then(work, work)
  queue = run.catch(() => {})

  return run
}

class BadRequest extends Error {}

const isNumber = value => typeof value === 'number' && Number.isFinite(value)

const render = ({ html, width, height, scale = 1 }) => {
  if (typeof html !== 'string' || !isNumber(width) || !isNumber(height) || width < 1 || height < 1) {
    throw new BadRequest('render needs html (string), width and height (positive numbers)')
  }
  if (!isNumber(scale) || scale < 0.5 || scale > 4) throw new BadRequest('scale must be a number from 0.5 to 4')

  return serial(async () => {
    const started = performance.now()
    if (!cdp) await connect()

    const cssWidth = Math.max(1, Math.round(width / scale))
    const cssHeight = Math.max(1, Math.round(height / scale))
    await setViewport(cssWidth, cssHeight, scale)
    await cdp.send('Page.setDocumentContent', { frameId: cdp.frameId, html })
    const content = Math.min(MAX_HEIGHT, Math.max(1, Math.ceil(await evaluate('document.documentElement.scrollHeight'))))
    const total = Math.max(content, cssHeight)
    await setViewport(cssWidth, total, scale)
    const hits = JSON.parse(await evaluate(HITS)).map(hit => ({
      ...hit,
      x: hit.x * scale,
      y: hit.y * scale,
      w: hit.w * scale,
      h: hit.h * scale,
    }))
    revision += 1
    page = { width: cssWidth, height: total, scale, rev: revision }
    const file = await shoot(0, cssHeight, cssWidth)

    return { file, rev: revision, bytes: lastShot.bytes, height: Math.round(total * scale), ms: Math.round(performance.now() - started), hits }
  })
}

const clip = ({ y, height }) => {
  if (!isNumber(y) || !isNumber(height) || y < 0 || height < 1) throw new BadRequest('clip needs y (>= 0) and height (>= 1) as numbers')

  return serial(async () => {
    if (!cdp || page.height === 0) throw new Error('nothing rendered yet')

    const top = y / page.scale

    return { file: await shoot(top, Math.max(1, Math.min(height / page.scale, page.height - top)), page.width) }
  })
}

class Conflict extends Error {}

const mark = (act, on) => `(() => {
  const el = [...document.querySelectorAll('[data-act]')].find(one => one.getAttribute('data-act') === ${JSON.stringify(act)})
  if (el) el.toggleAttribute('data-hot', ${on})
  return Boolean(el)
})()`

const hover = ({ act, y, height, rev }) => {
  if (typeof act !== 'string' || !isNumber(y) || !isNumber(height) || !isNumber(rev) || y < 0 || height < 1) {
    throw new BadRequest('hover needs act (string), y (>= 0), height (>= 1) and rev as numbers')
  }

  return serial(async () => {
    if (!cdp || page.height === 0) throw new Error('nothing rendered yet')
    if (rev !== page.rev) throw new Conflict('the page was rendered again')
    if (!(await evaluate(mark(act, true)))) throw new Conflict('no such element')

    try {
      const top = y / page.scale

      return { file: await shoot(top, Math.max(1, Math.min(height / page.scale, page.height - top)), page.width, hovered, HOVERED_KEEP, 'h') }
    } finally {
      await evaluate(mark(act, false)).catch(() => null)
    }
  })
}

const shutdown = (keepLast = false) => {
  log('srv-shutdown', { keepLast })
  chrome?.kill('SIGKILL')
  if (profile) rmSync(profile, { recursive: true, force: true })
  for (const file of hovered) rmSync(file, { force: true })
  if (!keepLast) for (const file of written) rmSync(file, { force: true })
  if (socketPath) rmSync(socketPath, { force: true })
  process.exit(0)
}

const body = req =>
  new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {})
      } catch {
        reject(new BadRequest('body is not valid JSON'))
      }
    })
    req.on('error', reject)
  })

const routes = { '/render': render, '/clip': clip, '/hover': hover }

if (existsSync(socketPath)) unlinkSync(socketPath)

// A server stopped by the idle timer leaves its last PNGs on purpose, and any session may still show them.
// Only a file whose Claude owner is gone and that has sat for a while is nobody's.
const STALE_MS = 10 * 60_000

for (const name of readdirSync('/dev/shm')) {
  const owner = /^panel-(\d+)-\d+-h?\d+\.png$/.exec(name)?.[1]
  if (!owner) continue

  try {
    process.kill(Number(owner), 0)
  } catch {
    const file = `/dev/shm/${name}`

    try {
      if (Date.now() - statSync(file).mtimeMs > STALE_MS) rmSync(file, { force: true })
    } catch {}
  }
}

log('srv-start', { node: process.version, sock: socketPath, parent })

createServer(async (req, res) => {
  const reply = (status, value) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(value))
  }

  try {
    if (req.url === '/quit') {
      const { keepLast } = await body(req)
      const isKept = keepLast === true
      reply(200, { kept: isKept ? [...written] : [] })
      setTimeout(() => shutdown(isKept), 10)

      return
    }

    const route = routes[req.url]
    if (!route) return reply(404, { error: 'not found' })

    const began = performance.now()
    const answer = await route(await body(req))
    const route_ = req.url.slice(1)
    log(
      `srv-${route_}`,
      { ms: Math.round(performance.now() - began), bytes: lastShot.bytes, shotMs: lastShot.ms, shotH: lastShot.height, rev: page.rev, rssMb: mb(process.memoryUsage().rss), written: written.length, hovered: hovered.length },
      route_ !== 'render',
    )
    reply(200, answer)
  } catch (error) {
    if (error instanceof Conflict) log('srv-conflict', { route: req.url, message: error.message }, true)
    else log('srv-error', { route: req.url, message: String(error?.message ?? error) })
    reply(error instanceof BadRequest ? 400 : error instanceof Conflict ? 409 : 500, { error: String(error?.message ?? error) })
  }
}).listen(socketPath)

setInterval(() => {
  if (process.ppid !== parent) shutdown()
}, 500).unref?.()

process.on('SIGTERM', () => shutdown())
process.on('SIGINT', () => shutdown())
process.on('exit', () => chrome?.kill('SIGKILL'))
