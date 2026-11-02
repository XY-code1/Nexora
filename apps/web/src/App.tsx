import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiClient, ApiError, type Human3Trend, type Memory, type OnboardingState, type OnboardingTopic, type PrivacyAudit, type ProfileOverview, type TimelineItem } from './api'
import './App.css'

type Notice = { kind: 'success' | 'error'; text: string } | null
type View = 'review' | 'onboarding' | 'profile' | 'timeline' | 'privacy' | 'human3'

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
  const [view, setView] = useState<View>('review')
  const [profileView, setProfileView] = useState<ProfileOverview | null>(null)
  const [timelineView, setTimelineView] = useState<TimelineItem[] | null>(null)
  const [privacyView, setPrivacyView] = useState<PrivacyAudit | null>(null)
  const [human3View, setHuman3View] = useState<Human3Trend | null>(null)
  const [onboardingView, setOnboardingView] = useState<OnboardingState | null>(null)
  const [visualLoading, setVisualLoading] = useState<View | null>(null)
  const sessionEpoch = useRef(0)
  const viewRequest = useRef(0)
  const visualAbort = useRef<AbortController | null>(null)
  const sessionAbort = useRef<AbortController | null>(null)

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
    const epoch = ++sessionEpoch.current
    sessionAbort.current?.abort()
    const controller = new AbortController()
    sessionAbort.current = controller
    setConnecting(true)
    setGateError('')
    try {
      const nextClient = new ApiClient(nextToken)
      const result = await nextClient.listCandidates(controller.signal)
      if (epoch !== sessionEpoch.current) return
      setToken(nextToken)
      applyMemories(result)
      setProfileView(null); setTimelineView(null); setPrivacyView(null); setHuman3View(null); setOnboardingView(null)
      setNotice(null)
    } catch (error) {
      if (controller.signal.aborted || epoch !== sessionEpoch.current) return
      setToken('')
      setGateError(error instanceof ApiError && error.status === 401 ? '启动令牌无效，请检查后重新输入。' : messageFor(error))
    } finally {
      if (epoch === sessionEpoch.current) setConnecting(false)
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
    const epoch = sessionEpoch.current
    const signal = sessionAbort.current?.signal
    setLoading(true)
    try {
      const result = await client.listCandidates(signal)
      if (epoch !== sessionEpoch.current || signal?.aborted) return
      applyMemories(result)
    } catch (error) {
      if (epoch !== sessionEpoch.current || signal?.aborted) return
      if (error instanceof ApiError && error.status === 401) {
        disconnect('会话已失效，请重新连接。')
      } else {
        setNotice({ kind: 'error', text: messageFor(error) })
      }
    } finally { if (epoch === sessionEpoch.current) setLoading(false) }
  }

  function disconnect(message = '') {
    sessionEpoch.current += 1
    viewRequest.current += 1
    visualAbort.current?.abort()
    sessionAbort.current?.abort()
    setToken('')
    setMemories([])
    setSelectedId(null)
    setDraft('')
    setNotice(null)
    setView('review')
    setProfileView(null); setTimelineView(null); setPrivacyView(null); setHuman3View(null); setOnboardingView(null)
    setVisualLoading(null)
    setGateError(message)
  }

  async function openView(next: View) {
    if (!client) return
    setView(next)
    setNotice(null)
    visualAbort.current?.abort()
    viewRequest.current += 1
    setVisualLoading(null)
    if (next === 'review') { void loadCandidates(); return }
    const controller = new AbortController()
    visualAbort.current = controller
    const epoch = sessionEpoch.current
    const request = viewRequest.current
    if (next === 'profile') setProfileView(null)
    if (next === 'onboarding') setOnboardingView(null)
    if (next === 'timeline') setTimelineView(null)
    if (next === 'privacy') setPrivacyView(null)
    if (next === 'human3') setHuman3View(null)
    setVisualLoading(next)
    try {
      const result = next === 'onboarding' ? await client.onboarding(controller.signal)
        : next === 'profile' ? await client.profileOverview(controller.signal)
        : next === 'timeline' ? await client.timeline(controller.signal)
          : next === 'privacy' ? await client.privacyAudit(controller.signal)
            : await client.human3Trend(controller.signal)
      if (epoch !== sessionEpoch.current || request !== viewRequest.current) return
      if (next === 'onboarding') setOnboardingView(result as OnboardingState)
      if (next === 'profile') setProfileView(result as ProfileOverview)
      if (next === 'timeline') setTimelineView(result as TimelineItem[])
      if (next === 'privacy') setPrivacyView(result as PrivacyAudit)
      if (next === 'human3') setHuman3View(result as Human3Trend)
    } catch (error) {
      if (controller.signal.aborted || epoch !== sessionEpoch.current || request !== viewRequest.current) return
      if (error instanceof ApiError && error.status === 401) disconnect('会话已失效，请重新连接。')
      else setNotice({ kind: 'error', text: messageFor(error) })
    } finally {
      if (epoch === sessionEpoch.current && request === viewRequest.current) setVisualLoading(null)
    }
  }

  async function saveOnboarding(topic: string, content: string) {
    if (!client) return
    const epoch = sessionEpoch.current
    const signal = sessionAbort.current?.signal
    setSaving(true)
    try {
      const result = await client.onboardingResponse(topic, content, signal)
      if (epoch !== sessionEpoch.current || signal?.aborted) return
      setOnboardingView(result.state)
      setNotice({ kind: 'success', text: '回答已保存为候选记忆，确认前不会成为长期事实。' })
    } catch (error) {
      if (epoch !== sessionEpoch.current || signal?.aborted) return
      setNotice({ kind: 'error', text: messageFor(error) })
    } finally { if (epoch === sessionEpoch.current) setSaving(false) }
  }

  async function save() {
    if (!client || !selected || !draft.trim()) return
    const epoch = sessionEpoch.current
    const signal = sessionAbort.current?.signal
    setSaving(true)
    try {
      const updated = await client.edit(selected.id, draft.trim(), selected.revision, signal)
      if (epoch !== sessionEpoch.current || signal?.aborted) return
      setMemories((items) => items.map((item) => item.id === updated.id ? updated : item))
      setNotice({ kind: 'success', text: '修改已保存。' })
    } catch (error) { if (epoch === sessionEpoch.current && !signal?.aborted) handleMutationError(error) } finally { if (epoch === sessionEpoch.current) setSaving(false) }
  }

  async function act(action: 'confirm' | 'reject') {
    if (!client || !selected) return
    const label = action === 'confirm' ? '确认这条记忆并允许已授权 AI 检索？' : '拒绝这条候选记忆？拒绝记录会保留用于审计。'
    if (!window.confirm(label)) return
    const epoch = sessionEpoch.current
    const signal = sessionAbort.current?.signal
    setSaving(true)
    try {
      await client.action(selected.id, action, selected.revision, rejectionReason.trim(), signal)
      if (epoch !== sessionEpoch.current || signal?.aborted) return
      setNotice({ kind: 'success', text: action === 'confirm' ? '记忆已确认。' : '候选记忆已拒绝。' })
      await loadCandidates()
    } catch (error) { if (epoch === sessionEpoch.current && !signal?.aborted) handleMutationError(error) } finally { if (epoch === sessionEpoch.current) setSaving(false) }
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
    const epoch = sessionEpoch.current
    const signal = sessionAbort.current?.signal
    setSaving(true)
    try {
      await client.shutdown(signal)
      if (epoch !== sessionEpoch.current || signal?.aborted) return
      setClosed(true)
    } catch (error) {
      if (epoch !== sessionEpoch.current || signal?.aborted) return
      setNotice({ kind: 'error', text: messageFor(error) })
    } finally { if (epoch === sessionEpoch.current) setSaving(false) }
  }

  if (closed) return <main className="gate"><section className="gate-panel"><p className="eyebrow">PERSONAL AI PROFILE / CLOSED</p><h1>本地服务已关闭</h1><p>你的私人档案仍保存在本地。现在可以关闭此浏览器标签页。</p></section></main>
  if (!token) return <TokenGate error={gateError} connecting={connecting} onConnect={connect} />

  return <main className="app-shell">
    <header className="topbar">
      <div><p className="eyebrow">PERSONAL AI PROFILE / REVIEW</p><h1>记忆审核空间</h1></div>
      <div className="topbar-actions"><span className="local-badge">仅限本机</span><button className="text-button" onClick={() => void loadCandidates()} disabled={loading}>刷新列表</button><button className="text-button" onClick={() => disconnect()}>断开连接</button><button className="text-button danger-link" onClick={() => void shutdown()} disabled={saving}>关闭服务</button></div>
    </header>

    <nav className="primary-nav" aria-label="档案功能">
      {([['review', '记忆审核'], ['onboarding', '对话式引导'], ['profile', '个人档案'], ['timeline', '记忆时间线'], ['privacy', '隐私审计'], ['human3', 'Human 3.0']] as [View, string][]).map(([key, label]) =>
        <button key={key} className={view === key ? 'active' : ''} aria-current={view === key ? 'page' : undefined} onClick={() => void openView(key)}>{label}</button>
      )}
    </nav>

    {view === 'review' && <section className="intro"><p>每一条候选记忆都需要你的决定。确认后，其他已授权 AI 才能检索它。</p><span>{memories.length} 条待审核</span></section>}
    {notice && <div className={`notice ${notice.kind}`} role="status"><span>{notice.text}</span>{notice.kind === 'error' && <button onClick={() => void loadCandidates()}>刷新数据</button>}</div>}

    {view === 'onboarding' && <OnboardingPage value={onboardingView} loading={visualLoading === 'onboarding'} saving={saving} onSave={saveOnboarding} onReview={() => void openView('review')} />}
    {view === 'profile' && <ProfilePage value={profileView} loading={visualLoading === 'profile'} />}
    {view === 'timeline' && <TimelinePage value={timelineView} loading={visualLoading === 'timeline'} />}
    {view === 'privacy' && <PrivacyPage value={privacyView} loading={visualLoading === 'privacy'} />}
    {view === 'human3' && <Human3Page value={human3View} loading={visualLoading === 'human3'} />}
    {view === 'review' && <section className="workspace" aria-label="候选记忆审核">
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
    </section>}
  </main>
}

