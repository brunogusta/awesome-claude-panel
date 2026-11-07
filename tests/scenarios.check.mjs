import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { request } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', 'renderer', 'server.mjs')
const STYLE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'page', 'style.ts'), 'utf8').split('`')[1]

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
    req.end(JSON.stringify(body))
  })

const wait = async ok => {
  for (let i = 0; i < 100 && !ok(); i += 1) await new Promise(resolve => setTimeout(resolve, 50))
}

const descendants = pid => {
  try {
    const kids = execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' }).split('\n').filter(Boolean).map(Number)

    return kids.flatMap(kid => [kid, ...descendants(kid)])
  } catch {
    return []
  }
}

const rssMb = pids =>
  pids.reduce((sum, pid) => {
    try {
      return sum + Number(readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)?.[1] ?? 0) / 1024
    } catch {
      return sum
    }
  }, 0)

const withServer = async body => {
  const dir = mkdtempSync(join(tmpdir(), 'fp-scn-'))
  const socket = join(dir, 's.sock')
  const logFile = join(dir, 'debug.log')
  const server = spawn('node', [SERVER, socket, '', logFile], { stdio: 'ignore' })

  try {
    await wait(() => existsSync(socket))
    await body(socket, server.pid, logFile)
  } finally {
    await call(socket, '/quit', {}).catch(() => {})
    await wait(() => server.exitCode !== null)
    server.kill('SIGKILL')
    rmSync(dir, { recursive: true, force: true })
  }
}

