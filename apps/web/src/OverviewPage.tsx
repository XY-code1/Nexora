import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Brain, ChatCircle, Clock, ShieldCheck, Stack, UserCircle } from '@phosphor-icons/react'
import type { ApiClient, AuditEvent, OverviewSnapshot, TimelineItem, VaultBackup, VaultStatus } from './api'
import { EmptyState, ErrorState, LoadingState } from './components/StateBlocks'

type Props = {
  client: ApiClient
  onNavigate: (view: 'review' | 'onboarding' | 'profile' | 'privacy' | 'reflection' | 'growth') => void
}

type Snapshot = {
  overview: OverviewSnapshot
  timeline: TimelineItem[]
  vault: VaultStatus | null
  backups: VaultBackup[]
}

function displayTime(value: string) {
  if (!value) return '时间未知'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
}

function accessLabel(access: string) {
  return { allowed: '完整可见', 'summary-only': '仅摘要', 'local-only': '仅本地', denied: '已保护' }[access] ?? access
}

function recentSummary(events: AuditEvent[]) {
  if (events.length === 0) return '尚无 AI 访问记录'
  const latest = events[0]
  return `${latest.clientId} · ${latest.eventType}`
}

/**
 * 阶段二：日常使用的首页。
 *
 * 首页回答用户真正关心的四个问题：
 * 1. 我的个人档案目前是什么状态？      → 已确认的个人信息
 * 2. 最近有什么新记忆？                → 最近的记忆变化
 * 3. 我现在最值得处理的事情是什么？    → 下一步（唯一推荐）
 * 4. 哪些 AI 正在获得我的授权？        → 已授权的 AI 工具
 *
 * 减密原则（用户实测反馈：文字过于密集）：
 * - 面板只用中文标题，不再叠加英文标签说明同一件事。
 * - 不在面板底部重复状态行；补充信息并入正文或右侧面板。
 * - 正文行高放宽，字号提高，让每块内容只有一句话的读法。
 */