function Loading() { return <div className="visual-panel" role="status">正在读取本地档案…</div> }

function OnboardingPage({ value, loading, saving, onSave, onReview }: { value: OnboardingState | null; loading: boolean; saving: boolean; onSave: (topic: string, content: string) => Promise<void>; onReview: () => void }) {
  const [answer, setAnswer] = useState('')
  const [skipped, setSkipped] = useState<string[]>([])
  if (loading || !value) return <Loading />
  const topic = value.topics.find((item) => item.status === 'available' && !skipped.includes(item.key))
  const pending = value.topics.filter((item) => item.status === 'pending').length
  const confirmed = value.topics.filter((item) => item.status === 'confirmed').length
  async function submit(item: OnboardingTopic) {
    if (!answer.trim()) return
    await onSave(item.key, answer.trim())
    setAnswer('')
  }
  return <section className="visual-page onboarding-page"><header><p className="eyebrow">LOCAL ONBOARDING</p><h2>通过对话建立你的档案</h2><p>{value.notice}</p></header>
    <div className="onboarding-progress" aria-label="引导进度"><span>{confirmed} 项已确认</span><span>{pending} 项待审核</span><span>{value.topics.length - confirmed - pending} 项可回答</span></div>
    {!topic ? <div className="empty-card"><h3>{value.completed ? '本轮引导已完成' : '已跳过本轮剩余问题'}</h3><p>{pending ? `还有 ${pending} 条回答正在等待你的确认。` : '你可以随时回来继续补充。'}</p>{pending > 0 && <button className="primary-action" onClick={onReview}>前往记忆审核</button>}</div> : <article className="conversation-card">
      <div className="assistant-message"><span>档案助手</span><p>{topic.prompt}</p></div>
      <label htmlFor="onboarding-answer">你的回答</label>
      <textarea id="onboarding-answer" value={answer} onChange={(event) => setAnswer(event.target.value)} maxLength={1000} placeholder="只填写你愿意保存为候选记忆的内容…" disabled={saving} />
      <p className="privacy-hint">不会保存聊天过程；点击继续后只创建一条待你审核的候选记忆。请勿填写密码、Token、验证码或证件信息。</p>
      <div className="onboarding-actions"><button className="secondary" onClick={() => { setSkipped((items) => [...items, topic.key]); setAnswer('') }} disabled={saving}>暂时跳过</button><button className="primary-action" onClick={() => void submit(topic)} disabled={saving || !answer.trim()}>{saving ? '正在保存…' : '保存为候选并继续'}</button></div>
    </article>}
    <div className="topic-status">{value.topics.map((item) => <div key={item.key}><span className={`topic-dot ${item.status}`} /><strong>{item.title}</strong><small>{item.status === 'confirmed' ? '已确认' : item.status === 'pending' ? '待审核' : skipped.includes(item.key) ? '本轮跳过' : '可回答'}</small></div>)}</div>
  </section>
}

