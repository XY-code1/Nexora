import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Brain, CalendarDots, ChartLineUp, CloudArrowUp, Database, GithubLogo, HardDrives, House, List, LockKey, Network, PlugsConnected, ShieldCheck, Sparkle, Stack, UserCircle, Warning, X } from '@phosphor-icons/react'
import { ApiClient, ApiError, type Human3Trend, type Memory, type MemoryStats, type MonthlyOverview, type MonthlyReflection, type MonthlyTrend, type ProfileOverview, type ReflectionDimension, type ReflectionEvent, type ReflectionGoal, type SecurityCenter, type TimelineItem } from './api'
import MemoryReviewPage from './MemoryReviewPage'
import MonthlyReflectionPage from './MonthlyReflectionPage'
import SecurityCenterPage from './SecurityCenterPage'
import MonthlyTrendPage from './MonthlyTrendPage'
import GrowthDashboard from './GrowthDashboard'
import OverviewPage from './OverviewPage'
import BackupRecoveryPage from './BackupRecoveryPage'
import GitHubBackupPage from './GitHubBackupPage'

import ProviderAuthPage from './ProviderAuthPage'

import ImportPage from './ImportPage'
import AIConnectionsPage from './AIConnectionsPage'
import FirstRunWizard from './FirstRunWizard'
import { LoadingState } from './components/StateBlocks'
import relationshipMap from './assets/relationship-map.webp'
import { LANGUAGES, localizedError, useLanguage, useT } from './i18n'
import type { Language } from './i18n'
import './App.css'

type Notice = { kind: 'success' | 'error'; text: string } | null
type View = 'overview' | 'review' | 'profile' | 'timeline' | 'privacy' | 'reflection' | 'human3' | 'monthly' | 'growth' | 'backup' | 'connections' | 'import' | 'providers' | 'github'

