import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { BookOpen, CalendarDots, Database, GearSix, HardDrives, House, List, LockKey, Network, PlugsConnected, ShieldCheck, Sparkle, Stack, UserCircle, Warning, X } from '@phosphor-icons/react'
import { ApiClient, ApiError, type Human3Trend, type Memory, type MemoryStats, type MonthlyOverview, type MonthlyReflection, type MonthlyTrend, type ProfileOverview, type ReflectionDimension, type ReflectionEvent, type ReflectionGoal, type SecurityCenter } from './api'
import MemoryReviewPage from './MemoryReviewPage'
import MemoryTimelinePage from './MemoryTimelinePage'
import MonthlyReflectionPage from './MonthlyReflectionPage'
import { clearReflectionDraft } from './reflectionDraft'
import SecurityCenterPage from './SecurityCenterPage'
import MonthlyTrendPage from './MonthlyTrendPage'
import GrowthDashboard from './GrowthDashboard'
import OverviewPage from './OverviewPage'
import BackupRecoveryPage from './BackupRecoveryPage'
import GitHubBackupPage from './GitHubBackupPage'
import SettingsPage from './SettingsPage'
import ConceptGuide from './ConceptGuide'

import ProviderAuthPage from './ProviderAuthPage'

import ImportPage from './ImportPage'
import AIConnectionsPage from './AIConnectionsPage'
import FirstRunWizard from './FirstRunWizard'
import { LoadingState } from './components/StateBlocks'
import relationshipMap from './assets/relationship-map.webp'
import { LANGUAGES, localizedError, translate, useLanguage, useT } from './i18n'
import type { Language } from './i18n'
import './App.css'

// The graph engine is only downloaded when the Memory Graph route is opened.
const MemoryGraphPage = lazy(() => import('./MemoryGraphPage'))

type Notice = { kind: 'success' | 'error'; text: string } | null
export type View = 'overview' | 'graph' | 'review' | 'profile' | 'timeline' | 'privacy' | 'reflection' | 'human3' | 'monthly' | 'growth' | 'backup' | 'connections' | 'import' | 'providers' | 'github' | 'data' | 'settings'

const VIEW_ROUTES: Record<View, string> = {
  overview: '#/overview', graph: '#/memory-graph', review: '#/memory-review', profile: '#/profile',
  timeline: '#/memory-timeline', privacy: '#/privacy-audit', reflection: '#/monthly-reflection',
  human3: '#/human-3', monthly: '#/monthly-trend', growth: '#/growth-dashboard', backup: '#/backup-recovery', connections: '#/ai-connections', providers: '#/providers', import: '#/import', github: '#/github-backup',
  data: '#/data', settings: '#/settings',
}
const ROUTE_VIEWS = new Map(Object.entries(VIEW_ROUTES).map(([view, route]) => [route, view as View]))
function viewFromHash(hash: string): View | null { return ROUTE_VIEWS.get(hash) ?? null }

/** Navigation hubs own the navigation entry; their tabs stay reachable as routes. */
const HUB_MEMBERS: Partial<Record<View, View[]>> = {
  graph: ['graph', 'timeline', 'review'],
  reflection: ['reflection', 'monthly'],
  growth: ['growth', 'human3'],
  backup: ['data', 'backup', 'github', 'import'],
  connections: ['connections', 'providers'],
}

function navigationActive(item: View, current: View) {
  return item === current || Boolean(HUB_MEMBERS[item]?.includes(current))
}

type HubTab = { label: string; view: View; active: boolean }
function HubTabs({ label, description, tabs, onSelect }: { label: string; description: string; tabs: HubTab[]; onSelect: (view: View) => void }) {
  return <section className="hub-bar" aria-label={label}>
    <div><p className="eyebrow">{label}</p><p>{description}</p></div>
    <nav className="hub-tabs" aria-label={label}>
      {tabs.map((tab) => <button key={tab.view} className={tab.active ? 'active' : ''} aria-pressed={tab.active} onClick={() => onSelect(tab.view)}>{tab.label}</button>)}
    </nav>
  </section>
}

