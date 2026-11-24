/**
 * dsh-statusbar — Host half.
 *
 * Provides the process/terminal channels consumed by the bottom status-bar
 * client. The panel itself is in the client half; this half only owns the
 * lifetime of spawned command/shell processes and their captured output.
 */
import { disposeTerminals, listShells, listTerminals, readTerminal, startTerminal, stopTerminal, writeTerminal } from './terminals.js'

export const name = 'dsh-statusbar'
export const VERSION = '0.1.0'
export const inject = ['webServer', 'sessions']

const ROUTE_PREFIX = '/statusbar'
const MAX_BODY_BYTES = 128 * 1024

function writeJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function isLoopback(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4 && parts[0] === '127' && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function sameOrigin(req) {
  const host = req.headers.host
  if (host === undefined) return false
  const hostname = host.replace(/:\d+$/, '')
  if (!isLoopback(hostname)) return false
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (typeof origin === 'string') {
    try {
      if (new URL(origin).hostname !== hostname) return false
    } catch {
      return false
    }
  }
  return true
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('body too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('body must be an object')
  return parsed
}

function sessionCwd(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  const session = ctx.get('sessions')?.get?.(sessionId)
  const cwd = session?.header?.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
}

export function apply(ctx) {
  ctx.effect(() => () => disposeTerminals(), 'dsh-statusbar: dispose terminals')

  ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/shells`,
    handler: async (req, res) => {
      if (!sameOrigin(req)) return writeJson(res, 403, { ok: false, error: 'untrusted origin' })
      writeJson(res, 200, { ok: true, shells: listShells() })
    },
  })

  ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/terminals`,
    handler: async (req, res) => {
      if (!sameOrigin(req)) return writeJson(res, 403, { ok: false, error: 'untrusted origin' })
      const url = new URL(req.url, 'http://localhost')
      const root = url.searchParams.get('root') ?? sessionCwd(ctx, url.searchParams.get('sessionId') ?? undefined)
      if (typeof root !== 'string' || root === '') return writeJson(res, 200, { ok: true, terminals: [] })
      writeJson(res, 200, { ok: true, terminals: listTerminals(root) })
    },
  })

  ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/terminal/start`,
    handler: async (req, res) => {
      if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
      if (!sameOrigin(req)) return writeJson(res, 403, { ok: false, error: 'untrusted origin' })
      try {
        const body = await readBody(req)
        const root = body.root ?? sessionCwd(ctx, typeof body.sessionId === 'string' ? body.sessionId : undefined)
        if (typeof root !== 'string' || root === '') return writeJson(res, 400, { ok: false, error: 'workspace unavailable' })
        const command = typeof body.command === 'string' ? body.command.slice(0, 4000) : ''
        const terminal = startTerminal({
          root,
          command,
          shellId: typeof body.shellId === 'string' ? body.shellId : undefined,
          name: typeof body.name === 'string' ? body.name : undefined,
        })
        writeJson(res, 200, { ok: true, terminal })
      } catch (error) {
        writeJson(res, 400, { ok: false, error: String(error?.message ?? error) })
      }
    },
  })

  ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/terminal/output`,
    handler: async (req, res) => {
      if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
      if (!sameOrigin(req)) return writeJson(res, 403, { ok: false, error: 'untrusted origin' })
      try {
        const body = await readBody(req)
        const root = body.root ?? sessionCwd(ctx, typeof body.sessionId === 'string' ? body.sessionId : undefined)
        const terminal = typeof root === 'string' ? readTerminal(root, body.id) : null
        if (terminal === null) return writeJson(res, 404, { ok: false, error: 'terminal not found' })
        writeJson(res, 200, { ok: true, terminal })
      } catch (error) {
        writeJson(res, 400, { ok: false, error: String(error?.message ?? error) })
      }
    },
  })

  ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/terminal/input`,
    handler: async (req, res) => {
      if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
      if (!sameOrigin(req)) return writeJson(res, 403, { ok: false, error: 'untrusted origin' })
      try {
        const body = await readBody(req)
        const root = body.root ?? sessionCwd(ctx, typeof body.sessionId === 'string' ? body.sessionId : undefined)
        const terminal = typeof root === 'string' ? writeTerminal(root, body.id, body.text) : null
        writeJson(res, 200, terminal === null ? { ok: false, error: 'terminal not found' } : { ok: true, terminal })
      } catch (error) {
        writeJson(res, 400, { ok: false, error: String(error?.message ?? error) })
      }
    },
  })

  ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE_PREFIX}/terminal/stop`,
    handler: async (req, res) => {
      if (req.method !== 'POST') return writeJson(res, 405, { ok: false, error: 'method not allowed' })
      if (!sameOrigin(req)) return writeJson(res, 403, { ok: false, error: 'untrusted origin' })
      try {
        const body = await readBody(req)
        const root = body.root ?? sessionCwd(ctx, typeof body.sessionId === 'string' ? body.sessionId : undefined)
        const terminal = typeof root === 'string' ? stopTerminal(root, body.id) : null
        writeJson(res, 200, terminal === null ? { ok: false, error: 'terminal not found' } : { ok: true, terminal })
      } catch (error) {
        writeJson(res, 400, { ok: false, error: String(error?.message ?? error) })
      }
    },
  })
}
