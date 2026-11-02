import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiClient, ApiError, type Memory } from './api'
import './App.css'

type Notice = { kind: 'success' | 'error'; text: string } | null

type TokenGateProps = {
  error: string
  connecting: boolean
  onConnect: (token: string) => Promise<void>
}

function displayTime(value: string) {
  if (!value) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function TokenGate({ error, connecting, onConnect }: TokenGateProps) {
  const [token, setToken] = useState('')
  const [fieldError, setFieldError] = useState('')
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => field.current?.focus(), [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!token.trim()) {
      setFieldError('请输入本次本地服务显示的启动令牌。')
      return
    }
    setFieldError('')
    await onConnect(token.trim())
  }

  return <main className="gate" aria-labelledby="gate-title">
    <section className="gate-panel">
      <p className="eyebrow">PERSONAL AI PROFILE / LOCAL</p>
      <h1 id="gate-title">连接你的本地档案</h1>
      <p>启动令牌只保留在当前页面内存中，关闭或刷新页面后需要重新连接。</p>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <label htmlFor="token">本地启动令牌</label>
        <input ref={field} id="token" type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} aria-describedby={fieldError || error ? 'token-error' : undefined} disabled={connecting} />
        {(fieldError || error) && <p id="token-error" className="field-error" role="alert">{fieldError || error}</p>}
        <button type="submit" disabled={connecting}>{connecting ? '正在连接…' : '连接审核空间'}</button>
      </form>
      <p className="quiet">令牌由本地启动器自动传递，开发模式下由 <code>python -m apps.api.main</code> 显示。</p>
    </section>
  </main>
}