const page = rows =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body><div class="top"><span class="proj">demo</span></div>${Array.from({ length: rows }, (_, i) => `<div class="file" data-act="file:/p/${i}"><span class="name">arquivo-${i}.ts</span><span class="dir">src</span></div>`).join('')}</body></html>`

const pngSize = file => {
  const png = readFileSync(file)

  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
}

const mine = pid => readdirSync('/dev/shm').filter(name => name.startsWith(`panel-${process.pid}-${pid}-`))

let seed = 12345
const next = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296

  return seed / 4294967296
}
const between = (low, high) => low + Math.floor(next() * (high - low + 1))

test('40 desenhos em tamanhos aleatórios: todos respondem, a imagem tem o tamanho pedido e a revisão só sobe', { skip: !hasChrome }, async () => {
  await withServer(async socket => {
    let last = 0

    for (let i = 0; i < 40; i += 1) {
      const width = between(60, 2600)
      const height = between(60, 1800)
      const scale = [0.5, 0.8, 1, 1.3, 2][between(0, 4)]
      const reply = await call(socket, '/render', { html: page(between(1, 60)), width, height, scale })

      assert.equal(reply.status, 200, `render ${width}x${height}@${scale}`)
      assert.ok(reply.json.rev > last)
      last = reply.json.rev

      const got = pngSize(reply.json.file)
      assert.ok(Math.abs(got.width - width) <= Math.ceil(scale), `largura ${got.width} vs ${width}`)
      assert.ok(Math.abs(got.height - Math.min(height, Math.round(reply.json.height))) <= Math.ceil(scale) + 1, `altura ${got.height} vs ${height}`)
      assert.ok(reply.json.height >= Math.round(height / scale) * scale - 2)
    }
  })
})

test('rajada de 25 pedidos ao mesmo tempo é atendida em fila, sem perder nenhum', { skip: !hasChrome }, async () => {
  await withServer(async socket => {
    const replies = await Promise.all(Array.from({ length: 25 }, (_, i) => call(socket, '/render', { html: page(10 + i), width: 300 + i * 20, height: 400, scale: 1 })))

    assert.ok(replies.every(one => one.status === 200))
    assert.deepEqual(
      replies.map(one => one.json.rev - replies[0].json.rev),
      Array.from({ length: 25 }, (_, i) => i),
    )
  })
})

test('muitos recortes e destaques não acumulam arquivos: 2 de desenho e no máximo 64 de destaque', { skip: !hasChrome }, async () => {
  await withServer(async (socket, pid) => {
    const first = await call(socket, '/render', { html: page(80), width: 702, height: 560, scale: 1.3 })

    for (let i = 0; i < 90; i += 1) await call(socket, '/hover', { act: `file:/p/${i % 40}`, y: 0, height: 560, rev: first.json.rev })
    for (let i = 0; i < 30; i += 1) await call(socket, '/clip', { y: between(0, 1500), height: 560 })

    const files = mine(pid)

    assert.ok(files.filter(name => /-h\d+\.png$/.test(name)).length <= 64)
    assert.ok(files.filter(name => !/-h\d+\.png$/.test(name)).length <= 2)
  })
})

test('página gigante é limitada a 8000 px de CSS e o servidor segue respondendo', { skip: !hasChrome }, async () => {
  await withServer(async socket => {
    const huge = await call(socket, '/render', { html: page(3000), width: 700, height: 500, scale: 1 })

    assert.equal(huge.status, 200)
    assert.ok(huge.json.height <= 8000)

    const after = await call(socket, '/render', { html: page(3), width: 700, height: 500, scale: 1 })

    assert.equal(after.status, 200)
  })
})

test('o uso de memória do servidor e do Chrome não cresce sem parar em 120 desenhos e destaques', { skip: !hasChrome }, async () => {
  await withServer(async (socket, pid) => {
    const first = await call(socket, '/render', { html: page(40), width: 1300, height: 1000, scale: 1.3 })
    const before = rssMb([pid, ...descendants(pid)])

    for (let i = 0; i < 120; i += 1) {
      const reply = await call(socket, '/render', { html: page(30 + (i % 20)), width: 1300, height: 1000, scale: 1.3 })

      if (i % 3 === 0) await call(socket, '/hover', { act: `file:/p/${i % 10}`, y: 0, height: 1000, rev: reply.json.rev })
    }

    const growth = rssMb([pid, ...descendants(pid)]) - before

    assert.ok(first.status === 200)
    assert.ok(growth < 200, `crescimento de ${Math.round(growth)} MB`)
  })
})

test('depois de matar o Chrome no meio de uma rajada, o servidor se recupera e as revisões antigas são recusadas', { skip: !hasChrome }, async () => {
  await withServer(async (socket, pid) => {
    const before = await call(socket, '/render', { html: page(10), width: 500, height: 400, scale: 1 })
    const chrome = descendants(pid)[0]

    process.kill(chrome, 'SIGKILL')
    await wait(() => descendants(pid).length === 0)

    const after = await call(socket, '/render', { html: page(10), width: 500, height: 400, scale: 1 })

    assert.equal(after.status, 200)
    assert.equal((await call(socket, '/hover', { act: 'file:/p/1', y: 0, height: 400, rev: before.json.rev })).status, 409)
    assert.equal((await call(socket, '/hover', { act: 'file:/p/1', y: 0, height: 400, rev: after.json.rev })).status, 200)
  })
})

test('o servidor escreve o próprio log em JSON, com início, Chrome pronto e cada desenho', { skip: !hasChrome }, async () => {
  await withServer(async (socket, _pid, logFile) => {
    const first = await call(socket, '/render', { html: page(5), width: 400, height: 300, scale: 1 })
    await call(socket, '/hover', { act: 'file:/p/1', y: 0, height: 300, rev: first.json.rev })

    const lines = readFileSync(logFile, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    const events = lines.map(one => one.ev)

    assert.ok(events.includes('srv-start'))
    assert.ok(events.includes('srv-chrome-ready'))
    assert.ok(events.includes('srv-render'))
    assert.ok(!events.includes('srv-hover'), 'destaque só entra no modo detalhado')

    const render = lines.find(one => one.ev === 'srv-render')

    assert.ok(render.bytes > 0 && render.ms >= 0 && render.rssMb > 0 && render.rev === first.json.rev)
  })
})

test('duas execuções do servidor nunca repetem a revisão: o destaque de um servidor não vale no outro', { skip: !hasChrome }, async () => {
  let firstRev = 0
  let firstServerSocket = ''

  await withServer(async socket => {
    firstRev = (await call(socket, '/render', { html: page(3), width: 300, height: 200, scale: 1 })).json.rev
    firstServerSocket = socket
  })
  await new Promise(resolve => setTimeout(resolve, 5))
  await withServer(async socket => {
    const second = await call(socket, '/render', { html: page(3), width: 300, height: 200, scale: 1 })

    assert.notEqual(second.json.rev, firstRev)
    assert.equal((await call(socket, '/hover', { act: 'file:/p/1', y: 0, height: 200, rev: firstRev })).status, 409)
    assert.notEqual(socket, firstServerSocket)
  })
})
