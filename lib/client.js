/**
 * dsh-statusbar — browser half.
 *
 * A compact, extensible bottom status bar scoped to the right sidebar.
 * Other client plugins register log channels and “new” menu entries through
 * the `statusbar` service; the built-in terminal runner is one provider.
 */
window.__ModuleLoader__.load({
  id: 'dsh-statusbar',
  factory(require) {
    'use strict'
    const React = require('react')
    const ReactDOM = require('react-dom')
    const { useEffect, useRef, useState } = React

    const API = '/statusbar'
    const COLLAPSED = 30
    const FONT = '12px/1.45 var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif)'
    const LABEL = 'var(--dsw-alias-label-tertiary, #888)'
    const BORDER = 'var(--dsw-alias-border-l1, rgba(127,127,127,.2))'

    const registry = {
      channels: new Map(),
      menu: new Map(),
      listeners: new Set(),
      emit() { for (const listener of this.listeners) { try { listener() } catch { /* isolated */ } } },
      snapshot() {
        return {
          channels: [...this.channels.values()].sort((a, b) => a.order - b.order),
          menu: [...this.menu.values()].sort((a, b) => a.order - b.order),
        }
      },
    }

    function createMenuItem(pathOrOptions, run) {
      const input = typeof pathOrOptions === 'string' ? { path: pathOrOptions, run } : { ...(pathOrOptions ?? {}) }
      const path = String(input.path ?? input.id ?? '').trim()
      if (path === '') throw new Error('MenuItem requires a path')
      const parts = path.split('/').map(part => part.trim()).filter(Boolean)
      return {
        ...input,
        id: String(input.id ?? path),
        path,
        parts,
        label: String(input.label ?? parts[parts.length - 1] ?? path),
        order: Number.isFinite(Number(input.order)) ? Number(input.order) : 100,
      }
    }

    const service = {
      MenuItem: createMenuItem,
      registerChannel(descriptor) {
        const id = String(descriptor?.id ?? '').trim()
        if (id === '') throw new Error('registerChannel requires an id')
        const channel = {
          id,
          title: String(descriptor.title ?? id),
          order: Number.isFinite(Number(descriptor.order)) ? Number(descriptor.order) : 100,
          description: typeof descriptor.description === 'string' ? descriptor.description : '',
          read: typeof descriptor.read === 'function' ? descriptor.read : async () => ({ text: '' }),
          write: typeof descriptor.write === 'function' ? descriptor.write : null,
          actions: Array.isArray(descriptor.actions) ? descriptor.actions : [],
          kind: descriptor.kind === 'terminal' ? 'terminal' : 'channel',
        }
        registry.channels.set(id, channel)
        registry.emit()
        return () => {
          if (registry.channels.get(id) === channel) {
            registry.channels.delete(id)
            registry.emit()
          }
        }
      },
      registerMenuItem(pathOrOptions, run) {
        const item = createMenuItem(pathOrOptions, run)
        registry.menu.set(item.id, item)
        registry.emit()
        return () => {
          if (registry.menu.get(item.id) === item) {
            registry.menu.delete(item.id)
            registry.emit()
          }
        }
      },
      subscribe(listener) {
        registry.listeners.add(listener)
        return () => registry.listeners.delete(listener)
      },
    }

    function installStyles() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-dsh-statusbar-style]') !== null) return
      const style = document.createElement('style')
      style.dataset.dshStatusbarStyle = 'true'
      style.textContent = [
        '.dsh-term-menu-item{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;padding:3px 7px;border:0;border-radius:4px;background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit;line-height:1.35}',
        '.dsh-term-menu-item:hover{background:var(--dsw-alias-bg-secondary, rgba(127,127,127,.12))}',
        '.dsh-term-menu-item:active{background:var(--dsw-alias-bg-secondary, rgba(127,127,127,.2))}',
        '.dsh-term-menu-item:disabled{opacity:.45;cursor:default}',
        '.dsh-term-menu-sep{height:.5px;margin:3px 5px;background:var(--dsw-alias-border-l1, rgba(127,127,127,.22))}',
        '.dsh-term-menu-title{font-size:10.5px;letter-spacing:.04em;color:var(--dsw-alias-label-tertiary);padding:3px 7px 2px}',
      ].join('\n')
      document.head.appendChild(style)
    }

    function LogViewer({ text }) {
      const ref = useRef(null)
      const [copied, setCopied] = useState(false)
      useEffect(() => {
        const element = ref.current
        if (element === null || document.activeElement === element || element.value === text) return
        const nearBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 24
        element.value = text
        if (nearBottom) element.scrollTop = element.scrollHeight
      }, [text])
      const copy = async () => {
        try {
          await navigator.clipboard.writeText(text)
        } catch {
          try { ref.current?.select(); document.execCommand('copy') } catch { /* ignore */ }
        }
        setCopied(true)
        setTimeout(() => setCopied(false), 1_200)
      }
      return React.createElement('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } },
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexShrink: 0 } },
          React.createElement('span', { style: { fontSize: 10.5, color: LABEL } }, '输出日志（可选择复制）'),
          React.createElement('button', {
            type: 'button', onClick: () => void copy(),
            style: { marginLeft: 'auto', padding: '1px 7px', border: `0.5px solid ${BORDER}`, borderRadius: 4, background: 'transparent', color: LABEL, font: FONT, fontSize: 10.5, cursor: 'pointer' },
          }, copied ? '已复制' : '复制')),
        React.createElement('textarea', {
          ref, readOnly: true, spellCheck: false, wrap: 'off',
          onBlur: event => { if (event.target.value !== text) event.target.value = text },
          style: {
            flex: 1, minHeight: 0, width: '100%', resize: 'none', border: 'none', outline: 'none', padding: 0, margin: 0,
            background: 'transparent', color: 'var(--dsw-alias-label-secondary)', userSelect: 'text',
            fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: 11.5, lineHeight: 1.45,
            whiteSpace: 'pre', overflow: 'auto',
          },
        }))
    }

    function percentOf(text, fallback) {
      const matches = String(text ?? '').match(/\[(\d{1,3})%\]/g)
      if (matches === null || matches.length === 0) return fallback
      const value = Number(matches[matches.length - 1].replace(/[^0-9]/g, ''))
      return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : fallback
    }

    function Panel({ ctx }) {
      installStyles()
      const [bounds, setBounds] = useState(null)
      const [height, setHeight] = useState(() => {
        try { return Math.max(COLLAPSED, Number(localStorage.getItem('dsh-statusbar-height')) || COLLAPSED) } catch { return COLLAPSED }
      })
      const [externalChannels, setExternalChannels] = useState([])
      const [externalMenu, setExternalMenu] = useState([])
      const [terminals, setTerminals] = useState([])
      const [selectedId, setSelectedId] = useState('')
      const [snapshot, setSnapshot] = useState(null)
      const [shells, setShells] = useState([])
      const [shellMenu, setShellMenu] = useState(false)
      const [creating, setCreating] = useState(false)
      const [command, setCommand] = useState('')
      const [input, setInput] = useState('')
      const [error, setError] = useState('')
      const [openGroup, setOpenGroup] = useState('')
      const expanded = height > 38

      const workspace = () => {
        const sessionId = (() => {
          try {
            const snapshotValue = ctx.get('sessions')?.list?.getSnapshot?.()
            const current = snapshotValue?.current
            if (typeof current === 'string' && current !== '') return current
            const ids = Array.isArray(snapshotValue?.ids) ? snapshotValue.ids : []
            return ids[ids.length - 1] ?? ''
          } catch { return '' }
        })()
        let cwd = ''
        try {
          const snapshotValue = ctx.get('sessions')?.list?.getSnapshot?.()
          cwd = snapshotValue?.byId?.[sessionId]?.cwd ?? ''
        } catch { /* optional */ }
        return { sessionId, cwd }
      }

      useEffect(() => {
        const update = () => {
          const open = document.querySelector('[data-sidebar-right-open]')
          if (open === null) { setBounds(null); return }
          const element = document.querySelector('[data-sidebar-right-panel]')
          if (element === null) { setBounds(null); return }
          const rect = element.getBoundingClientRect()
          if (rect.width < 120) { setBounds(null); return }
          const next = { left: Math.round(rect.left), width: Math.round(rect.width), bottom: Math.max(0, Math.round(window.innerHeight - rect.bottom)) }
          setBounds(previous => previous !== null && previous.left === next.left && previous.width === next.width && previous.bottom === next.bottom ? previous : next)
        }
        update()
        const timer = setInterval(update, 400)
        window.addEventListener('resize', update)
        return () => { clearInterval(timer); window.removeEventListener('resize', update) }
      }, [])

      useEffect(() => {
        const sync = () => {
          const data = registry.snapshot()
          setExternalChannels(data.channels)
          setExternalMenu(data.menu)
        }
        sync()
        return service.subscribe(sync)
      }, [])

      useEffect(() => {
        let alive = true
        const load = async () => {
          const { sessionId, cwd } = workspace()
          if (cwd === '') return
          try {
            const query = new URLSearchParams({ root: cwd })
            if (sessionId !== '') query.set('sessionId', sessionId)
            const response = await fetch(`${API}/terminals?${query.toString()}`)
            if (!response.ok) return
            const data = await response.json()
            if (alive && Array.isArray(data?.terminals)) setTerminals(data.terminals)
          } catch { /* ignore */ }
        }
        void load()
        const timer = setInterval(() => { void load() }, 3_000)
        return () => { alive = false; clearInterval(timer) }
      }, [])

      const channels = [
        ...externalChannels,
        ...terminals.map(terminal => ({
          id: terminal.id,
          title: terminal.name,
          order: 1_000 + Number(terminal.startedAt ?? 0) / 1e13,
          description: terminal.status === 'running' ? '运行中' : terminal.status,
          kind: 'terminal',
          terminal,
        })),
      ].sort((left, right) => left.order - right.order)
      const selected = channels.find(channel => channel.id === selectedId) ?? channels[0] ?? null

      useEffect(() => {
        if (channels.length === 0) { setSelectedId(''); return }
        if (!channels.some(channel => channel.id === selectedId)) setSelectedId(channels[0].id)
      }, [channels, selectedId])

      useEffect(() => {
        if (selected === null) { setSnapshot(null); return }
        let alive = true
        const load = async () => {
          try {
            if (selected.kind === 'terminal') {
              const { sessionId, cwd } = workspace()
              if (cwd === '') return
              const response = await fetch(`${API}/terminal/output`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ root: cwd, sessionId, id: selected.id }),
              })
              if (!response.ok) return
              const data = await response.json()
              if (alive && data?.terminal !== undefined) setSnapshot({ ...data.terminal, text: data.terminal.logs })
            } else {
              const data = await selected.read()
              if (alive) setSnapshot(data ?? { text: '' })
            }
          } catch (error) {
            if (alive) setSnapshot({ text: `读取失败：${error?.message ?? error}` })
          }
        }
        void load()
        const timer = setInterval(() => { void load() }, 900)
        return () => { alive = false; clearInterval(timer) }
      }, [selected?.id, selected?.kind])

      useEffect(() => {
        if (!shellMenu || shells.length > 0) return
        let alive = true
        void fetch(`${API}/shells`).then(response => response.ok ? response.json() : null)
          .then(data => { if (alive && Array.isArray(data?.shells)) setShells(data.shells) })
          .catch(() => {})
        return () => { alive = false }
      }, [shellMenu, shells.length])

      useEffect(() => {
        if (!shellMenu) return
        const close = event => {
          if (event.target?.closest?.('[data-statusbar-menu],[data-statusbar-trigger]')) return
          setShellMenu(false)
        }
        const key = event => { if (event.key === 'Escape') setShellMenu(false) }
        document.addEventListener('mousedown', close, true)
        document.addEventListener('keydown', key, true)
        return () => {
          document.removeEventListener('mousedown', close, true)
          document.removeEventListener('keydown', key, true)
        }
      }, [shellMenu])

      useEffect(() => {
        try { localStorage.setItem('dsh-statusbar-height', String(height)) } catch { /* ignore */ }
      }, [height])

      useEffect(() => {
        const surface = document.querySelector('[data-sidebar-right-panel] [data-dockkit-surface]')
        if (surface === null) return () => {}
        const previous = surface.style.height
        surface.style.height = `calc(100% - ${height}px)`
        surface.style.minHeight = '0'
        return () => { surface.style.height = previous }
      }, [height, bounds])

      if (bounds === null) return null

      const text = selected?.kind === 'terminal' ? String(snapshot?.text ?? '') : String(snapshot?.text ?? '')
      const fallbackPercent = selected?.kind === 'terminal'
        ? (snapshot?.status === 'running' ? 0 : 0)
        : 0
      const percent = percentOf(text, Number.isFinite(Number(snapshot?.percent)) ? Number(snapshot.percent) : fallbackPercent)
      const statusText = selected === null ? '暂无通道' : (snapshot?.status ?? selected.description ?? '')
      const summary = selected === null ? '暂无通道' : `${selected.title}${statusText ? ` · ${statusText}` : ''}`

      const startDrag = event => {
        event.preventDefault()
        const startY = event.clientY
        const startHeight = height
        const move = moveEvent => {
          const maxHeight = Math.min(460, Math.max(160, window.innerHeight * 0.55))
          setHeight(Math.max(COLLAPSED, Math.min(maxHeight, startHeight + startY - moveEvent.clientY)))
        }
        const up = () => {
          document.removeEventListener('pointermove', move)
          document.removeEventListener('pointerup', up)
        }
        document.addEventListener('pointermove', move)
        document.addEventListener('pointerup', up)
      }

      const startTerminal = async (payload) => {
        const { sessionId, cwd } = workspace()
        if (cwd === '') return
        setError('')
        setShellMenu(false)
        try {
          const response = await fetch(`${API}/terminal/start`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ root: cwd, sessionId, ...payload }),
          })
          const data = await response.json()
          if (!response.ok || data?.ok !== true) throw new Error(data?.error ?? `HTTP ${response.status}`)
          setTerminals(previous => [data.terminal, ...previous.filter(terminal => terminal.id !== data.terminal.id)])
          setSelectedId(data.terminal.id)
          setCreating(false)
          setCommand('')
        } catch (error) {
          setError(String(error?.message ?? error))
        }
      }

      const send = async () => {
        const value = input.trim()
        if (value === '' || selected === null) return
        setInput('')
        const { sessionId, cwd } = workspace()
        try {
          if (selected.kind === 'terminal') {
            if (cwd === '') return
            const response = await fetch(`${API}/terminal/input`, {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ root: cwd, sessionId, id: selected.id, text: value }),
            })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
          } else if (typeof selected.write === 'function') {
            const next = await selected.write(value)
            if (next !== undefined) setSnapshot(next)
          }
        } catch (error) {
          setError(String(error?.message ?? error))
        }
      }

      const closeTerminal = async (id) => {
        const { sessionId, cwd } = workspace()
        if (cwd === '') return
        try {
          await fetch(`${API}/terminal/stop`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ root: cwd, sessionId, id }),
          })
        } catch { /* ignore */ }
        setTerminals(previous => previous.filter(terminal => terminal.id !== id))
        if (selectedId === id) setSelectedId('')
      }

      const channelRow = (channel, closable) => React.createElement('div', { key: channel.id, style: { display: 'flex', alignItems: 'center', gap: 1, width: '100%' } },
        React.createElement('button', {
          type: 'button', onClick: () => setSelectedId(channel.id),
          title: channel.description ?? '',
          style: {
            flex: 1, minWidth: 0, padding: '4px 7px', border: 'none', borderRadius: 4, textAlign: 'left',
            background: selectedId === channel.id ? 'var(--dsw-alias-bg-secondary, rgba(127,127,127,.12))' : 'transparent',
            color: selectedId === channel.id ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
            font: FONT, fontSize: 11.5, cursor: 'pointer',
          },
        },
        React.createElement('span', { style: { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, channel.title),
        React.createElement('span', { style: { display: 'block', fontSize: 9.5, color: LABEL, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, channel.description ?? '')),
        closable ? React.createElement('button', {
          type: 'button', title: '结束终端',
          onClick: event => { event.stopPropagation(); void closeTerminal(channel.id) },
          style: { flexShrink: 0, width: 17, height: 17, padding: 0, border: 'none', borderRadius: 3, background: 'transparent', color: LABEL, font: FONT, fontSize: 13, lineHeight: '17px', cursor: 'pointer' },
        }, '×') : null)

      const menuGroups = (() => {
        const groups = new Map()
        const direct = []
        for (const item of externalMenu) {
          if (!Array.isArray(item.parts) || item.parts.length < 2) { direct.push(item); continue }
          const root = item.parts[0]
          const list = groups.get(root) ?? []
          list.push({ ...item, sub: item.parts.slice(1).join(' / ') })
          groups.set(root, list)
        }
        return { groups: [...groups.entries()], direct }
      })()

      const menuNode = (label, run, extra = null) => React.createElement('button', {
        type: 'button', className: 'dsh-term-menu-item',
        onClick: () => { setShellMenu(false); setOpenGroup(''); void run?.() },
        style: { color: 'var(--dsw-alias-label-primary)', font: FONT, fontSize: 11.5 },
      }, React.createElement('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, label), extra)

      const shellPopup = shellMenu ? React.createElement('div', {
        'data-statusbar-menu': 'true',
        style: {
          position: 'absolute', right: 7, bottom: 30, width: 220, maxHeight: Math.max(140, height - 40), overflow: 'auto',
          zIndex: 20, padding: 4, borderRadius: 6, border: `0.5px solid ${BORDER}`,
          background: 'var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-base, #fff))',
          boxShadow: '0 6px 20px rgba(0,0,0,.16)', display: 'flex', flexDirection: 'column', gap: 1,
        },
      },
      React.createElement('div', { className: 'dsh-term-menu-title' }, '新建'),
      shells.length === 0
        ? React.createElement('span', { style: { color: LABEL, fontSize: 10, padding: '4px 7px' } }, '检测终端类型…')
        : shells.map(shell => menuNode(shell.label, () => startTerminal({ shellId: shell.id, name: shell.label }),
          React.createElement('span', { style: { fontSize: 9.5, color: LABEL, fontFamily: 'ui-monospace, Consolas, monospace' } }, shell.command.split(/[\\/]/).pop()))),
      React.createElement('div', { className: 'dsh-term-menu-sep' }),
      menuNode('自定义命令…', () => setCreating(true), React.createElement('span', { style: { fontSize: 9.5, color: LABEL } }, '一次性')),
      ...menuGroups.direct.map(item => menuNode(item.label, item.run)),
      ...menuGroups.groups.map(([label, items]) => React.createElement('div', { key: label, style: { display: 'flex', flexDirection: 'column' } },
        React.createElement('button', {
          type: 'button', className: 'dsh-term-menu-item',
          onMouseEnter: () => setOpenGroup(label),
          onClick: () => setOpenGroup(value => value === label ? '' : label),
          style: { color: 'var(--dsw-alias-label-primary)', font: FONT, fontSize: 11.5 },
        }, React.createElement('span', null, label), React.createElement('span', { style: { color: LABEL } }, openGroup === label ? '⌄' : '›')),
        openGroup === label ? items.map(item => React.createElement('button', {
          key: item.id, type: 'button', className: 'dsh-term-menu-item',
          onClick: () => { setShellMenu(false); setOpenGroup(''); void item.run?.() },
          style: { paddingLeft: 17, color: 'var(--dsw-alias-label-secondary)', font: FONT, fontSize: 11 },
        }, React.createElement('span', null, item.sub || item.label))) : null)),
      error !== '' ? React.createElement('span', { style: { color: 'var(--dsw-alias-state-error, #e06c75)', fontSize: 10, padding: '3px 7px', wordBreak: 'break-all' } }, error) : null)
        : null

      const channelList = React.createElement('div', {
        style: { width: 142, flexShrink: 0, borderLeft: `.5px solid ${BORDER}`, padding: '3px 4px', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 1 },
      },
      ...channels.map(channel => channelRow(channel, channel.kind === 'terminal')),
      creating ? React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 3, padding: '3px 2px' } },
        React.createElement('input', {
          autoFocus: true, value: command, onChange: event => setCommand(event.target.value),
          onKeyDown: event => {
            if (event.key === 'Enter') { event.preventDefault(); void startTerminal({ command }) }
            if (event.key === 'Escape') { setCreating(false); setCommand('') }
          },
          placeholder: '输入命令',
          style: { width: '100%', boxSizing: 'border-box', padding: '3px 5px', border: `0.5px solid ${BORDER}`, borderRadius: 4, background: 'transparent', color: 'inherit', font: FONT, fontSize: 11, outline: 'none' },
        }),
        React.createElement('div', { style: { display: 'flex', gap: 4 } },
          React.createElement('button', { type: 'button', onClick: () => void startTerminal({ command }), style: { flex: 1, padding: '2px 5px', border: `0.5px solid ${BORDER}`, borderRadius: 4, background: 'transparent', color: 'inherit', font: FONT, fontSize: 11, cursor: 'pointer' } }, '运行'),
          React.createElement('button', { type: 'button', onClick: () => { setCreating(false); setCommand('') }, style: { padding: '2px 5px', border: 'none', borderRadius: 4, background: 'transparent', color: LABEL, font: FONT, fontSize: 11, cursor: 'pointer' } }, '取消')))
        : React.createElement('button', {
          type: 'button', 'data-statusbar-trigger': 'true', onClick: () => setShellMenu(value => !value),
          style: { width: '100%', padding: '3px 7px', border: `0.5px dashed ${BORDER}`, borderRadius: 4, background: 'transparent', color: LABEL, font: FONT, fontSize: 11, cursor: 'pointer', textAlign: 'left' },
        }, '+ 新建'))

      const actions = selected?.actions ?? []
      const rightPane = React.createElement('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: '5px 9px 8px', fontSize: 12 } },
        React.createElement('div', { style: { flexShrink: 0, marginBottom: 4 } },
          React.createElement('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, whiteSpace: 'nowrap', overflow: 'hidden' } },
            React.createElement('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, summary),
            React.createElement('span', { style: { marginLeft: 'auto', color: LABEL, fontSize: 10.5 } }, `${percent}%`)),
          React.createElement('div', { style: { height: 3, borderRadius: 2, background: 'var(--dsw-alias-bg-secondary, rgba(127,127,127,.14))', overflow: 'hidden', marginTop: 4 } },
            React.createElement('div', { style: { width: `${percent}%`, height: '100%', background: 'var(--dsw-alias-state-success, #4ec9b0)', transition: 'width .25s' } }))),
        actions.length > 0 ? React.createElement('div', { style: { display: 'flex', gap: 4, marginBottom: 4, flexShrink: 0 } },
          actions.map(action => React.createElement('button', {
            key: action.label, type: 'button', onClick: () => void action.run?.(),
            style: { padding: '2px 8px', border: `0.5px solid ${BORDER}`, borderRadius: 4, background: 'transparent', color: 'var(--dsw-alias-label-primary)', font: FONT, fontSize: 11, cursor: 'pointer' },
          }, action.label))) : null,
        React.createElement(LogViewer, { text }),
        selected !== null ? React.createElement('div', { style: { display: 'flex', gap: 4, marginTop: 4, flexShrink: 0 } },
          React.createElement('input', {
            value: input, onChange: event => setInput(event.target.value),
            onKeyDown: event => { if (event.key === 'Enter') { event.preventDefault(); void send() } },
            placeholder: snapshot?.placeholder ?? (selected.kind === 'terminal' ? '输入命令，Enter 发送' : '输入…'),
            disabled: selected.kind !== 'terminal' && typeof selected.write !== 'function',
            style: { flex: 1, minWidth: 0, padding: '3px 6px', border: `0.5px solid ${BORDER}`, borderRadius: 4, background: 'transparent', color: 'inherit', font: FONT, fontSize: 11.5, outline: 'none' },
          }),
          React.createElement('button', {
            type: 'button', onClick: () => void send(),
            disabled: selected.kind !== 'terminal' && typeof selected.write !== 'function',
            style: { padding: '3px 8px', border: `0.5px solid ${BORDER}`, borderRadius: 4, background: 'transparent', color: 'inherit', font: FONT, fontSize: 11, cursor: 'pointer' },
          }, '发送')) : null)

      return React.createElement('div', {
        'data-dsh-statusbar': 'true',
        style: {
          position: 'fixed', left: `${bounds.left}px`, width: `${bounds.width}px`, bottom: `${bounds.bottom}px`,
          zIndex: 2147482500, height: `${height}px`, display: 'flex', flexDirection: 'column',
          borderTop: `.5px solid ${BORDER}`, background: 'var(--dsw-alias-bg-base, #fff)', color: 'var(--dsw-alias-label-primary, inherit)',
          font: FONT, boxShadow: expanded ? '0 -6px 18px rgba(0,0,0,.08)' : 'none', overflow: 'hidden', userSelect: 'none', boxSizing: 'border-box',
        },
      },
      React.createElement('div', { onPointerDown: startDrag, title: '拖动调整高度', style: { height: 5, flexShrink: 0, cursor: 'ns-resize' } }),
      React.createElement('div', {
        onClick: () => setHeight(expanded ? COLLAPSED : Math.max(200, height)),
        style: { display: 'flex', alignItems: 'center', gap: 7, padding: '0 8px', height: 25, flexShrink: 0, cursor: 'pointer' },
      },
      React.createElement('span', { style: { width: 6, height: 6, borderRadius: '50%', background: 'var(--dsw-alias-state-success, #4ec9b0)', flexShrink: 0 } }),
      React.createElement('span', { style: { overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' } }, summary),
      React.createElement('span', { style: { marginLeft: 'auto', color: LABEL, fontSize: 10.5 } }, `${percent}%`),
      React.createElement('span', { style: { color: LABEL, fontSize: 11, width: 14, textAlign: 'center' }, title: expanded ? '收起' : '展开' }, expanded ? '⌄' : '⌃')),
      expanded ? React.createElement('div', { style: { flex: 1, minHeight: 0, display: 'flex', borderTop: `.5px solid ${BORDER}` } }, rightPane, channelList) : null,
      shellPopup)
    }

    return {
      name: 'dsh-statusbar',
      apply(ctx) {
        installStyles()
        window.__dshStatusbar = service
        try {
          if (typeof ctx.reflect?.provide === 'function') ctx.reflect.provide('statusbar', service)
          else if (typeof ctx.provide === 'function') ctx.provide('statusbar', service)
        } catch { /* another statusbar may own the name */ }
        const host = document.createElement('div')
        host.dataset.dshStatusbarRoot = 'true'
        document.body.appendChild(host)
        const root = ReactDOM.createRoot(host)
        root.render(React.createElement(Panel, { ctx }))
        ctx.effect(() => () => {
          try { root.unmount() } catch { /* ignore */ }
          host.remove()
          if (window.__dshStatusbar === service) delete window.__dshStatusbar
        }, 'dsh-statusbar: client panel')
      },
    }
  },
})