function ProfilePage({ value, loading }: { value: ProfileOverview | null; loading: boolean }) {
  if (loading || !value) return <Loading />
  return <section className="visual-page"><header><p className="eyebrow">LOCAL PROFILE</p><h2>个人档案</h2><p>只显示当前 Vault 中经过权限裁剪的结构化内容。</p></header>
    {value.protected ? <div className="protected">此档案标记为 <code>{value.access}</code>，默认视图不显示内容。</div> : <div className="profile-grid">{value.sections.map((section) => <article key={section.title}><h3>{section.title}</h3>{section.items.length ? <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="muted">尚未填写</p>}</article>)}</div>}
  </section>
}

function TimelinePage({ value, loading }: { value: TimelineItem[] | null; loading: boolean }) {
  const [open, setOpen] = useState<string | null>(null)
  if (loading || !value) return <Loading />
  return <section className="visual-page"><header><p className="eyebrow">MEMORY LIFECYCLE</p><h2>记忆时间线</h2><p>未确认、denied 和 local-only 记录只显示元数据，不显示正文。</p></header>
    <div className="timeline">{value.length === 0 ? <p className="muted">还没有记忆记录。</p> : value.map((item) => <article key={item.id}><span className={`dot status-${item.status}`} /><div><p className="timeline-meta">{displayTime(item.updated || item.created)} · {item.status} · {item.access}</p><h3>{item.subject || item.type}</h3><p>来源：{item.sourceAgent}</p>{item.previewAvailable && <button className="reveal" onClick={() => setOpen(open === item.id ? null : item.id)}>{open === item.id ? '收起摘要' : '查看确认摘要'}</button>}{open === item.id && <p className="preview">{item.preview}</p>}</div></article>)}</div>
  </section>
}

