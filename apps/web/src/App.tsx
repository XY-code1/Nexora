import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Brain, CalendarDots, ChartLineUp, ChatCircleDots, CirclesFour, Database, HardDrives, House, List, LockKey, Network, PlugsConnected, ShieldCheck, Sparkle, Stack, UserCircle, X } from '@phosphor-icons/react'
import { ApiClient, ApiError, type Human3Trend, type Memory, type MemoryStats, type MonthlyOverview, type MonthlyReflection, type MonthlyTrend, type OnboardingState, type ProfileOverview, type ReflectionDimension, type ReflectionEvent, type ReflectionGoal, type SecurityCenter, type TimelineItem } from './api'
import MemoryReviewPage from './MemoryReviewPage'
import ConversationalOnboardingPage from './ConversationalOnboardingPage'
import MonthlyReflectionPage from './MonthlyReflectionPage'
import SecurityCenterPage from './SecurityCenterPage'
import MonthlyTrendPage from './MonthlyTrendPage'
import GrowthDashboard from './GrowthDashboard'
import OverviewPage from './OverviewPage'
import BackupRecoveryPage from './BackupRecoveryPage'
import relationshipMap from './assets/relationship-map.webp'
import './App.css'

type Notice = { kind: 'success' | 'error'; text: string } | null
type View = 'overview' | 'review' | 'onboarding' | 'profile' | 'timeline' | 'privacy' | 'reflection' | 'human3' | 'monthly' | 'growth' | 'backup'

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
  const [memoryStats, setMemoryStats] = useState<MemoryStats>({ candidateMemories: 0, pendingReview: 0, confirmedMemories: 0 })
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
  const [securityView, setSecurityView] = useState<SecurityCenter | null>(null)
  const [clientCredential, setClientCredential] = useState('')
  const [human3View, setHuman3View] = useState<Human3Trend | null>(null)
  const [onboardingView, setOnboardingView] = useState<OnboardingState | null>(null)
  const [monthlyView, setMonthlyView] = useState<MonthlyOverview | null>(null)
  const [reflectionView, setReflectionView] = useState<MonthlyReflection | null>(null)
  const [monthlyTrendView, setMonthlyTrendView] = useState<MonthlyTrend | null>(null)
  const [visualLoading, setVisualLoading] = useState<View | null>(null)
  const [navigationOpen, setNavigationOpen] = useState(false)
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
      const [result, stats] = await Promise.all([nextClient.listCandidates(controller.signal), nextClient.memoryStats(controller.signal)])
      if (epoch !== sessionEpoch.current) return
      setToken(nextToken)
      applyMemories(result)
      setMemoryStats(stats)
      setProfileView(null); setTimelineView(null); setSecurityView(null); setHuman3View(null); setOnboardingView(null); setMonthlyView(null); setReflectionView(null); setMonthlyTrendView(null)
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
      const [result, stats] = await Promise.all([client.listCandidates(signal), client.memoryStats(signal)])
      if (epoch !== sessionEpoch.current || signal?.aborted) return false
      applyMemories(result)
      setMemoryStats(stats)
    } catch (error) {
      if (epoch !== sessionEpoch.current || signal?.aborted) return false
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
    setMemoryStats({ candidateMemories: 0, pendingReview: 0, confirmedMemories: 0 })
    setSelectedId(null)
    setDraft('')
    setNotice(null)
    setView('review')
    setProfileView(null); setTimelineView(null); setSecurityView(null); setHuman3View(null); setOnboardingView(null); setMonthlyView(null); setReflectionView(null); setClientCredential('')
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
    if (next === 'growth' || next === 'backup' || next === 'overview') return
    const controller = new AbortController()
    visualAbort.current = controller
    const epoch = sessionEpoch.current
    const request = viewRequest.current
    if (next === 'profile') setProfileView(null)
    if (next === 'onboarding') setOnboardingView(null)
    if (next === 'reflection') { setReflectionView(null); setMonthlyView(null) }
    if (next === 'timeline') setTimelineView(null)
    if (next === 'privacy') setSecurityView(null)
    if (next === 'human3') setHuman3View(null)
    if (next === 'monthly') setMonthlyTrendView(null)
    setVisualLoading(next)
    try {
      const result = next === 'reflection' ? await client.monthlyOverview(controller.signal)
        : next === 'onboarding' ? await client.onboarding(controller.signal)
        : next === 'profile' ? await client.profileOverview(controller.signal)
        : next === 'timeline' ? await client.timeline(controller.signal)
          : next === 'privacy' ? await client.securityCenter(controller.signal)
            : next === 'monthly' ? await client.monthlyTrend(controller.signal)
              : await client.human3Trend(controller.signal)
      if (epoch !== sessionEpoch.current || request !== viewRequest.current) return
      if (next === 'onboarding') setOnboardingView(result as OnboardingState)
      if (next === 'reflection') { const monthly = result as MonthlyOverview; setMonthlyView(monthly); setReflectionView(monthly.reflections.find((item) => item.month === monthly.currentMonth) ?? monthly.reflections[0] ?? null) }
      if (next === 'profile') setProfileView(result as ProfileOverview)
      if (next === 'timeline') setTimelineView(result as TimelineItem[])
      if (next === 'privacy') setSecurityView(result as SecurityCenter)
      if (next === 'human3') setHuman3View(result as Human3Trend)
      if (next === 'monthly') setMonthlyTrendView(result as MonthlyTrend)
    } catch (error) {
      if (controller.signal.aborted || epoch !== sessionEpoch.current || request !== viewRequest.current) return
      if (error instanceof ApiError && error.status === 401) disconnect('会话已失效，请重新连接。')
      else setNotice({ kind: 'error', text: messageFor(error) })
    } finally {
      if (epoch === sessionEpoch.current && request === viewRequest.current) setVisualLoading(null)
    }
  }

  async function saveOnboarding(topic: string, content: string) {
    if (!client) return false
    const epoch = sessionEpoch.current
    const signal = sessionAbort.current?.signal
    setSaving(true)
    try {
      const result = await client.onboardingResponse(topic, content, signal)
      if (epoch !== sessionEpoch.current || signal?.aborted) return false
      setOnboardingView(result.state)
      setNotice({ kind: 'success', text: '回答已保存为候选记忆，确认前不会成为长期事实。' })
      return true
    } catch (error) {
      if (epoch !== sessionEpoch.current || signal?.aborted) return false
      setNotice({ kind: 'error', text: messageFor(error) })
      return false
    } finally { if (epoch === sessionEpoch.current) setSaving(false) }
  }

  async function monthlyAction(action: (client: ApiClient, signal?: AbortSignal) => Promise<MonthlyReflection>) {
    if (!client) return false
    const epoch = sessionEpoch.current
    const signal = sessionAbort.current?.signal
    setSaving(true)
    try {
      const result = await action(client, signal)
      if (epoch !== sessionEpoch.current || signal?.aborted) return false
      setReflectionView(result)
      setMonthlyView((current) => current ? { ...current, reflections: [result, ...current.reflections.filter((item) => item.id !== result.id)].sort((a, b) => b.month.localeCompare(a.month)) } : current)
      return true
    } catch (error) {
      if (epoch !== sessionEpoch.current || signal?.aborted) return false
      handleMutationError(error)
      return false
    } finally { if (epoch === sessionEpoch.current) setSaving(false) }
  }

  async function createReflection(month: string) { const ok = await monthlyAction((api, signal) => api.createMonthly(month, signal)); if (ok) setNotice({ kind: 'success', text: '本月复盘草稿已创建并保存在本地。' }); return Boolean(ok) }
  function saveReflectionDimension(dimension: ReflectionDimension, content: string) { return reflectionView ? monthlyAction((api, signal) => api.saveMonthlyDimension(reflectionView.id, dimension, content, reflectionView.revision, signal)) : Promise.resolve(false) }
  function addReflectionEvent(event: Omit<ReflectionEvent, 'id'>) { return reflectionView ? monthlyAction((api, signal) => api.addMonthlyEvent(reflectionView.id, event, reflectionView.revision, signal)) : Promise.resolve(false) }
  function deleteReflectionEvent(eventId: string) { return reflectionView ? monthlyAction((api, signal) => api.deleteMonthlyEvent(reflectionView.id, eventId, reflectionView.revision, signal)) : Promise.resolve(false) }
  function saveReflectionGoals(goals: ReflectionGoal[]) { return reflectionView ? monthlyAction((api, signal) => api.saveMonthlyGoals(reflectionView.id, goals, reflectionView.revision, signal)) : Promise.resolve(false) }
  function generateReflectionSummary() { return reflectionView ? monthlyAction((api, signal) => api.generateMonthlySummary(reflectionView.id, reflectionView.revision, signal)) : Promise.resolve(false) }
  function saveReflectionSummary(summary: string) { return reflectionView ? monthlyAction((api, signal) => api.saveMonthlySummary(reflectionView.id, summary, reflectionView.revision, signal)) : Promise.resolve(false) }
  async function confirmReflection() { if (!reflectionView || !window.confirm('确认这份月度复盘？确认后会进入历史；后续修改将重新变为草稿。')) return false; const ok = await monthlyAction((api, signal) => api.confirmMonthly(reflectionView.id, reflectionView.revision, signal)); if (ok) setNotice({ kind: 'success', text: '月度复盘已由你确认并进入历史。' }); return Boolean(ok) }

  async function refreshSecurity() { if (!client) return false; try { const result = await client.securityCenter(sessionAbort.current?.signal); setSecurityView(result); return true } catch (error) { handleMutationError(error); return false } }
  async function authorizeSecurityClient(name: string, scopes: string[]) { if (!client) return false; setSaving(true); try { const result = await client.authorizeSecurityClient(name, scopes, sessionAbort.current?.signal); setClientCredential(result.credential); setNotice({ kind: 'success', text: '客户端已授权；凭据只显示一次。' }); await refreshSecurity(); return true } catch (error) { handleMutationError(error); return false } finally { setSaving(false) } }
  async function updateSecurityScopes(id: string, scopes: string[]) { if (!client) return false; setSaving(true); try { await client.updateSecurityScopes(id, scopes, sessionAbort.current?.signal); setNotice({ kind: 'success', text: '最小权限已更新，后续请求立即使用新权限。' }); await refreshSecurity(); return true } catch (error) { handleMutationError(error); return false } finally { setSaving(false) } }
  async function revokeSecurityClient(id: string) { if (!client) return false; setSaving(true); try { await client.revokeSecurityClient(id, sessionAbort.current?.signal); setNotice({ kind: 'success', text: '客户端授权已撤销，后续请求将被拒绝。' }); await refreshSecurity(); return true } catch (error) { handleMutationError(error); return false } finally { setSaving(false) } }
  async function querySecurityEvents(filters: { clientId: string; eventType: string; result: string; since: string; until: string; page: number; pageSize: number }) { if (!client || !securityView) return false; try { const audit = await client.securityEvents(filters, sessionAbort.current?.signal); setSecurityView({ ...securityView, audit }); return true } catch (error) { handleMutationError(error); return false } }

  async function save() {
    if (!client || !selected || !draft.trim()) return false
    const epoch = sessionEpoch.current
    const signal = sessionAbort.current?.signal
    setSaving(true)
    try {
      const updated = await client.edit(selected.id, draft.trim(), selected.revision, signal)
      if (epoch !== sessionEpoch.current || signal?.aborted) return false
      setMemories((items) => items.map((item) => item.id === updated.id ? updated : item))
      setNotice({ kind: 'success', text: '修改已保存。' })
      await loadCandidates()
      return true
    } catch (error) { if (epoch === sessionEpoch.current && !signal?.aborted) handleMutationError(error); return false } finally { if (epoch === sessionEpoch.current) setSaving(false) }
  }

  async function act(action: 'confirm' | 'reject') {
    if (!client || !selected) return false
    const label = action === 'confirm' ? '确认这条记忆并允许已授权 AI 检索？' : '拒绝这条候选记忆？拒绝记录会保留用于审计。'
    if (!window.confirm(label)) return false
    const epoch = sessionEpoch.current
    const signal = sessionAbort.current?.signal
    setSaving(true)
    try {
      await client.action(selected.id, action, selected.revision, rejectionReason.trim(), signal)
      if (epoch !== sessionEpoch.current || signal?.aborted) return false
      setNotice({ kind: 'success', text: action === 'confirm' ? '记忆已确认。' : '候选记忆已拒绝。' })
      await loadCandidates()
      return true
    } catch (error) { if (epoch === sessionEpoch.current && !signal?.aborted) handleMutationError(error); return false } finally { if (epoch === sessionEpoch.current) setSaving(false) }
  }

  function handleMutationError(error: unknown) {
    if (error instanceof ApiError && error.status === 401) {
      disconnect('会话已失效，请重新连接。')
    } else if (error instanceof ApiError && error.status === 409) {
      setNotice({ kind: 'error', text: '这条记录刚刚被其他入口修改。已保留你的草稿，请刷新后核对再提交。' })
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

  const navigation: { label: string; view?: View; icon: typeof House }[] = [
    { label: '概览', view: 'overview', icon: House },
    { label: '记忆审核', view: 'review', icon: Stack },
    { label: '对话式引导', view: 'onboarding', icon: ChatCircleDots },
    { label: '个人档案', view: 'profile', icon: UserCircle },
    { label: '月度复盘', view: 'reflection', icon: CalendarDots },
    { label: '月度趋势', view: 'monthly', icon: ChartLineUp },
    { label: 'Human 3.0', view: 'human3', icon: Brain },
    { label: '成长仪表盘', view: 'growth', icon: Sparkle },
    { label: '隐私审计', view: 'privacy', icon: ShieldCheck },
    { label: '备份与恢复', view: 'backup', icon: HardDrives },
    { label: 'AI 连接', icon: PlugsConnected },
  ]
  const titles: Record<View, string> = { overview: '总览', review: '记忆审核', onboarding: '对话式引导', profile: '个人档案', timeline: '记忆时间线', privacy: '隐私审计', reflection: '月度复盘', human3: 'Human 3.0', monthly: '月度趋势', growth: 'Human 3.0 成长', backup: '备份与恢复' }

  return <main className="app-shell">
    <button className="mobile-menu" aria-label="打开导航" aria-expanded={navigationOpen} onClick={() => setNavigationOpen(true)}><List size={22} /></button>
    {navigationOpen && <button className="navigation-scrim" aria-label="关闭导航" onClick={() => setNavigationOpen(false)} />}
    <aside className={`sidebar ${navigationOpen ? 'open' : ''}`}>
      <div className="brand"><span className="brand-mark"><CirclesFour weight="duotone" /></span><div><strong>Personal AI Profile</strong><small>INTELLIGENCE LIBRARY</small></div><button className="drawer-close" aria-label="关闭导航" onClick={() => setNavigationOpen(false)}><X /></button></div>
      <nav aria-label="档案功能">
        {navigation.map((item) => { const Icon = item.icon; const active = item.view === view || (item.view === 'profile' && view === 'timeline'); return <button key={item.label} className={active ? 'active' : ''} aria-label={item.view === 'human3' ? 'Human 3.0趋势' : undefined} aria-current={active ? 'page' : undefined} aria-disabled={!item.view} title={!item.view ? '后续阶段开放' : undefined} onClick={() => { if (item.view) { void openView(item.view); setNavigationOpen(false) } }}><Icon size={22} weight={active ? 'duotone' : 'regular'} /><span>{item.label}</span>{!item.view && <small>即将开放</small>}</button> })}
      </nav>
      <button className="timeline-shortcut" onClick={() => { void openView('timeline'); setNavigationOpen(false) }}><CalendarDots size={18} />记忆时间线</button>
      <div className="sidebar-status"><p><Database size={17} /><span>本地服务</span><strong>已连接</strong></p><p><LockKey size={17} /><span>Vault</span><strong>受保护</strong></p></div>
    </aside>

    <section className="app-stage">
      <header className="topbar"><div><p className="eyebrow">HOLOGRAPHIC LIBRARY</p><h1>{titles[view]}</h1></div><div className="topbar-actions"><span className="service-status"><i />本地服务</span><span className="service-status"><i />Vault 已就绪</span><button className="icon-button" aria-label="同步候选记忆" title="同步候选记忆" onClick={() => void loadCandidates()} disabled={loading}><Database size={19} /></button><button className="text-button" onClick={() => disconnect()}>断开连接</button><button className="text-button danger-link" onClick={() => void shutdown()} disabled={saving}>关闭服务</button></div></header>
      <div className="content-shell">
        {notice && <div className={`notice ${notice.kind}`} role="status"><span>{notice.text}</span>{notice.kind === 'error' && <button onClick={() => void loadCandidates()}>刷新数据</button>}</div>}

        {view === 'onboarding' && <ConversationalOnboardingPage value={onboardingView} loading={visualLoading === 'onboarding'} saving={saving} onSave={saveOnboarding} onReview={() => void openView('review')} />}
        {view === 'reflection' && <MonthlyReflectionPage overview={monthlyView} selected={reflectionView} loading={visualLoading === 'reflection'} saving={saving} onSelect={setReflectionView} onCreate={createReflection} onDimension={saveReflectionDimension} onAddEvent={addReflectionEvent} onDeleteEvent={deleteReflectionEvent} onGoals={saveReflectionGoals} onGenerateSummary={generateReflectionSummary} onSummary={saveReflectionSummary} onConfirm={confirmReflection} />}
        {view === 'profile' && <ProfilePage value={profileView} loading={visualLoading === 'profile'} relationshipMap={relationshipMap} onReview={() => void openView('review')} onTimeline={() => void openView('timeline')} />}
        {view === 'timeline' && <TimelinePage value={timelineView} loading={visualLoading === 'timeline'} />}
        {view === 'privacy' && <SecurityCenterPage value={securityView} loading={visualLoading === 'privacy'} saving={saving} credential={clientCredential} onAuthorize={authorizeSecurityClient} onScopes={updateSecurityScopes} onRevoke={revokeSecurityClient} onQuery={querySecurityEvents} onClearCredential={() => setClientCredential('')} />}
        {view === 'human3' && <Human3Page value={human3View} loading={visualLoading === 'human3'} />}
        {view === 'monthly' && <MonthlyTrendPage value={monthlyTrendView} loading={visualLoading === 'monthly'} />}
        {view === 'growth' && client && <GrowthDashboard client={client} />}
        {view === 'backup' && client && <BackupRecoveryPage client={client} />}
        {view === 'overview' && client && <OverviewPage client={client} onNavigate={(next) => void openView(next)} />}
        {view === 'review' && <MemoryReviewPage memories={memories} stats={memoryStats} selected={selected} draft={draft} rejectionReason={rejectionReason} loading={loading} saving={saving} onSelect={(memory) => { setSelectedId(memory.id); setDraft(memory.content); setRejectionReason('') }} onDraft={setDraft} onRejectionReason={setRejectionReason} onSave={save} onAct={act} />}
      </div>
    </section>

    <aside className="status-panel" aria-label="智能状态面板">
      <div className="status-panel-head"><p className="eyebrow">INTELLIGENCE STATUS</p><h2>智能状态</h2></div>
      <dl className="status-list">
        <div><dt>本地服务</dt><dd className="ok">已连接</dd></div>
        <div><dt>Vault</dt><dd className="ok">受保护</dd></div>
        <div><dt>待处理</dt><dd>{memoryStats.pendingReview}</dd></div>
        <div><dt>确认记忆</dt><dd>{memoryStats.confirmedMemories}</dd></div>
      </dl>
      <button className="text-button" onClick={() => void loadCandidates()}>刷新状态</button>
    </aside>
  </main>
}

function Loading() { return <div className="visual-panel" role="status">正在读取本地档案…</div> }

function ProfilePage({ value, loading, relationshipMap, onReview, onTimeline }: { value: ProfileOverview | null; loading: boolean; relationshipMap: string; onReview: () => void; onTimeline: () => void }) {
  if (loading || !value) return <Loading />
  return <section className="visual-page profile-page"><header className="profile-heading"><div><p className="eyebrow">PERSONAL INTELLIGENCE</p><h2>个人档案</h2><p>基础档案来自本地 Profile；长期记忆只有经过你的确认且允许展示后，才会参与这里的智能视图。</p></div><span className="boundary-badge"><ShieldCheck size={18} />确认边界已启用</span></header>
    {value.protected ? <div className="protected"><LockKey size={20} />此档案标记为 <code>{value.access}</code>，当前视图不会显示受保护内容。</div> : <div className="profile-layout">
      <section className="profile-library" aria-label="个人档案内容">
        <div className="profile-summary"><span className="profile-avatar"><UserCircle size={42} weight="duotone" /></span><div><p className="eyebrow">PROFILE SUMMARY</p><h3>你的长期智能档案</h3><p>只显示本地 Profile 中明确保存且当前允许展示的内容。</p></div><button className="secondary-action" onClick={onTimeline}>查看生命周期</button></div>
        <div className="profile-sections">{value.sections.length === 0 ? <div className="profile-empty"><Sparkle size={24} /><h3>档案还是空的</h3><p>完成对话式引导并确认候选记忆后，你可以逐步完善长期档案。</p><button className="primary-action" onClick={onReview}>前往记忆审核</button></div> : value.sections.map((section) => <article key={section.title}><span className="section-icon"><Sparkle size={20} /></span><div><h3>{section.title}</h3>{section.items.length ? <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="muted">尚未填写。</p>}</div></article>)}</div>
      </section>
      <aside className={`relationship-panel ${value.hasConfirmedMemories ? '' : 'inactive'}`}><div><p className="eyebrow">RELATIONSHIP MAP</p><h3>全息关系图谱</h3><p>用于呈现可见的已确认记忆空间，不会自动推断真实关系。</p></div><img src={relationshipMap} alt="全息关系图谱的视觉框架，当前不代表具体个人数据关系" /><div className="relationship-empty"><Network size={20} /><span>{value.hasConfirmedMemories ? '存在可展示的已确认记忆' : '暂无可展示的已确认记忆'}</span></div></aside>
      <aside className="profile-inspector"><p className="eyebrow">ABOUT THIS PROFILE</p><h3>确认优先</h3><p>候选、拒绝和归档记忆不会进入智能视图；只有可访问的 confirmed memory 才有资格参与。</p><hr /><h3>本地优先</h3><p>档案内容保留在你的本地 Vault，页面不显示私人路径。</p><hr /><h3>下一步</h3><p>审核候选记忆，逐步完善你的长期档案。</p><button className="primary-action" onClick={onReview}><Stack size={18} />前往记忆审核</button></aside>
    </div>}
  </section>
}

function TimelinePage({ value, loading }: { value: TimelineItem[] | null; loading: boolean }) {
  const [open, setOpen] = useState<string | null>(null)
  if (loading || !value) return <Loading />
  return <section className="visual-page"><header><p className="eyebrow">MEMORY LIFECYCLE</p><h2>记忆时间线</h2><p>未确认、denied 和 local-only 记录只显示元数据，不显示正文。</p></header>
    <div className="timeline">{value.length === 0 ? <p className="muted">还没有记忆记录。</p> : value.map((item) => <article key={item.id}><span className={`dot status-${item.status}`} /><div><p className="timeline-meta">{displayTime(item.updated || item.created)} · {item.status} · {item.access}</p><h3>{item.subject || item.type}</h3><p>来源：{item.sourceAgent}</p>{item.previewAvailable && <button className="reveal" onClick={() => setOpen(open === item.id ? null : item.id)}>{open === item.id ? '收起摘要' : '查看确认摘要'}</button>}{open === item.id && <p className="preview">{item.preview}</p>}</div></article>)}</div>
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
