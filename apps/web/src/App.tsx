import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiClient, ApiError, type Memory } from './api'
import './App.css'

type Notice = { kind: 'success' | 'error'; text: string } | null

function displayTime(value: string) {
  if (!value) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function TokenGate({ onConnect }: { onConnect: (token: string) => void }) {
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => field.current?.focus(), [])

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!token.trim()) {
      setError('请输入本次本地服务显示的启动令牌。')
      return
    }
    onConnect(token.trim())
  }

  return <main className="gate" aria-labelledby="gate-title">
    <section className="gate-panel">
      <p className="eyebrow">PERSONAL AI PROFILE / LOCAL</p>
      <h1 id="gate-title">连接你的本地档案</h1>
      <p>启动令牌只保留在当前页面内存中，关闭或刷新页面后需要重新输入。</p>
      <form onSubmit={submit} noValidate>
        <label htmlFor="token">本地启动令牌</label>
        <input ref={field} id="token" type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} aria-describedby={error ? 'token-error' : undefined} />
        {error && <p id="token-error" className="field-error" role="alert">{error}</p>}
        <button type="submit">连接审核空间</button>
      </form>
      <p className="quiet">令牌由 <code>python -m apps.api.main</code> 启动时显示。</p>
    </section>
  </main>
}

function App() {
  const [token, setToken] = useState('')
  const [memories, setMemories] = useState<Memory[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  const client = useMemo(() => token ? new ApiClient(token) : null, [token])
  const selected = memories.find((memory) => memory.id === selectedId) ?? null

  async function loadCandidates(nextClient = client) {
    if (!nextClient) return
    setLoading(true)
    try {
      const result = await nextClient.listCandidates()
      setMemories(result)
      const nextId = result.some((item) => item.id === selectedId) ? selectedId : result[0]?.id ?? null
      setSelectedId(nextId)
      setDraft(result.find((item) => item.id === nextId)?.content ?? '')
    } catch (error) {
      setNotice({ kind: 'error', text: messageFor(error) })
    } finally {
      setLoading(false)
    }
  }

  function connect(nextToken: string) {
    const nextClient = new ApiClient(nextToken)
    setToken(nextToken)
    void loadCandidates(nextClient)
  }


  async function save() {
    if (!client || !selected || !draft.trim()) return
    setSaving(true)
    try {
      const updated = await client.edit(selected.id, draft.trim(), selected.revision)
      setMemories((items) => items.map((item) => item.id === updated.id ? updated : item))
      setNotice({ kind: 'success', text: '修改已保存。' })
    } catch (error) {
      handleMutationError(error)
    } finally { setSaving(false) }
  }

  async function act(action: 'confirm' | 'reject') {
    if (!client || !selected) return
    setSaving(true)
    try {
      await client.action(selected.id, action, selected.revision)
      setNotice({ kind: 'success', text: action === 'confirm' ? '记忆已确认。' : '候选记忆已拒绝。' })
      await loadCandidates()
    } catch (error) {
      handleMutationError(error)
    } finally { setSaving(false) }
  }

  function handleMutationError(error: unknown) {
    if (error instanceof ApiError && error.status === 409) {
      setNotice({ kind: 'error', text: '这条记忆刚刚被其他入口修改。已保留你的草稿，请刷新后核对再提交。' })
      return
    }
    setNotice({ kind: 'error', text: messageFor(error) })
  }

  if (!token) return <TokenGate onConnect={connect} />

  return <main className="app-shell">
    <header className="topbar">
      <div><p className="eyebrow">PERSONAL AI PROFILE / REVIEW</p><h1>记忆审核空间</h1></div>
      <div className="topbar-actions"><span className="local-badge">仅限本机</span><button className="text-button" onClick={() => void loadCandidates()} disabled={loading}>刷新列表</button></div>
    </header>

    <section className="intro"><p>每一条候选记忆都需要你的决定。确认后，其他已授权 AI 才能检索它。</p><span>{memories.length} 条待审核</span></section>
    {notice && <div className={`notice ${notice.kind}`} role="status"><span>{notice.text}</span>{notice.kind === 'error' && <button onClick={() => void loadCandidates()}>刷新数据</button>}</div>}

    <section className="workspace" aria-label="候选记忆审核">
      <aside className="memory-list" aria-label="候选记忆列表">
        <div className="list-heading"><h2>待审核</h2><span>{loading ? '同步中' : `${memories.length} 条`}</span></div>
        {loading && <div className="skeletons" aria-label="加载中"><i /><i /><i /></div>}
        {!loading && memories.length === 0 && <div className="empty"><h2>暂时没有候选记忆</h2><p>继续与已连接的 AI 对话；新的候选记忆会在这里等待你的审核。</p></div>}
        {!loading && memories.map((memory) => <button key={memory.id} className={`memory-row ${memory.id === selectedId ? 'selected' : ''}`} onClick={() => { setSelectedId(memory.id); setDraft(memory.content) }}>
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
          <div className="detail-footer"><p>{draft.length}/4000</p><div className="actions"><button className="secondary" onClick={() => void save()} disabled={saving || !draft.trim()}>保存修改</button><button className="danger" onClick={() => void act('reject')} disabled={saving}>拒绝</button><button onClick={() => void act('confirm')} disabled={saving}>确认记忆</button></div></div>
        </>}
      </section>
    </section>
  </main>
}

function messageFor(error: unknown) { return error instanceof Error ? error.message : '本地服务暂时不可用，请稍后重试。' }

export default App