function Counts({ values }: { values: Record<string, number> }) { return <div className="counts">{Object.entries(values).map(([key, count]) => <div key={key}><strong>{count}</strong><span>{key}</span></div>)}</div> }

function PrivacyPage({ value, loading }: { value: PrivacyAudit | null; loading: boolean }) {
  if (loading || !value) return <Loading />
  return <section className="visual-page"><header><p className="eyebrow">PRIVACY AUDIT</p><h2>隐私审计</h2><p>{value.totalMemories} 条记录，仅统计本地元数据与 MCP 审计事件。</p></header>
    <div className="audit-grid"><article><h3>访问级别</h3><Counts values={value.byAccess} /></article><article><h3>生命周期</h3><Counts values={value.byStatus} /></article><article><h3>MCP 事件</h3><Counts values={value.mcpEvents} /></article><article><h3>边界规则</h3><ul>{value.rules.map((rule) => <li key={rule}>{rule}</li>)}</ul></article></div>
    <section className="issues"><h3>需要检查</h3>{value.issues.length ? value.issues.map((issue) => <p key={issue.id}><code>{issue.id}</code>：{issue.issue}</p>) : <p className="good">没有发现权限元数据问题。</p>}</section>
  </section>
}

const dimensionNames: Record<string, string> = { mind: '心智', body: '身体', spirit: '意义与关系', vocation: '工作与创造' }
function Human3Page({ value, loading }: { value: Human3Trend | null; loading: boolean }) {
  if (loading || !value) return <Loading />
  return <section className="visual-page"><header><p className="eyebrow">HUMAN 3.0 / REFLECTION</p><h2>Human 3.0 趋势</h2><p className="disclaimer">{value.disclaimer}</p></header>
    {value.points.length === 0 ? <div className="empty-card"><h3>还没有已确认的复盘</h3><p>完成一次对话式复盘并由你确认后，趋势才会显示在这里。</p></div> : <div className="human-points">{value.points.map((point) => <article key={point.date}><h3>{point.date}</h3><div className="score-bars">{value.dimensions.map((key) => <div key={key}><span>{dimensionNames[key] ?? key}</span><progress max="10" value={point.scores[key] ?? 0} /><strong>{point.scores[key] ?? '—'}</strong></div>)}</div><p>{point.summary}</p></article>)}</div>}
  </section>
}

function messageFor(error: unknown) { return error instanceof Error ? error.message : '本地服务暂时不可用，请稍后重试。' }

export default App