export default function OverviewPage({ client, onNavigate }: Props) {
  const [value, setValue] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    Promise.all([
      client.overview(),
      client.timeline().catch(() => [] as TimelineItem[]),
      client.vaultStatus().catch(() => null),
      client.backups().catch(() => ({ currentRevision: '', backups: [] as VaultBackup[] })),
    ])
      .then(([overview, timeline, vault, backup]) => {
        if (cancelled) return
        setValue({ overview, timeline, vault, backups: backup.backups })
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : '加载失败。') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [client])

  const next = useMemo(() => {
    if (!value) return null
    const { overview } = value
    const { memory, pending } = overview
    if (pending > 0) {
      return { label: '审核候选记忆', detail: `${pending} 条内容等待你的判断，确认后才进入正式档案。`, view: 'review' as const, icon: <Stack size={22} /> }
    }
    if (memory.confirmedMemories === 0) {
      return { label: '开始建立个人档案', detail: '通过几步轻量对话，提交你愿意长期保留的信息。', view: 'onboarding' as const, icon: <ChatCircle size={22} /> }
    }
    if (overview.growth.latestMonth === null) {
      return { label: '完成本月复盘', detail: '整理这个月发生了什么，并写下下一步。', view: 'reflection' as const, icon: <Brain size={22} /> }
    }
    return { label: '查看个人档案', detail: '档案已确认信息保持最新，随时核对。', view: 'profile' as const, icon: <UserCircle size={22} /> }
  }, [value])

  if (loading) return <LoadingState label="正在读取本地总览…" />
  if (error) return <ErrorState title="无法加载总览" description={error} />
  if (!value) return <EmptyState title="总览" description="正在读取本地档案。" />

  const { overview, timeline, vault, backups } = value
  const { profile, memory, clients, recentAccess, growth } = overview
  const confirmedItems = timeline.filter((item) => item.status === 'confirmed').slice(0, 5)
  const latestBackup = backups[0]
  const sections = profile.sections.filter((section) => section.items.length > 0)
  const spaceName = vault?.displayName && vault.displayName !== 'vault' ? vault.displayName : '我的个人空间'

  return <section className="overview-page" aria-label="个人空间总览">
    <header className="home-welcome">
      <div>
        <h1>欢迎回到你的个人空间</h1>
        <p>这里汇总你的档案、记忆、连接与成长状态。所有内容只保存在本机，并由你确认后才算数。</p>
      </div>
      <div className="welcome-identity"><span className="welcome-identity-icon"><UserCircle size={22} weight="duotone" /></span><div><strong>{spaceName}</strong></div></div>
    </header>

    {next && <section className="home-next" aria-label="推荐下一步">
      <h2>下一步</h2>
      <button className="home-next-card" onClick={() => onNavigate(next.view)}>
        <span className="home-next-icon">{next.icon}</span>
        <span className="home-next-copy"><strong>{next.label}</strong><em>{next.detail}</em></span>
        <ArrowRight size={20} />
      </button>
    </section>}

    <div className="home-grid">
      <section className="home-panel home-profile" aria-label="已确认的个人信息">
        <header><h2>已确认的个人信息</h2><button className="text-button" onClick={() => onNavigate('profile')}>查看档案</button></header>
        {sections.length === 0
          ? <EmptyState icon={<UserCircle size={24} />} title="档案还是空的" description={`完成一次对话并确认候选记忆后，这里会显示你已确认的信息。当前档案访问等级：${accessLabel(profile.access)}。`} action={<button className="primary-action" onClick={() => onNavigate('onboarding')}>开始建档</button>} />
          : <div className="home-sections">{sections.map((section) => <article key={section.title}><h3>{section.title}</h3><ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul></article>)}</div>}
      </section>

      <section className="home-panel home-activity" aria-label="最近的记忆变化">
        <header><h2>最近的记忆变化</h2><button className="text-button" onClick={() => onNavigate('review')}>记忆审核</button></header>
        {confirmedItems.length === 0
          ? <EmptyState icon={<Clock size={24} />} title="还没有已确认的记忆" description={`当前有 ${memory.candidateMemories} 条候选、${memory.pendingReview} 条待处理。`} />
          : <ul className="home-activity-list">{confirmedItems.map((item) => <li key={item.id}><span className="home-activity-dot" /><div><strong>{item.subject || item.type}</strong><small>{item.type} · {displayTime(item.updated || item.created)}</small></div></li>)}</ul>}
      </section>

      <section className="home-panel home-connections" aria-label="已授权的 AI 工具">
        <header><h2>已授权的 AI 工具</h2><button className="text-button" onClick={() => onNavigate('privacy')}>管理授权</button></header>
        {clients.total === 0
          ? <EmptyState icon={<ShieldCheck size={24} />} title="还没有 AI 获得授权" description={`你可以在「AI 连接」里为具体客户端设置最小权限。${recentSummary(recentAccess) === '尚无 AI 访问记录' ? '' : `最近访问：${recentSummary(recentAccess)}。`}`} action={<button className="primary-action" onClick={() => onNavigate('privacy')}>查看 AI 连接</button>} />
          : <ul className="home-client-list">{clients.active.map((client) => <li key={client.id}><ShieldCheck size={17} /><div><strong>{client.name}</strong><small>{client.scopes.length} 项权限 · {client.activity === 'recently_active' ? '最近活跃' : '尚未连接'}</small></div></li>)}</ul>}
      </section>

      <section className="home-panel home-vault" aria-label="本地文件与备份">
        <header><h2>本地文件与备份</h2></header>
        <dl className="home-vault-list">
          <div><dt>备份数量</dt><dd>{backups.length}</dd></div>
          <div><dt>最近备份</dt><dd>{latestBackup ? displayTime(latestBackup.created) : '尚无备份'}</dd></div>
          <div><dt>外部修改</dt><dd className={vault?.externalChange ? 'warn' : 'ok'}>{vault?.externalChange ? '检测到，待核对' : '未检测到'}</dd></div>
        </dl>
        {growth.latestMonth && <p className="home-growth">最近一次月度复盘：{growth.latestMonth.month}</p>}
      </section>
    </div>
  </section>
}