const VIEW_ROUTES: Record<View, string> = {
  overview: '#/overview', review: '#/memory-review', profile: '#/profile',
  timeline: '#/memory-timeline', privacy: '#/privacy-audit', reflection: '#/monthly-reflection',
  human3: '#/human-3', monthly: '#/monthly-trend', growth: '#/growth-dashboard', backup: '#/backup-recovery', connections: '#/ai-connections', providers: '#/providers', import: '#/import', github: '#/github-backup',
}
const ROUTE_VIEWS = new Map(Object.entries(VIEW_ROUTES).map(([view, route]) => [route, view as View]))
function viewFromHash(hash: string): View | null { return ROUTE_VIEWS.get(hash) ?? null }

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
  const t = useT()
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
      <h1 id="gate-title">{t('gate.title')}</h1>
      <p>{t('gate.hint')}</p>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <label htmlFor="token">{t('gate.token')}</label>
        <input ref={field} id="token" type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} aria-describedby={fieldError || error ? 'token-error' : undefined} disabled={connecting} />
        {(fieldError || error) && <p id="token-error" className="field-error" role="alert">{fieldError || error}</p>}
        <button type="submit" disabled={connecting}>{connecting ? t('common.loading') : t('gate.connect')}</button>
      </form>
      <p className="quiet">{t('gate.hint')}</p>
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
  const [view, setView] = useState<View>(() => viewFromHash(window.location.hash) ?? 'overview')
  const [profileView, setProfileView] = useState<ProfileOverview | null>(null)
  const [timelineView, setTimelineView] = useState<TimelineItem[] | null>(null)
  const [securityView, setSecurityView] = useState<SecurityCenter | null>(null)
  const [clientCredential, setClientCredential] = useState('')
  const [human3View, setHuman3View] = useState<Human3Trend | null>(null)
  const [monthlyView, setMonthlyView] = useState<MonthlyOverview | null>(null)
  const [reflectionView, setReflectionView] = useState<MonthlyReflection | null>(null)
  const [monthlyTrendView, setMonthlyTrendView] = useState<MonthlyTrend | null>(null)
  const [visualLoading, setVisualLoading] = useState<View | null>(null)
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [firstRun, setFirstRun] = useState(false)
  const [wizardVaultName, setWizardVaultName] = useState('')
  const [navigationAnnouncement, setNavigationAnnouncement] = useState('')
  const [externalChange, setExternalChange] = useState(false)
  const [vaultEpoch, setVaultEpoch] = useState(0)
  const [language, changeLanguage] = useLanguage()
  const t = useT()
  const [highContrast, setHighContrast] = useState(false)

  useEffect(() => {
    document.documentElement.classList.toggle('high-contrast', highContrast)
  }, [highContrast])
  const sessionEpoch = useRef(0)
  const viewRequest = useRef(0)
  const visualAbort = useRef<AbortController | null>(null)
  const sessionAbort = useRef<AbortController | null>(null)
  const stageRef = useRef<HTMLElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const connectedViewRef = useRef<View | null>(null)
  const mountedRef = useRef(true)
  const userNavigatedRef = useRef(false)

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
    connectedViewRef.current = viewFromHash(window.location.hash) ?? 'overview'
    userNavigatedRef.current = false
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
      // 首次运行判定：未完成初始化、且档案为空、且没有任何记忆时，先走初始化向导。
      // 判定在后台进行，不阻塞连接；结论到达前先按常规界面呈现。
      // 已初始化过的 Vault 不再重复进入向导（标记存在 Vault 的 90 System/state.json）。
      const noMemories = stats.candidateMemories === 0 && stats.confirmedMemories === 0 && stats.pendingReview === 0
      if (noMemories) {
        void Promise.all([
          nextClient.overview(controller.signal).catch(() => null),
          nextClient.vaultStatus(controller.signal).catch(() => null),
        ]).then(([snapshot, vaultInfo]) => {
          if (epoch !== sessionEpoch.current || controller.signal.aborted || !mountedRef.current) return
          const untouched = snapshot !== null
            && snapshot.initialized !== true
            && snapshot.profile.sections.length === 0
            && stats.candidateMemories === 0
            && stats.confirmedMemories === 0
            && stats.pendingReview === 0
          setWizardVaultName(vaultInfo?.displayName && vaultInfo.displayName !== 'vault' ? vaultInfo.displayName : '我的个人空间')
          setFirstRun(untouched)
        })
      }
      setProfileView(null); setTimelineView(null); setSecurityView(null); setHuman3View(null); setMonthlyView(null); setReflectionView(null); setMonthlyTrendView(null)
      setNotice(null)
    } catch (error) {
      if (controller.signal.aborted || epoch !== sessionEpoch.current) return
      setToken('')
      setGateError(localizedError(language, error instanceof ApiError && error.status === 401 ? '启动令牌无效，请检查后重新输入。' : messageFor(error)))
    } finally {
      if (epoch === sessionEpoch.current) setConnecting(false)
    }
  }

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Poll the resident Vault watcher so external edits (Obsidian, another editor)
  // surface without waiting for the next navigation.
  useEffect(() => {
    if (!client) return
    let cancelled = false
    const tick = async () => {
      try {
        const status = await client.vaultEvents()
        if (!cancelled) setExternalChange(status.externalChange)
      } catch { /* keep the last known state */ }
    }
    void tick()
    const timer = window.setInterval(() => void tick(), 5000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [client])

  useEffect(() => {
    const initialHash = window.location.hash
    const params = new URLSearchParams(initialHash.slice(1))
    const bootstrapToken = params.get('token')
    if (bootstrapToken) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${VIEW_ROUTES.overview}`)
      void connect(bootstrapToken)
      return
    }
    if (!viewFromHash(initialHash)) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${VIEW_ROUTES.overview}`)
  }, []) // Launcher token is consumed once, removed from the URL, then kept only in memory.

  useEffect(() => {
    if (!client) return
    // 用户已经主动导航过时，初始化补数不再介入：否则会把视图覆盖回初始页。
    if (userNavigatedRef.current) return
    const initialView = connectedViewRef.current ?? viewFromHash(window.location.hash) ?? 'overview'
    connectedViewRef.current = null
    if (initialView === 'review') setView('review')
    // 初始化调用不参与请求竞争：它只负责补齐首屏数据，
    // 不应让用户在此时发起的导航请求作废（否则会出现视图一直停在加载态）。
    else void openView(initialView, false, false)
  }, [client])

  useEffect(() => {
    function onRouteChange() {
      const next = viewFromHash(window.location.hash)
      if (!next) {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${VIEW_ROUTES.overview}`)
        if (client) void openView('overview', false)
        else setView('overview')
        return
      }
      if (client) void openView(next, false)
      else setView(next)
    }
    window.addEventListener('hashchange', onRouteChange)
    window.addEventListener('popstate', onRouteChange)
    return () => {
      window.removeEventListener('hashchange', onRouteChange)
      window.removeEventListener('popstate', onRouteChange)
    }
  }, [client])

  useEffect(() => {
    if (!token) return
    // 切页回到顶部：滚动容器是 .app-stage（overflow:auto），焦点移动可能再次触发滚动，因此重置两次。
    const resetScroll = () => {
      if (stageRef.current) {
        stageRef.current.scrollTop = 0
        stageRef.current.scrollLeft = 0
      }
    }
    resetScroll()
    const focusTimer = window.setTimeout(() => {
      titleRef.current?.focus({ preventScroll: true })
      setNavigationAnnouncement(`${titleRef.current?.textContent ?? '页面'}已打开`)
      requestAnimationFrame(resetScroll)
    })
    return () => window.clearTimeout(focusTimer)
  }, [view, token])

  useEffect(() => {
    if (!navigationOpen) return
    const frame = window.requestAnimationFrame(() => {
      sidebarRef.current?.querySelector<HTMLButtonElement>('nav button[aria-current="page"]')?.focus()
    })
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setNavigationOpen(false)
        menuButtonRef.current?.focus()
        return
      }
      if (event.key !== 'Tab' || !sidebarRef.current) return
      const focusable = [...sidebarRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { window.cancelAnimationFrame(frame); document.removeEventListener('keydown', onKeyDown) }
  }, [navigationOpen])

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

  async function refreshAfterExternal() {
    setExternalChange(false)
    await loadCandidates()
    if (view !== 'review' && view !== 'overview' && view !== 'backup') await openView(view, false)
    setVaultEpoch((current) => current + 1)
  }

  function disconnect(message = '') {
    sessionEpoch.current += 1
    mountedRef.current = false
    viewRequest.current += 1
    visualAbort.current?.abort()
    sessionAbort.current?.abort()
    setToken('')
    setMemories([])
    setMemoryStats({ candidateMemories: 0, pendingReview: 0, confirmedMemories: 0 })
    setSelectedId(null)
    setDraft('')
    setNotice(null)
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${VIEW_ROUTES.review}`)
    setView('review')
    setProfileView(null); setTimelineView(null); setSecurityView(null); setHuman3View(null); setMonthlyView(null); setReflectionView(null); setClientCredential('')
    setVisualLoading(null)
    setFirstRun(false)
    setGateError(message)
  }

  async function openView(next: View, updateRoute = true, compete = true) {
    if (!client) return
    // 初始化补数：若用户在此期间已经导航到别处，直接放弃，避免把视图覆盖回去。
    if (updateRoute && window.location.hash !== VIEW_ROUTES[next]) {
      window.history.pushState(null, '', `${window.location.pathname}${window.location.search}${VIEW_ROUTES[next]}`)
    }
    setView(next)
    if (compete) userNavigatedRef.current = true
    setNotice(null)
    // compete=false 是初始化补数：既不作废用户正在进行的请求，也不抢占它的
    // AbortController，否则用户点击导航后视图会停在加载态。
    if (compete) {
      visualAbort.current?.abort()
      viewRequest.current += 1
    }
    setVisualLoading(null)
    if (next === 'review') { void loadCandidates(); return }
    if (next === 'growth' || next === 'backup' || next === 'overview' || next === 'connections' || next === 'providers' || next === 'import' || next === 'github') return
    const controller = new AbortController()
    visualAbort.current = controller
    const epoch = sessionEpoch.current
    const request = viewRequest.current
    if (next === 'profile') setProfileView(null)
    if (next === 'reflection') { setReflectionView(null); setMonthlyView(null) }
    if (next === 'timeline') setTimelineView(null)
    if (next === 'privacy') setSecurityView(null)
    if (next === 'human3') setHuman3View(null)
    if (next === 'monthly') setMonthlyTrendView(null)
    setVisualLoading(next)
    try {
      const result = next === 'reflection' ? await client.monthlyOverview(controller.signal)
        : next === 'profile' ? await client.profileOverview(controller.signal)
        : next === 'timeline' ? await client.timeline(controller.signal)
          : next === 'privacy' ? await client.securityCenter(controller.signal)
            : next === 'monthly' ? await client.monthlyTrend(controller.signal)
              : await client.human3Trend(controller.signal)
      if (epoch !== sessionEpoch.current || request !== viewRequest.current) return
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
  async function authorizeSecurityClient(name: string, scopes: string[]) { if (!client) return null; setSaving(true); try { const result = await client.authorizeSecurityClient(name, scopes, sessionAbort.current?.signal); setClientCredential(result.credential); setNotice({ kind: 'success', text: '客户端已授权；凭据只显示一次。' }); await refreshSecurity(); return result.client.id } catch (error) { handleMutationError(error); return null } finally { setSaving(false) } }
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
  if (firstRun && client) return <FirstRunWizard
    client={client}
    vaultName={wizardVaultName}
    onFinish={(destination) => {
      setFirstRun(false)
      void openView(destination)
    }}
  />

  const navigationGroups: { title: string; items: { label: string; view?: View; icon: typeof House }[] }[] = [
    {
      title: t('nav.group.core'),
      items: [
        { label: t('nav.overview'), view: 'overview', icon: House },
        { label: t('nav.review'), view: 'review', icon: Stack },
        { label: t('nav.profile'), view: 'profile', icon: UserCircle },
      ],
    },
    {
      title: t('nav.group.records'),
      items: [
        { label: t('nav.import'), view: 'import', icon: CloudArrowUp },
        { label: t('nav.reflection'), view: 'reflection', icon: CalendarDots },
        { label: t('nav.monthly'), view: 'monthly', icon: ChartLineUp },
        { label: t('nav.human3'), view: 'human3', icon: Brain },
        { label: t('nav.growth'), view: 'growth', icon: Sparkle },
        { label: t('nav.timeline'), view: 'timeline', icon: CalendarDots },
      ],
    },
    {
      title: t('nav.group.system'),
      items: [
        { label: t('nav.privacy'), view: 'privacy', icon: ShieldCheck },
        { label: t('nav.backup'), view: 'backup', icon: HardDrives },
        { label: t('nav.connections'), view: 'connections', icon: PlugsConnected },
        { label: t('nav.github'), view: 'github', icon: GithubLogo },
        { label: t('nav.providers'), view: 'providers', icon: LockKey },
      ],
    },
  ]
  const titles: Record<View, string> = { overview: t('title.overview'), review: t('nav.review'), profile: t('nav.profile'), timeline: t('nav.timeline'), privacy: t('nav.privacy'), reflection: t('nav.reflection'), human3: t('nav.human3'), monthly: t('nav.monthly'), growth: t('nav.growth'), backup: t('nav.backup'), connections: t('nav.connections'), providers: t('nav.providers'), import: t('nav.import'), github: t('nav.github') }

  function closeNavigation() {
    setNavigationOpen(false)
    window.requestAnimationFrame(() => menuButtonRef.current?.focus())
  }

  return <main className="app-shell">
    <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById('main-content')?.focus() }}>{t('a11y.skipToContent')}</a>
    <button ref={menuButtonRef} className="mobile-menu" aria-label="打开导航" aria-controls="primary-navigation" aria-expanded={navigationOpen} onClick={() => setNavigationOpen(true)}><List size={22} /></button>
    {navigationOpen && <button className="navigation-scrim" aria-label="关闭导航" onClick={closeNavigation} />}
    <aside ref={sidebarRef} id="primary-navigation" aria-label="主导航" className={`sidebar ${navigationOpen ? 'open' : ''}`}>
      <div className="brand"><span className="brand-mark"><img src="/brand/nexora-symbol.svg" alt="" aria-hidden="true" /></span><div><strong>NEXORA <em>知序</em></strong><small>PERSONAL INTELLIGENCE</small></div><button className="drawer-close" aria-label="关闭导航" onClick={closeNavigation}><X /></button></div>
      <nav aria-label="档案功能">
        {navigationGroups.map((group) => <div className="nav-group" key={group.title}>
          <p className="nav-group-title">{group.title}</p>
          {group.items.map((item) => { const Icon = item.icon; const active = item.view === view || (item.view === 'profile' && view === 'timeline'); return <button key={item.label} className={active ? 'active' : ''} aria-label={item.view === 'human3' ? 'Human 3.0趋势' : undefined} aria-current={active ? 'page' : undefined} aria-disabled={!item.view} title={!item.view ? '后续阶段开放' : undefined} onClick={() => { if (item.view) { void openView(item.view); setNavigationOpen(false); if (item.view === view) window.requestAnimationFrame(() => titleRef.current?.focus({ preventScroll: true })) } }}><Icon size={21} weight={active ? 'duotone' : 'regular'} /><span>{item.label}</span>{!item.view && <small>即将开放</small>}</button> })}
        </div>)}
      </nav>
      <div className="sidebar-status"><p><Database size={17} /><span>本地服务</span><strong>已连接</strong></p><p><LockKey size={17} /><span>Vault</span><strong>受保护</strong></p></div>
    </aside>

    <section ref={stageRef} id="main-content" className={`app-stage ${view === 'overview' ? 'with-status' : ''}`} tabIndex={-1} aria-label={t('a11y.main')}>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{navigationAnnouncement}</div>
      <header className="topbar"><div><p className="eyebrow">HOLOGRAPHIC LIBRARY</p><h1 ref={titleRef} tabIndex={-1}>{titles[view]}</h1></div><div className="topbar-actions"><span className="service-status"><i />{t('topbar.localService')}</span><span className="service-status"><i />{t('topbar.vaultReady')}</span><button className="text-button" onClick={() => setHighContrast((current) => !current)} aria-pressed={highContrast}>{highContrast ? '标准对比度' : '高对比度'}</button><label className="language-switch"><span className="sr-only">{t('topbar.language')}</span><select aria-label={t('topbar.language')} value={language} onChange={(event) => changeLanguage(event.target.value as Language)}>{LANGUAGES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><button className="icon-button" aria-label={t('topbar.refreshCandidates')} title={t('topbar.refreshCandidates')} onClick={() => void loadCandidates()} disabled={loading}><Database size={19} /></button><button className="text-button" onClick={() => disconnect()}>{t('topbar.disconnect')}</button><button className="text-button danger-link" onClick={() => void shutdown()} disabled={saving}>{t('topbar.shutdown')}</button></div></header>
      <div className="content-shell">
        {externalChange && <div className="external-banner" role="status"><Warning size={20} /><span>{t('external.banner')}</span><button className="text-button" onClick={() => void refreshAfterExternal()}>{t('external.refresh')}</button><button className="text-button" onClick={() => setExternalChange(false)}>{t('external.dismiss')}</button></div>}
        {notice && <div className={`notice ${notice.kind}`} role="status"><span>{notice.text}</span>{notice.kind === 'error' && <button onClick={() => void loadCandidates()}>刷新数据</button>}</div>}

        {view === 'reflection' && <MonthlyReflectionPage overview={monthlyView} selected={reflectionView} loading={visualLoading === 'reflection'} saving={saving} onSelect={setReflectionView} onCreate={createReflection} onDimension={saveReflectionDimension} onAddEvent={addReflectionEvent} onDeleteEvent={deleteReflectionEvent} onGoals={saveReflectionGoals} onGenerateSummary={generateReflectionSummary} onSummary={saveReflectionSummary} onConfirm={confirmReflection} />}
        {view === 'profile' && <ProfilePage value={profileView} loading={visualLoading === 'profile'} relationshipMap={relationshipMap} onReview={() => void openView('review')} onTimeline={() => void openView('timeline')} />}
        {view === 'timeline' && <TimelinePage value={timelineView} loading={visualLoading === 'timeline'} />}
        {view === 'privacy' && <SecurityCenterPage value={securityView} loading={visualLoading === 'privacy'} saving={saving} credential={clientCredential} onAuthorize={authorizeSecurityClient} onScopes={updateSecurityScopes} onRevoke={revokeSecurityClient} onQuery={querySecurityEvents} onClearCredential={() => setClientCredential('')} />}
        {view === 'human3' && <Human3Page value={human3View} loading={visualLoading === 'human3'} />}
        {view === 'monthly' && <MonthlyTrendPage value={monthlyTrendView} loading={visualLoading === 'monthly'} />}
        {view === 'growth' && client && <GrowthDashboard client={client} />}
        {view === 'backup' && client && <BackupRecoveryPage client={client} refreshKey={vaultEpoch} />}
        {view === 'overview' && client && <OverviewPage client={client} onNavigate={(next) => void openView(next)} refreshKey={vaultEpoch} />}
        {view === 'connections' && client && <AIConnectionsPage client={client} />}
        {view === 'github' && client && <GitHubBackupPage client={client} />}

        {view === 'providers' && client && <ProviderAuthPage client={client} />}

        {view === 'import' && client && <ImportPage client={client} />}
        {view === 'review' && <MemoryReviewPage memories={memories} stats={memoryStats} selected={selected} draft={draft} rejectionReason={rejectionReason} loading={loading} saving={saving} onSelect={(memory) => { setSelectedId(memory.id); setDraft(memory.content); setRejectionReason('') }} onDraft={setDraft} onRejectionReason={setRejectionReason} onSave={save} onAct={act} onOnboarding={() => void openView('profile')} />}
      </div>
    </section>

    {view === 'overview' && <aside className="status-panel" aria-label="个人空间状态">
      <div className="status-panel-head"><p className="eyebrow">PERSONAL SPACE</p><h2>空间状态</h2></div>
      <dl className="status-list">
        <div><dt>本地服务</dt><dd className="ok">已连接</dd></div>
        <div><dt>待处理</dt><dd>{memoryStats.pendingReview}</dd></div>
        <div><dt>确认记忆</dt><dd>{memoryStats.confirmedMemories}</dd></div>
        <div><dt>候选记忆</dt><dd>{memoryStats.candidateMemories}</dd></div>
      </dl>
      <button className="text-button" onClick={() => void loadCandidates()}>刷新状态</button>
    </aside>}
  </main>
}

function Loading() { return <LoadingState label="正在读取本地档案…" /> }

function ProfilePage({ value, loading, relationshipMap, onReview, onTimeline }: { value: ProfileOverview | null; loading: boolean; relationshipMap: string; onReview: () => void; onTimeline: () => void }) {
  if (loading || !value) return <Loading />
  return <section className="visual-page profile-page"><header className="profile-heading compact-heading"><div><p className="eyebrow">PERSONAL INTELLIGENCE</p><p>档案仅展示已确认且允许访问的真实信息，不会推断关系或补全缺失内容。</p></div><span className="boundary-badge"><ShieldCheck size={18} />确认边界已启用</span></header>
    {value.protected ? <div className="protected"><LockKey size={20} />此档案标记为 <code>{value.access}</code>，当前视图不会显示受保护内容。</div> : <div className="profile-layout">
      <section className="profile-library" aria-label="个人档案内容">
        <div className="profile-summary"><span className="profile-avatar"><UserCircle size={42} weight="duotone" /></span><div><p className="eyebrow">PROFILE SUMMARY</p><h3>你的长期智能档案</h3><p>只显示本地 Profile 中明确保存且当前允许展示的内容。</p></div><button className="secondary-action" onClick={onTimeline}>查看生命周期</button></div>
        <div className="profile-sections">{value.sections.length === 0 ? <div className="profile-empty"><Sparkle size={24} /><h3>档案还是空的</h3><p>首次建档产生的候选记忆需要由你确认，之后才会进入长期档案。</p><button className="primary-action" onClick={onReview}>前往记忆审核</button></div> : value.sections.map((section) => <article key={section.title}><span className="section-icon"><Sparkle size={20} /></span><div><h3>{section.title}</h3>{section.items.length ? <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="muted">尚未填写。</p>}</div></article>)}</div>
      </section>
      <aside className={`relationship-panel ${value.hasConfirmedMemories ? '' : 'inactive'}`}>
        <div><p className="eyebrow">RELATIONSHIP MAP</p><h3>全息关系图谱</h3><p>用于呈现可见的已确认记忆空间，不会自动推断真实关系。</p></div>
        {/* 图谱是固定的视觉框架，不代表具体的人际关系；没有已确认记忆时整体淡出并给出明确空状态。 */}
        <img src={relationshipMap} alt="全息关系图谱的视觉框架，当前不代表具体个人数据关系" />
        <div className="relationship-empty"><Network size={20} /><span>{value.hasConfirmedMemories ? '存在可展示的已确认记忆' : '暂无可展示的已确认记忆'}</span></div>
      </aside>
      <aside className="profile-inspector"><p className="eyebrow">NEXT ACTION</p><h3>{value.sections.length ? '继续完善档案' : '建立第一条长期信息'}</h3><p>{value.sections.length ? '审核新的候选记忆，让档案保持准确。' : '在审核页确认首次建档中愿意长期保留的信息。'}</p><button className="primary-action" onClick={onReview}><Stack size={18} />前往记忆审核</button><hr /><h3>确认优先</h3><p>候选、拒绝和归档记忆不会进入智能视图。</p><hr /><h3>本地优先</h3><p>内容保留在本地 Vault，页面不显示私人路径。</p></aside>
    </div>}
  </section>
}

function TimelinePage({ value, loading }: { value: TimelineItem[] | null; loading: boolean }) {
  const [open, setOpen] = useState<string | null>(null)
  if (loading || !value) return <Loading />
  return <section className="visual-page"><header className="compact-heading"><div><p className="eyebrow">MEMORY LIFECYCLE</p><p>未确认、denied 和 local-only 记录只显示元数据，不显示正文。</p></div></header>
    <div className="timeline">{value.length === 0 ? <p className="muted">还没有记忆记录。</p> : value.map((item) => <article key={item.id}><span className={`dot status-${item.status}`} /><div><p className="timeline-meta">{displayTime(item.updated || item.created)} · {item.status} · {item.access}</p><h3>{item.subject || item.type}</h3><p>来源：{item.sourceAgent}</p>{item.previewAvailable && <button className="reveal" onClick={() => setOpen(open === item.id ? null : item.id)}>{open === item.id ? '收起摘要' : '查看确认摘要'}</button>}{open === item.id && <p className="preview">{item.preview}</p>}</div></article>)}</div>
  </section>
}

const dimensionNames: Record<string, string> = { mind: '心智', body: '身体', spirit: '意义与关系', vocation: '工作与创造' }
function Human3Page({ value, loading }: { value: Human3Trend | null; loading: boolean }) {
  if (loading || !value) return <Loading />
  return <section className="visual-page"><header className="compact-heading"><div><p className="eyebrow">HUMAN 3.0 / REFLECTION</p><p className="disclaimer">{value.disclaimer}</p></div></header>
    {value.points.length === 0 ? <div className="empty-card"><h3>还没有已确认的复盘</h3><p>完成一次对话式复盘并由你确认后，趋势才会显示在这里。</p></div> : <div className="human-points">{value.points.map((point) => <article key={point.date}><h3>{point.date}</h3><div className="score-bars">{value.dimensions.map((key) => <div key={key}><span>{dimensionNames[key] ?? key}</span><progress max="10" value={point.scores[key] ?? 0} /><strong>{point.scores[key] ?? '—'}</strong></div>)}</div><p>{point.summary}</p></article>)}</div>}
  </section>
}

function messageFor(error: unknown) { return error instanceof Error ? error.message : '本地服务暂时不可用，请稍后重试。' }

export default App
