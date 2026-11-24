/**
 * Small command-channel runner used by the web log panel.
 *
 * This is intentionally not a PTY: it runs a user-provided command, captures
 * stdout/stderr, and exposes the output as a selectable log stream. LSP progress
 * uses the same channel shape, so the UI can list LSP and custom commands in one
 * place and parse `[NN%]` markers from either stream.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

const terminals = new Map()
let sequence = 0
const MAX_LOG_CHARS = 240_000

const SHELL_CANDIDATES = [
  { id: 'pwsh', label: 'PowerShell 7', command: 'pwsh', args: ['-NoLogo'] },
  { id: 'powershell', label: 'Windows PowerShell', command: 'powershell', args: ['-NoLogo'] },
  { id: 'cmd', label: 'Command Prompt', command: 'cmd', args: ['/Q'] },
  { id: 'wsl', label: 'WSL', command: 'wsl', args: [] },
  { id: 'bash', label: 'Bash', command: 'bash', args: ['-i'] },
  {
    id: 'gitbash',
    label: 'Git Bash',
    command: 'C:\\Program Files\\Git\\bin\\bash.exe',
    args: ['--login', '-i'],
  },
]

function findExecutable(command) {
  if (isAbsolute(command)) return existsSync(command) ? command : null
  if (existsSync(command)) return command
  const extensions = (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
  for (const directory of String(process.env.PATH ?? '').split(';')) {
    if (directory.trim() === '') continue
    for (const extension of ['', ...extensions]) {
      const candidate = join(directory.trim(), command + extension)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

export function listShells() {
  const seen = new Set()
  const out = []
  for (const candidate of SHELL_CANDIDATES) {
    const executable = findExecutable(candidate.command)
    if (executable === null || seen.has(executable.toLowerCase())) continue
    seen.add(executable.toLowerCase())
    out.push({
      id: candidate.id,
      label: candidate.label,
      command: executable,
      args: candidate.args.slice(),
    })
  }
  return out
}

function normalizeKey(root) {
  const value = resolve(String(root ?? ''))
  return /^[A-Za-z]:\\/.test(value) ? value.replace(/\\/g, '/').toLowerCase() : value.replace(/\\/g, '/')
}

function decodeOutput(chunk) {
  if (typeof chunk === 'string') return chunk
  try {
    const utf8 = new TextDecoder('utf-8').decode(chunk)
    let gbk
    try { gbk = new TextDecoder('gb18030').decode(chunk) } catch { gbk = utf8 }
    const bad = value => (value.match(/\uFFFD/g) ?? []).length
    return bad(gbk) < bad(utf8) ? gbk : utf8
  } catch {
    return String(chunk)
  }
}

function append(state, chunk) {
  const text = decodeOutput(chunk)
  if (text === '') return
  const stamp = new Date().toLocaleTimeString()
  for (const line of text.split(/\r?\n/)) {
    if (line === '' && state.logs.endsWith('\n')) continue
    state.logs += `[${stamp}] ${line}\n`
  }
  if (state.logs.length > MAX_LOG_CHARS) state.logs = state.logs.slice(-MAX_LOG_CHARS)
}

function snapshot(state) {
  return {
    id: state.id,
    root: state.root,
    name: state.name,
    command: state.command,
    status: state.status,
    exitCode: state.exitCode,
    startedAt: state.startedAt,
    logs: state.logs,
  }
}

function killTree(child) {
  if (child === null || child === undefined) return
  if (process.platform === 'win32' && Number.isInteger(child.pid)) {
    try { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).unref(); return } catch { /* fallback */ }
  }
  try { child.kill('SIGKILL') } catch { /* gone */ }
}

export function startTerminal({ root, command, name, shellId }) {
  const cwd = resolve(String(root ?? process.cwd()))
  const trimmed = String(command ?? '').trim()
  const shell = shellId === undefined ? null : listShells().find(candidate => candidate.id === shellId) ?? null
  if (shell === null && trimmed === '') throw new Error('command is empty')
  const id = `term-${Date.now().toString(36)}-${++sequence}`
  const executable = shell === null ? trimmed : shell.command
  const args = shell === null ? [] : shell.args
  const child = spawn(executable, args, {
    cwd,
    shell: shell === null,
    windowsHide: true,
    // Keep stdin open so an interactive shell stays alive; output is captured.
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '0' },
  })
  const display = shell === null ? trimmed : `${shell.command} ${shell.args.join(' ')}`.trim()
  const state = {
    id,
    root: normalizeKey(cwd),
    name: String(name ?? (shell === null ? trimmed.split(/\s+/)[0] : shell.label) ?? 'terminal').slice(0, 80),
    command: display,
    status: 'running',
    exitCode: null,
    startedAt: Date.now(),
    logs: `[${new Date().toLocaleTimeString()}] $ ${display}\n`,
    child,
  }
  child.stdout?.on('data', chunk => append(state, chunk))
  child.stderr?.on('data', chunk => append(state, chunk))
  child.once('error', error => {
    state.status = 'error'
    append(state, `启动失败：${error?.message ?? error}\n`)
  })
  child.once('exit', (code, signal) => {
    state.status = code === 0 ? 'exited' : 'failed'
    state.exitCode = code
    append(state, `\n进程结束 code=${code ?? 'null'}${signal ? ` signal=${signal}` : ''}\n`)
    state.child = null
  })
  terminals.set(id, state)
  return snapshot(state)
}

export function listTerminals(root) {
  const key = normalizeKey(root)
  return [...terminals.values()]
    .filter(state => state.root === key)
    .sort((left, right) => left.startedAt - right.startedAt)
    .map(state => ({
      id: state.id,
      name: state.name,
      command: state.command,
      status: state.status,
      exitCode: state.exitCode,
      startedAt: state.startedAt,
    }))
}

export function readTerminal(root, id) {
  const state = terminals.get(String(id))
  if (state === undefined || state.root !== normalizeKey(root)) return null
  return snapshot(state)
}

export function stopTerminal(root, id) {
  const state = terminals.get(String(id))
  if (state === undefined || state.root !== normalizeKey(root)) return null
  if (state.child !== null) killTree(state.child)
  state.status = 'stopped'
  state.child = null
  append(state, `\n[${new Date().toLocaleTimeString()}] 已停止\n`)
  const result = snapshot(state)
  terminals.delete(String(id))
  return result
}

export function writeTerminal(root, id, text) {
  const state = terminals.get(String(id))
  if (state === undefined || state.root !== normalizeKey(root)) return null
  if (state.child === null || state.child.stdin === null || state.child.stdin.writable !== true) {
    throw new Error('terminal is not running')
  }
  const value = String(text ?? '')
  append(state, `\n> ${value}\n`)
  state.child.stdin.write(value.endsWith('\n') ? value : `${value}\n`)
  return snapshot(state)
}

export function disposeTerminals() {
  for (const state of terminals.values()) {
    if (state.child !== null) killTree(state.child)
  }
  terminals.clear()
}