function App() {
  const [token, setToken] = useState('')
  const [gateError, setGateError] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [memories, setMemories] = useState<Memory[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [rejectionReason, setRejectionReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const [closed, setClosed] = useState(false)

  const client = useMemo(() => token ? new ApiClient(token) : null, [token])
  const selected = memories.find((memory) => memory.id === selectedId) ?? null

  function applyMemories(result: Memory[]) {
    setMemories(result)
    const nextId = result.some((item) => item.id === selectedId) ? selectedId : result[0]?.id ?? null
    setSelectedId(nextId)
    setDraft(result.find((item) => item.id === nextId)?.content ?? '')
    setRejectionReason('')
  }

  async function connect(nextToken: string) {
    setConnecting(true)
    setGateError('')
    try {
      const nextClient = new ApiClient(nextToken)
      const result = await nextClient.listCandidates()
      setToken(nextToken)
      applyMemories(result)
      setNotice(null)
    } catch (error) {
      setToken('')
      setGateError(error instanceof ApiError && error.status === 401 ? '启动令牌无效，请检查后重新输入。' : messageFor(error))
    } finally {
      setConnecting(false)
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1))
    const bootstrapToken = params.get('token')
    if (bootstrapToken) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
      void connect(bootstrapToken)
    }
  }, []) // Launcher token is consumed once, removed from the URL, then kept only in memory.

  async function loadCandidates() {
    if (!client) return
    setLoading(true)
    try {
      applyMemories(await client.listCandidates())
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        disconnect('会话已失效，请重新连接。')
      } else {
        setNotice({ kind: 'error', text: messageFor(error) })
      }
    } finally { setLoading(false) }
  }

  function disconnect(message = '') {
    setToken('')
    setMemories([])
    setSelectedId(null)
    setDraft('')
    setNotice(null)
    setGateError(message)
  }

  async function save() {
    if (!client || !selected || !draft.trim()) return
    setSaving(true)
    try {
      const updated = await client.edit(selected.id, draft.trim(), selected.revision)
      setMemories((items) => items.map((item) => item.id === updated.id ? updated : item))
      setNotice({ kind: 'success', text: '修改已保存。' })
    } catch (error) { handleMutationError(error) } finally { setSaving(false) }
  }

  async function act(action: 'confirm' | 'reject') {
    if (!client || !selected) return
    const label = action === 'confirm' ? '确认这条记忆并允许已授权 AI 检索？' : '拒绝这条候选记忆？拒绝记录会保留用于审计。'
    if (!window.confirm(label)) return
    setSaving(true)
    try {
      await client.action(selected.id, action, selected.revision, rejectionReason.trim())
      setNotice({ kind: 'success', text: action === 'confirm' ? '记忆已确认。' : '候选记忆已拒绝。' })
      await loadCandidates()
    } catch (error) { handleMutationError(error) } finally { setSaving(false) }
  }

  function handleMutationError(error: unknown) {
    if (error instanceof ApiError && error.status === 401) {
      disconnect('会话已失效，请重新连接。')
    } else if (error instanceof ApiError && error.status === 409) {
      setNotice({ kind: 'error', text: '这条记忆刚刚被其他入口修改。已保留你的草稿，请刷新后核对再提交。' })
    } else {
      setNotice({ kind: 'error', text: messageFor(error) })
    }
  }

  async function shutdown() {
    if (!client || !window.confirm('关闭本地档案服务？关闭后此页面将停止连接。')) return
    setSaving(true)
    try {
      await client.shutdown()
      setClosed(true)
    } catch (error) {
      setNotice({ kind: 'error', text: messageFor(error) })
    } finally { setSaving(false) }
  }

  if (closed) return <main className="gate"><section className="gate-panel"><p className="eyebrow">PERSONAL AI PROFILE / CLOSED</p><h1>本地服务已关闭</h1><p>你的私人档案仍保存在本地。现在可以关闭此浏览器标签页。</p></section></main>
  if (!token) return <TokenGate error={gateError} connecting={connecting} onConnect={connect} />

  return <main className="app-shell">
    <header className="topbar">
      <div><p className="eyebrow">PERSONAL AI PROFILE / REVIEW</p><h1>记忆审核空间</h1></div>
      <div className="topbar-actions"><span className="local-badge">仅限本机</span><button className="text-button" onClick={() => void loadCandidates()} disabled={loading}>刷新列表</button><button className="text-button" onClick={() => disconnect()}>断开连接</button><button className="text-button danger-link" onClick={() => void shutdown()} disabled={saving}>关闭服务</button></div>
    </header>

    <section className="intro"><p>每一条候选记忆都需要你的决定。确认后，其他已授权 AI 才能检索它。</p><span>{memories.length} 条待审核</span></section>
    {notice && <div className={`notice ${notice.kind}`} role="status"><span>{notice.text}</span>{notice.kind === 'error' && <button onClick={() => void loadCandidates()}>刷新数据</button>}</div>}

    <section className="workspace" aria-label="候选记忆审核">
      <aside className="memory-list" aria-label="候选记忆列表">
        <div className="list-heading"><h2>待审核</h2><span>{loading ? '同步中' : `${memories.length} 条`}</span></div>
        {loading && <div className="skeletons" aria-label="加载中"><i /><i /><i /></div>}
        {!loading && memories.length === 0 && <div className="empty"><h2>暂时没有候选记忆</h2><p>继续与已连接的 AI 对话；新的候选记忆会在这里等待你的审核。</p></div>}
        {!loading && memories.map((memory) => <button key={memory.id} className={`memory-row ${memory.id === selectedId ? 'selected' : ''}`} onClick={() => { setSelectedId(memory.id); setDraft(memory.content); setRejectionReason('') }}>
          <span className="memory-row-meta">{memory.type} · {memory.sourceAgent}</span><strong>{memory.subject || '未命名候选记忆'}</strong><span>{memory.content}</span>
        </button>)}
      </aside>

      <section className="detail" aria-live="polite">
        {!selected && !loading && <div className="detail-empty"><p>从左侧选择一条候选记忆开始审核。</p></div>}
        {selected && <>
          <div className="detail-header"><div><p className="eyebrow">CANDIDATE / {selected.type.toUpperCase()}</p><h2>{selected.subject || '未命名候选记忆'}</h2></div><span className="status">候选</span></div>
          <dl className="metadata"><div><dt>来源</dt><dd>{selected.sourceAgent}</dd></div><div><dt>创建于</dt><dd>{displayTime(selected.created)}</dd></div><div><dt>隐私</dt><dd>待确认前不作为长期事实</dd></div></dl>
          <label htmlFor="memory-content">记忆内容</label>
          <textarea id="memory-content" value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={4000} disabled={saving} />
          <label htmlFor="rejection-reason">拒绝原因（可选）</label>
          <input id="rejection-reason" value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} maxLength={200} placeholder="例如：不是长期信息" disabled={saving} />
          <div className="detail-footer"><p>{draft.length}/4000</p><div className="actions"><button className="secondary" onClick={() => void save()} disabled={saving || !draft.trim()}>保存修改</button><button className="danger" onClick={() => void act('reject')} disabled={saving}>拒绝</button><button onClick={() => void act('confirm')} disabled={saving}>确认记忆</button></div></div>
        </>}
      </section>
    </section>
  </main>
}

function messageFor(error: unknown) { return error instanceof Error ? error.message : '本地服务暂时不可用，请稍后重试。' }

export default App