type TokenGateProps = {
  error: string
  connecting: boolean
  onConnect: (token: string) => Promise<void>
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
      setFieldError(t('gate.emptyToken'))
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
  const [securityView, setSecurityView] = useState<SecurityCenter | null>(null)
  const [clientCredential, setClientCredential] = useState('')
  const [human3View, setHuman3View] = useState<Human3Trend | null>(null)
  const [monthlyView, setMonthlyView] = useState<MonthlyOverview | null>(null)
  const [reflectionView, setReflectionView] = useState<MonthlyReflection | null>(null)
  const [reflectionDirty, setReflectionDirty] = useState(false)
  const [reflectionConflict, setReflectionConflict] = useState(false)
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
  const [conceptOpen, setConceptOpen] = useState(false)
  const [highContrast, setHighContrast] = useState(() => {
    try { return localStorage.getItem('nexora.contrast') === 'high' } catch { return false }
  })

  useEffect(() => {
    document.documentElement.classList.toggle('high-contrast', highContrast)
    try { localStorage.setItem('nexora.contrast', highContrast ? 'high' : 'standard') } catch { /* storage unavailable */ }
  }, [highContrast])
  const sessionEpoch = useRef(0)
  const viewRequest = useRef(0)
  const reflectionMutationEpoch = useRef(0)
  const reflectionDirtyRef = useRef(false)
  const viewRef = useRef<View>('review')
  const visualAbort = useRef<AbortController | null>(null)
  const sessionAbort = useRef<AbortController | null>(null)

  useEffect(() => { reflectionDirtyRef.current = reflectionDirty }, [reflectionDirty])
  useEffect(() => { viewRef.current = view }, [view])
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
          setWizardVaultName(vaultInfo?.displayName && vaultInfo.displayName !== 'vault' ? vaultInfo.displayName : t('app.mySpace'))
          setFirstRun(untouched)
        })
      }
      setProfileView(null); setSecurityView(null); setHuman3View(null); setMonthlyView(null); setReflectionView(null); setMonthlyTrendView(null)
      setNotice(null)
    } catch (error) {
      if (controller.signal.aborted || epoch !== sessionEpoch.current) return
      setToken('')
      setGateError(localizedError(language, error instanceof ApiError && error.status === 401 ? t('gate.invalidToken') : messageFor(error)))
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
      if (viewRef.current === 'reflection' && next !== 'reflection' && reflectionDirtyRef.current) {
        if (!window.confirm(t('monthly.leaveConfirm'))) {
          window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${VIEW_ROUTES.reflection}`)
          return
        }
        reflectionDirtyRef.current = false
        setReflectionDirty(false)
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
  }, [client, t])

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
      const sidebar = sidebarRef.current
      if (!sidebar) return
      // 只在焦点仍停在菜单按钮或抽屉外时才接管；如果用户已经把焦点移进抽屉，就不要抢。
      const active = document.activeElement
      if (active && active !== menuButtonRef.current && sidebar.contains(active)) return
      sidebar.querySelector<HTMLButtonElement>('nav button[aria-current="page"]')?.focus()
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
        disconnect(t('app.sessionExpired'))
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
    setProfileView(null); setSecurityView(null); setHuman3View(null); setMonthlyView(null); setReflectionView(null); setClientCredential('')
    setReflectionDirty(false); setReflectionConflict(false)
    setVisualLoading(null)
    setFirstRun(false)
    setGateError(message)
  }

  async function openView(next: View, updateRoute = true, compete = true) {
    if (!client) return
    // 月度复盘有未保存内容时，应用内导航前提醒；草稿仍留在本机以便恢复。
    if (compete && view === 'reflection' && next === 'reflection' && reflectionDirty) return
    if (compete && view === 'reflection' && next !== 'reflection' && reflectionDirty) {
      if (!window.confirm(t('monthly.leaveConfirm'))) return
      reflectionDirtyRef.current = false
      setReflectionDirty(false)
    }
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
    if (next === 'graph' || next === 'timeline' || next === 'growth' || next === 'backup' || next === 'overview' || next === 'connections' || next === 'providers' || next === 'import' || next === 'github' || next === 'data' || next === 'settings') return
    const controller = new AbortController()
    visualAbort.current = controller
    const epoch = sessionEpoch.current
    const request = viewRequest.current
    if (next === 'profile') setProfileView(null)
    if (next === 'reflection') { setReflectionView(null); setMonthlyView(null) }
    if (next === 'privacy') setSecurityView(null)
    if (next === 'human3') setHuman3View(null)
    if (next === 'monthly') setMonthlyTrendView(null)
    setVisualLoading(next)
    try {
      const result = next === 'reflection' ? await client.monthlyOverview(controller.signal)
        : next === 'profile' ? await client.profileOverview(controller.signal)
          : next === 'privacy' ? await client.securityCenter(controller.signal)
            : next === 'monthly' ? await client.monthlyTrend(controller.signal)
              : await client.human3Trend(controller.signal)
      if (epoch !== sessionEpoch.current || request !== viewRequest.current) return
      if (next === 'reflection') { const monthly = result as MonthlyOverview; setMonthlyView(monthly); setReflectionView(monthly.reflections.find((item) => item.month === monthly.currentMonth) ?? monthly.reflections[0] ?? null) }
      if (next === 'profile') setProfileView(result as ProfileOverview)
      if (next === 'privacy') setSecurityView(result as SecurityCenter)
      if (next === 'human3') setHuman3View(result as Human3Trend)
      if (next === 'monthly') setMonthlyTrendView(result as MonthlyTrend)
    } catch (error) {
      if (controller.signal.aborted || epoch !== sessionEpoch.current || request !== viewRequest.current) return
      if (error instanceof ApiError && error.status === 401) disconnect(t('app.sessionExpired'))
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
      reflectionMutationEpoch.current += 1
      setMonthlyView((current) => current ? { ...current, reflections: [result, ...current.reflections.filter((item) => item.id !== result.id)].sort((a, b) => b.month.localeCompare(a.month)) } : current)
      return true
    } catch (error) {
      if (epoch !== sessionEpoch.current || signal?.aborted) return false
      // revision 冲突：后端已拒绝覆盖，这里标记出来让页面提供丢弃/恢复选择。
      if (error instanceof ApiError && error.status === 409) setReflectionConflict(true)
      handleMutationError(error)
      return false
    } finally { if (epoch === sessionEpoch.current) setSaving(false) }
  }

  async function createReflection(month: string) { const ok = await monthlyAction((api, signal) => api.createMonthly(month, signal)); if (ok) setNotice({ kind: 'success', text: t('app.reflectionCreated') }); return Boolean(ok) }
  function saveReflectionDimension(dimension: ReflectionDimension, content: string) { return reflectionView ? monthlyAction((api, signal) => api.saveMonthlyDimension(reflectionView.id, dimension, content, reflectionView.revision, signal)) : Promise.resolve(false) }
  function addReflectionEvent(event: Omit<ReflectionEvent, 'id'>) { return reflectionView ? monthlyAction((api, signal) => api.addMonthlyEvent(reflectionView.id, event, reflectionView.revision, signal)) : Promise.resolve(false) }
  function deleteReflectionEvent(eventId: string) { return reflectionView ? monthlyAction((api, signal) => api.deleteMonthlyEvent(reflectionView.id, eventId, reflectionView.revision, signal)) : Promise.resolve(false) }
  function saveReflectionGoals(goals: ReflectionGoal[]) { return reflectionView ? monthlyAction((api, signal) => api.saveMonthlyGoals(reflectionView.id, goals, reflectionView.revision, signal)) : Promise.resolve(false) }
  function generateReflectionSummary() { return reflectionView ? monthlyAction((api, signal) => api.generateMonthlySummary(reflectionView.id, reflectionView.revision, signal)) : Promise.resolve(false) }
  function saveReflectionSummary(summary: string) { return reflectionView ? monthlyAction((api, signal) => api.saveMonthlySummary(reflectionView.id, summary, reflectionView.revision, signal)) : Promise.resolve(false) }
  async function confirmReflection() { if (!reflectionView || !window.confirm(t('app.confirmReflection'))) return false; const ok = await monthlyAction((api, signal) => api.confirmMonthly(reflectionView.id, reflectionView.revision, signal)); if (ok) setNotice({ kind: 'success', text: t('app.reflectionConfirmed') }); return Boolean(ok) }

  // 冲突后回到服务器版本：丢弃本机草稿并重新拉取，绝不静默覆盖较新内容。
  async function reloadReflectionServer() {
    if (!client) return
    const id = reflectionView?.id
    const mutationEpoch = reflectionMutationEpoch.current
    const session = sessionEpoch.current
    try {
      const result = await client.monthlyOverview(sessionAbort.current?.signal)
      if (session !== sessionEpoch.current || mutationEpoch !== reflectionMutationEpoch.current) return
      setMonthlyView(result)
      const next = result.reflections.find((item) => item.id === id)
        ?? result.reflections.find((item) => item.month === result.currentMonth)
        ?? result.reflections[0]
        ?? null
      setReflectionView(next)
      if (id) clearReflectionDraft(id)
      reflectionDirtyRef.current = false
      setReflectionConflict(false)
      setReflectionDirty(false)
      setNotice({ kind: 'success', text: t('monthly.reloaded') })
    } catch (error) {
      handleMutationError(error)
    }
  }

  async function refreshSecurity() { if (!client) return false; try { const result = await client.securityCenter(sessionAbort.current?.signal); setSecurityView(result); return true } catch (error) { handleMutationError(error); return false } }
  async function authorizeSecurityClient(name: string, scopes: string[]) { if (!client) return null; setSaving(true); try { const result = await client.authorizeSecurityClient(name, scopes, sessionAbort.current?.signal); setClientCredential(result.credential); setNotice({ kind: 'success', text: t('app.clientAuthorized') }); await refreshSecurity(); return result.client.id } catch (error) { handleMutationError(error); return null } finally { setSaving(false) } }
  async function updateSecurityScopes(id: string, scopes: string[]) { if (!client) return false; setSaving(true); try { await client.updateSecurityScopes(id, scopes, sessionAbort.current?.signal); setNotice({ kind: 'success', text: t('app.scopesUpdated') }); await refreshSecurity(); return true } catch (error) { handleMutationError(error); return false } finally { setSaving(false) } }
  async function revokeSecurityClient(id: string) { if (!client) return false; setSaving(true); try { await client.revokeSecurityClient(id, sessionAbort.current?.signal); setNotice({ kind: 'success', text: t('app.clientRevoked') }); await refreshSecurity(); return true } catch (error) { handleMutationError(error); return false } finally { setSaving(false) } }
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
      setNotice({ kind: 'success', text: t('app.changesSaved') })
      await loadCandidates()
      return true
    } catch (error) { if (epoch === sessionEpoch.current && !signal?.aborted) handleMutationError(error); return false } finally { if (epoch === sessionEpoch.current) setSaving(false) }
  }

  async function act(action: 'confirm' | 'reject') {
    if (!client || !selected) return false
    const label = action === 'confirm' ? t('app.confirmMemory') : t('app.rejectMemory')
    if (!window.confirm(label)) return false
    const epoch = sessionEpoch.current
    const signal = sessionAbort.current?.signal
    setSaving(true)
    try {
      await client.action(selected.id, action, selected.revision, rejectionReason.trim(), signal)
      if (epoch !== sessionEpoch.current || signal?.aborted) return false
      setNotice({ kind: 'success', text: t(action === 'confirm' ? 'app.memoryConfirmed' : 'app.memoryRejected') })
      await loadCandidates()
      return true
    } catch (error) { if (epoch === sessionEpoch.current && !signal?.aborted) handleMutationError(error); return false } finally { if (epoch === sessionEpoch.current) setSaving(false) }
  }

  function handleMutationError(error: unknown) {
    if (error instanceof ApiError && error.status === 401) {
      disconnect(t('app.sessionExpired'))
    } else if (error instanceof ApiError && error.status === 409) {
      setNotice({ kind: 'error', text: t('error.conflict') })
    } else {
      setNotice({ kind: 'error', text: messageFor(error) })
    }
  }

  async function shutdown() {
    if (!client || !window.confirm(t('app.confirmShutdown'))) return
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

  const navigationGroups: { title: string; items: { label: string; view: View; icon: typeof House }[] }[] = [
    {
      title: t('nav.group.workspace'),
      items: [
        { label: t('nav.overview'), view: 'overview', icon: House },
        { label: t('nav.memory'), view: 'graph', icon: Stack },
        { label: t('nav.profile'), view: 'profile', icon: UserCircle },
        { label: t('nav.reflection'), view: 'reflection', icon: CalendarDots },
        { label: t('nav.growth'), view: 'growth', icon: Sparkle },
      ],
    },
    {
      title: t('nav.group.system'),
      items: [
        { label: t('nav.privacy'), view: 'privacy', icon: ShieldCheck },
        { label: t('nav.backupShort'), view: 'backup', icon: HardDrives },
        { label: t('nav.connectionsMcp'), view: 'connections', icon: PlugsConnected },
      ],
    },
  ]
  const titles: Record<View, string> = {
    overview: t('title.overview'), graph: t('title.memory'), review: t('title.memory'), profile: t('nav.profile'),
    timeline: t('title.memory'), privacy: t('title.privacy'), reflection: t('title.reflection'),
    human3: t('title.growth'), monthly: t('title.reflection'), growth: t('title.growth'),
    backup: t('title.backup'), connections: t('title.connections'), providers: t('title.connections'),
    import: t('title.backup'), github: t('title.backup'), data: t('title.backup'), settings: t('title.settings'),
  }

  function closeNavigation() {
    setNavigationOpen(false)
    window.requestAnimationFrame(() => menuButtonRef.current?.focus())
  }

  return <main className="app-shell">
    <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById('main-content')?.focus() }}>{t('a11y.skipToContent')}</a>
    <button ref={menuButtonRef} className="mobile-menu" aria-label={t('a11y.openNavigation')} aria-controls="primary-navigation" aria-expanded={navigationOpen} onClick={() => setNavigationOpen(true)}><List size={22} /></button>
    {navigationOpen && <button className="navigation-scrim" aria-label={t('a11y.closeNavigation')} onClick={closeNavigation} />}
    <aside ref={sidebarRef} id="primary-navigation" aria-label={t('a11y.primaryNavigation')} className={`sidebar ${navigationOpen ? 'open' : ''}`}>
      <div className="brand"><span className="brand-mark"><img src="/brand/nexora-symbol.svg" alt="" aria-hidden="true" /></span><div><strong>NEXORA <em>知序</em></strong><small>PERSONAL INTELLIGENCE</small></div><button className="drawer-close" aria-label={t('a11y.closeNavigation')} onClick={closeNavigation}><X /></button></div>
      <nav aria-label={t('a11y.workspaceNavigation')}>
        {navigationGroups.map((group) => <div className="nav-group" key={group.title}>
          <p className="nav-group-title">{group.title}</p>
          {group.items.map((item) => { const Icon = item.icon; const active = navigationActive(item.view, view); return <button key={item.label} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined} onClick={() => { void openView(item.view); setNavigationOpen(false); if (item.view === view) window.requestAnimationFrame(() => titleRef.current?.focus({ preventScroll: true })) }}><Icon size={21} weight={active ? 'duotone' : 'regular'} /><span>{item.label}</span></button> })}
        </div>)}
      </nav>
      <div className="sidebar-footer">
        <button className={`settings-link ${view === 'settings' ? 'active' : ''}`} aria-current={view === 'settings' ? 'page' : undefined} onClick={() => { void openView('settings'); setNavigationOpen(false) }}><GearSix size={20} weight={view === 'settings' ? 'duotone' : 'regular'} /><span>{t('nav.settings')}</span></button>
        <button className="concept-link" onClick={() => { setConceptOpen(true); setNavigationOpen(false) }}><BookOpen size={18} /><span>{t('concepts.open')}</span></button>
        <p className="sidebar-privacy-note"><LockKey size={16} /><span>{t('sidebar.localPrivate')}</span></p>
      </div>
    </aside>

    <section ref={stageRef} id="main-content" className={`app-stage ${view === 'overview' ? 'with-status' : ''}`} tabIndex={-1} aria-label={t('a11y.main')}>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{navigationAnnouncement}</div>
      <header className="topbar"><div><p className="eyebrow">{t('shell.workspace')}</p><h1 ref={titleRef} tabIndex={-1}>{titles[view]}</h1></div><div className="topbar-actions"><span className="service-status"><i />{t('topbar.localService')}</span><span className="service-status"><i />{t('topbar.vaultReady')}</span><button className="icon-button concept-button" aria-label={t('concepts.open')} title={t('concepts.open')} onClick={() => setConceptOpen(true)}><BookOpen size={19} /></button><button className="text-button" onClick={() => setHighContrast((current) => !current)} aria-pressed={highContrast}>{highContrast ? t('app.contrastStandard') : t('app.contrastHigh')}</button><label className="language-switch"><span className="sr-only">{t('topbar.language')}</span><select aria-label={t('topbar.language')} value={language} onChange={(event) => changeLanguage(event.target.value as Language)}>{LANGUAGES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><button className="icon-button" aria-label={t('topbar.refreshCandidates')} title={t('topbar.refreshCandidates')} onClick={() => void loadCandidates()} disabled={loading}><Database size={19} /></button><button className="text-button" onClick={() => disconnect()}>{t('topbar.disconnect')}</button><button className="text-button danger-link" onClick={() => void shutdown()} disabled={saving}>{t('topbar.shutdown')}</button></div></header>
      <div className="content-shell">
        {externalChange && <div className="external-banner" role="status"><Warning size={20} /><span>{t('external.banner')}</span><button className="text-button" onClick={() => void refreshAfterExternal()}>{t('external.refresh')}</button><button className="text-button" onClick={() => setExternalChange(false)}>{t('external.dismiss')}</button></div>}
        {notice && <div className={`notice ${notice.kind}`} role="status"><span>{notice.text}</span>{notice.kind === 'error' && <button onClick={() => void loadCandidates()}>{t('common.refresh')}</button>}</div>}

        {(view === 'graph' || view === 'review' || view === 'timeline') && <>
          <HubTabs label={t('title.memory')} description={t('hub.memory.desc')} tabs={[
            { label: t('nav.graph'), view: 'graph', active: view === 'graph' },
            { label: t('nav.timeline'), view: 'timeline', active: view === 'timeline' },
            { label: t('nav.review'), view: 'review', active: view === 'review' },
          ]} onSelect={(next) => void openView(next)} />
          {view === 'graph' && <Suspense fallback={<LoadingState label={t('memory.graph.chunkLoading')} />}><MemoryGraphPage client={client!} onImport={() => void openView('import')} onReview={(id) => { const memory = memories.find((item) => item.id === id); if (memory) { setSelectedId(memory.id); setDraft(memory.content); setRejectionReason('') } void openView('review') }} /></Suspense>}
          {view === 'review' && <MemoryReviewPage memories={memories} stats={memoryStats} selected={selected} draft={draft} rejectionReason={rejectionReason} loading={loading} saving={saving} onSelect={(memory) => { setSelectedId(memory.id); setDraft(memory.content); setRejectionReason('') }} onDraft={setDraft} onRejectionReason={setRejectionReason} onSave={save} onAct={act} onOnboarding={() => void openView('profile')} />}
          {view === 'timeline' && <MemoryTimelinePage client={client!} onReview={(id) => { const memory = memories.find((item) => item.id === id); if (memory) { setSelectedId(memory.id); setDraft(memory.content); setRejectionReason('') } void openView('review') }} />}
        </>}
        {(view === 'reflection' || view === 'monthly') && <>
          <HubTabs label={t('title.reflection')} description={t('hub.reflection.desc')} tabs={[
            { label: t('nav.monthlyReflection'), view: 'reflection', active: view === 'reflection' },
            { label: t('nav.monthly'), view: 'monthly', active: view === 'monthly' },
          ]} onSelect={(next) => void openView(next)} />
          {view === 'reflection' && <MonthlyReflectionPage overview={monthlyView} selected={reflectionView} loading={visualLoading === 'reflection'} saving={saving} onSelect={setReflectionView} onCreate={createReflection} onDimension={saveReflectionDimension} onAddEvent={addReflectionEvent} onDeleteEvent={deleteReflectionEvent} onGoals={saveReflectionGoals} onGenerateSummary={generateReflectionSummary} onSummary={saveReflectionSummary} onConfirm={confirmReflection} onDirtyChange={setReflectionDirty} conflict={reflectionConflict} onConflictDismiss={() => setReflectionConflict(false)} onReloadServer={() => void reloadReflectionServer()} />}
          {view === 'monthly' && <MonthlyTrendPage value={monthlyTrendView} loading={visualLoading === 'monthly'} />}
        </>}
        {(view === 'growth' || view === 'human3') && <>
          <HubTabs label={t('title.growth')} description={t('hub.growth.desc')} tabs={[
            { label: t('nav.growthDashboard'), view: 'growth', active: view === 'growth' },
            { label: t('nav.human3Trend'), view: 'human3', active: view === 'human3' },
          ]} onSelect={(next) => void openView(next)} />
          {view === 'growth' && client && <GrowthDashboard client={client} />}
          {view === 'human3' && <Human3Page value={human3View} loading={visualLoading === 'human3'} />}
        </>}
        {(view === 'data' || view === 'backup' || view === 'github' || view === 'import') && <>
          <HubTabs label={t('title.backup')} description={t('hub.data.desc')} tabs={[
            { label: t('nav.backup'), view: 'backup', active: view === 'data' || view === 'backup' },
            { label: t('nav.github'), view: 'github', active: view === 'github' },
            { label: t('nav.import'), view: 'import', active: view === 'import' },
          ]} onSelect={(next) => void openView(next)} />
          {(view === 'data' || view === 'backup') && client && <BackupRecoveryPage client={client} refreshKey={vaultEpoch} />}
          {view === 'github' && client && <GitHubBackupPage client={client} />}
          {view === 'import' && client && <ImportPage client={client} />}
        </>}
        {(view === 'connections' || view === 'providers') && <>
          <HubTabs label={t('title.connections')} description={t('hub.connections.desc')} tabs={[
            { label: t('nav.connectionsMcp'), view: 'connections', active: view === 'connections' },
            { label: t('nav.providers'), view: 'providers', active: view === 'providers' },
          ]} onSelect={(next) => void openView(next)} />
          {view === 'connections' && client && <AIConnectionsPage client={client} />}
          {view === 'providers' && client && <ProviderAuthPage client={client} />}
        </>}
        {view === 'profile' && <ProfilePage value={profileView} loading={visualLoading === 'profile'} relationshipMap={relationshipMap} onReview={() => void openView('review')} onTimeline={() => void openView('timeline')} />}
        {view === 'privacy' && <SecurityCenterPage value={securityView} loading={visualLoading === 'privacy'} saving={saving} credential={clientCredential} onAuthorize={authorizeSecurityClient} onScopes={updateSecurityScopes} onRevoke={revokeSecurityClient} onQuery={querySecurityEvents} onClearCredential={() => setClientCredential('')} />}
        {view === 'overview' && client && <OverviewPage client={client} onNavigate={(next) => void openView(next)} onConcepts={() => setConceptOpen(true)} refreshKey={vaultEpoch} />}
        {view === 'settings' && client && <SettingsPage client={client} language={language} onLanguage={changeLanguage} highContrast={highContrast} onHighContrast={setHighContrast} onOpenConcepts={() => setConceptOpen(true)} onNavigate={(next) => void openView(next)} />}
      </div>
    </section>

    {view === 'overview' && <aside className="status-panel" aria-label={t('app.spaceStatus')}>
      <div className="status-panel-head"><p className="eyebrow">PERSONAL SPACE</p><h2>{t('app.spaceStatus')}</h2></div>
      <dl className="status-list">
        <div><dt>{t('topbar.localService')}</dt><dd className="ok">{t('app.spaceConnected')}</dd></div>
        <div><dt>{t('app.pending')}</dt><dd>{memoryStats.pendingReview}</dd></div>
        <div><dt>{t('app.confirmedMemories')}</dt><dd>{memoryStats.confirmedMemories}</dd></div>
        <div><dt>{t('app.candidateMemories')}</dt><dd>{memoryStats.candidateMemories}</dd></div>
      </dl>
      <button className="text-button" onClick={() => void loadCandidates()}>{t('app.refreshStatus')}</button>
    </aside>}
    <ConceptGuide open={conceptOpen} onClose={() => setConceptOpen(false)} />
  </main>
}

function Loading() { const t = useT(); return <LoadingState label={t('app.readingProfile')} /> }

function ProfilePage({ value, loading, relationshipMap, onReview, onTimeline }: { value: ProfileOverview | null; loading: boolean; relationshipMap: string; onReview: () => void; onTimeline: () => void }) {
  const t = useT()
  if (loading || !value) return <Loading />
  return <section className="visual-page profile-page"><header className="profile-heading compact-heading"><div><p className="eyebrow">PERSONAL INTELLIGENCE</p><p>{t('app.protectedHint')}</p></div><span className="boundary-badge"><ShieldCheck size={18} />{t('app.protectedTitle')}</span></header>
    {value.protected ? <div className="protected"><LockKey size={20} />{t('app.protectedBody', { level: value.access })}</div> : <div className="profile-layout">
      <section className="profile-library" aria-label={t('app.profileContent')}>
        <div className="profile-summary"><span className="profile-avatar"><UserCircle size={42} weight="duotone" /></span><div><p className="eyebrow">PROFILE SUMMARY</p><h3>{t('app.profileSummary')}</h3><p>{t('app.profileSummaryHint')}</p></div><button className="secondary-action" onClick={onTimeline}>{t('app.viewLifecycle')}</button></div>
        <div className="profile-sections">{value.sections.length === 0 ? <div className="profile-empty"><Sparkle size={24} /><h3>{t('app.profileEmptyTitle')}</h3><p>{t('app.profileEmptyHint')}</p><button className="primary-action" onClick={onReview}>{t('app.goReview')}</button></div> : value.sections.map((section) => <article key={section.title}><span className="section-icon"><Sparkle size={20} /></span><div><h3>{section.title}</h3>{section.items.length ? <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="muted">{t('app.notFilled')}</p>}</div></article>)}</div>
      </section>
      <aside className={`relationship-panel ${value.hasConfirmedMemories ? '' : 'inactive'}`}>
        <div><p className="eyebrow">RELATIONSHIP MAP</p><h3>{t('app.relationshipMap')}</h3><p>{t('app.relationshipHint')}</p></div>
        {/* 图谱是固定的视觉框架，不代表具体的人际关系；没有已确认记忆时整体淡出并给出明确空状态。 */}
        <img src={relationshipMap} alt={t('app.relationshipAlt')} />
        <div className="relationship-empty"><Network size={20} /><span>{value.hasConfirmedMemories ? t('app.hasConfirmed') : t('app.noConfirmed')}</span></div>
      </aside>
      <aside className="profile-inspector"><p className="eyebrow">NEXT ACTION</p><h3>{value.sections.length ? t('app.nextAction') : t('app.firstLongTerm')}</h3><p>{value.sections.length ? t('app.nextActionHint') : t('app.firstLongTermHint')}</p><button className="primary-action" onClick={onReview}><Stack size={18} />{t('app.goReview')}</button><hr /><h3>{t('app.confirmFirst')}</h3><p>{t('app.confirmFirstHint')}</p><hr /><h3>{t('app.localFirst')}</h3><p>{t('app.localFirstHint')}</p></aside>
    </div>}
  </section>
}

function dimensionNames(t: (key: string) => string): Record<string, string> { return { mind: t('human3.dimension.mind'), body: t('human3.dimension.body'), spirit: t('human3.dimension.spirit'), vocation: t('human3.dimension.vocation') } }
function Human3Page({ value, loading }: { value: Human3Trend | null; loading: boolean }) {
  const t = useT()
  const dimensionNamesCopy = dimensionNames(t)
  if (loading || !value) return <Loading />
  return <section className="visual-page"><header className="compact-heading"><div><p className="eyebrow">HUMAN 3.0 / REFLECTION</p><p className="disclaimer">{value.disclaimer}</p></div></header>
    {value.points.length === 0 ? <div className="empty-card"><h3>{t('human3.emptyTitle')}</h3><p>{t('human3.emptyDetail')}</p></div> : <div className="human-points">{value.points.map((point) => <article key={point.date}><h3>{point.date}</h3><div className="score-bars">{value.dimensions.map((key) => <div key={key}><span>{dimensionNamesCopy[key] ?? key}</span><progress max="10" value={point.scores[key] ?? 0} /><strong>{point.scores[key] ?? '—'}</strong></div>)}</div><p>{point.summary}</p></article>)}</div>}
  </section>
}

function messageFor(error: unknown) { return error instanceof Error ? error.message : translate('app.unavailable') }

export default App
