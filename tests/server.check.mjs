import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', 'renderer', 'server.mjs')

const root = join(homedir(), '.cache', 'ms-playwright')
const hasChrome = existsSync(root) && readdirSync(root).some(name => name.startsWith('chromium_headless_shell-'))

const call = (socket, path, body) =>
  new Promise((resolve, reject) => {
    const req = request({ socketPath: socket, path, method: 'POST' }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString()) }))
    })
    req.on('error', reject)
    req.end(body)
  })

const wait = async ok => {
  for (let i = 0; i < 100 && !ok(); i += 1) await new Promise(resolve => setTimeout(resolve, 50))
}

const childrenOf = pid => {
  try {
    return execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' }).split('\n').filter(Boolean).map(Number)
  } catch {
    return []
  }
}

const withServer = async body => {
  const dir = mkdtempSync(join(tmpdir(), 'fp-test-'))
  const socket = join(dir, 's.sock')
  const server = spawn('node', [SERVER, socket], { stdio: 'ignore' })

  try {
    await wait(() => existsSync(socket))
    await body(socket, server.pid)
  } finally {
    await call(socket, '/quit', '').catch(() => {})
    await wait(() => server.exitCode !== null)
    server.kill('SIGKILL')
    rmSync(dir, { recursive: true, force: true })
  }
}

const PAGE = JSON.stringify({ html: '<body style="margin:0"><button data-act="a">a</button></body>', width: 200, height: 100 })

test('bad requests answer 400 and leave the server running', async () => {
  await withServer(async (socket, pid) => {
    assert.equal((await call(socket, '/render', '{nope')).status, 400)
    assert.equal((await call(socket, '/render', JSON.stringify({ html: 1, width: 10, height: 10 }))).status, 400)
    assert.equal((await call(socket, '/render', JSON.stringify({ html: '', width: 'x', height: 10 }))).status, 400)
    assert.equal((await call(socket, '/clip', JSON.stringify({ y: 'a', height: 10 }))).status, 400)
    assert.equal((await call(socket, '/clip', '[')).status, 400)
    process.kill(pid, 0)
    assert.equal((await call(socket, '/clip', JSON.stringify({ y: 0, height: 10 }))).status, 500)
  })
})

test('after Chrome dies the next render starts a fresh one at the requested size', { skip: !hasChrome }, async () => {
  await withServer(async (socket, pid) => {
    const first = await call(socket, '/render', PAGE)
    assert.equal(first.status, 200)
    assert.equal(first.json.hits[0].act, 'a')

    const before = childrenOf(pid)
    assert.equal(before.length, 1)
    process.kill(before[0], 'SIGKILL')
    await wait(() => childrenOf(pid).length === 0)

    const second = await call(socket, '/render', PAGE)
    assert.equal(second.status, 200)
    const png = readFileSync(second.json.file)
    assert.equal(png.readUInt32BE(16), 200)
    assert.equal(png.readUInt32BE(20), 100)
    assert.equal(childrenOf(pid).length, 1)
  })
})

test('a page shorter than the box is shot at the box size, so the background fills it', { skip: !hasChrome }, async () => {
  await withServer(async socket => {
    const html = '<body style="margin:0;background:#0d1117"><p>x</p></body>'
    const short = await call(socket, '/render', JSON.stringify({ html, width: 200, height: 400, scale: 2 }))
    assert.equal(short.json.height, 400)
    const png = readFileSync(short.json.file)
    assert.equal(png.readUInt32BE(16), 200)
    assert.equal(png.readUInt32BE(20), 400)

    const tall = await call(socket, '/render', JSON.stringify({ html: `<body style="margin:0">${'<p>x</p>'.repeat(200)}</body>`, width: 200, height: 400, scale: 2 }))
    assert.ok(tall.json.height > 400)
    assert.equal(readFileSync(tall.json.file).readUInt32BE(20), 400)
  })
})

test('hover shoots the page with the element marked, then leaves the page as it was', { skip: !hasChrome }, async () => {
  await withServer(async socket => {
    const html =
      '<style>body{margin:0;background:#000}div{height:40px;background:#111}[data-hot]{background:#fff}</style>' +
      '<div data-act="a"></div><div data-act="b"></div>'
    const page = await call(socket, '/render', JSON.stringify({ html, width: 200, height: 200 }))
    const before = await call(socket, '/clip', JSON.stringify({ y: 0, height: 200 }))
    const base = readFileSync(before.json.file)

    const marked = await call(socket, '/hover', JSON.stringify({ act: 'b', y: 0, height: 200, rev: page.json.rev }))
    assert.equal(marked.status, 200)
    assert.notDeepEqual(readFileSync(marked.json.file), base)
    assert.equal(readFileSync(marked.json.file).readUInt32BE(20), 200)

    const after = await call(socket, '/clip', JSON.stringify({ y: 0, height: 200 }))
    assert.deepEqual(readFileSync(after.json.file), base)

    assert.equal((await call(socket, '/hover', JSON.stringify({ act: 'b', y: 0, height: 200, rev: page.json.rev + 1 }))).status, 409)
    assert.equal((await call(socket, '/hover', JSON.stringify({ act: 'nope', y: 0, height: 200, rev: page.json.rev }))).status, 409)
    assert.equal((await call(socket, '/hover', JSON.stringify({ act: 1, y: 0, height: 200, rev: 1 }))).status, 400)
  })
})

test('quit with keepLast keeps the last PNG; a new server sweeps only stale files of dead owners', { skip: !hasChrome }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fp-keep-'))
  const socket = join(dir, 's.sock')
  const first = spawn('node', [SERVER, socket], { stdio: 'ignore' })
  const old = new Date(Date.now() - 3_600_000)
  const deadOwnerOld = '/dev/shm/panel-2147483000-1-1.png'
  const deadOwnerFresh = '/dev/shm/panel-2147483000-1-2.png'
  const aliveOwnerOld = `/dev/shm/panel-${process.pid}-1-3.png`
  let second
  let shotFile

  try {
    await wait(() => existsSync(socket))
    const shot = await call(socket, '/render', PAGE)
    shotFile = shot.json.file
    assert.ok(shot.json.file.includes(`panel-${process.pid}-${first.pid}-`))
    const quit = await call(socket, '/quit', JSON.stringify({ keepLast: true }))
    await wait(() => first.exitCode !== null)

    assert.deepEqual(quit.json.kept, [shot.json.file])
    assert.ok(existsSync(shot.json.file))

    for (const file of [deadOwnerOld, deadOwnerFresh, aliveOwnerOld]) writeFileSync(file, 'x')
    for (const file of [deadOwnerOld, aliveOwnerOld, shot.json.file]) utimesSync(file, old, old)

    second = spawn('node', [SERVER, socket], { stdio: 'ignore' })
    await wait(() => !existsSync(deadOwnerOld))

    assert.ok(!existsSync(deadOwnerOld))
    assert.ok(existsSync(deadOwnerFresh))
    assert.ok(existsSync(aliveOwnerOld))
    assert.ok(existsSync(shot.json.file))
    await wait(() => existsSync(socket))
    await call(socket, '/quit', '{}')
    await wait(() => second.exitCode !== null)
    assert.equal(second.exitCode, 0)
  } finally {
    first.kill('SIGKILL')
    second?.kill('SIGKILL')
    for (const file of [deadOwnerOld, deadOwnerFresh, aliveOwnerOld, shotFile]) if (file) rmSync(file, { force: true })
    rmSync(dir, { recursive: true, force: true })
  }
})
