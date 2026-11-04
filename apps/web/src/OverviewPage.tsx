import { useEffect, useState } from 'react'
import { Brain, Clock, Network, ShieldCheck, Stack, UserCircle } from '@phosphor-icons/react'
import type { ApiClient, AuditEvent, OverviewSnapshot } from './api'

type Props = {
  client: ApiClient
  onNavigate: (view: 'review' | 'profile' | 'privacy' | 'growth') => void
}

function displayTime(value: string) {
  if (!value) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function accessLabel(access: string) {
  return { allowed: '完整可见', 'summary-only': '仅摘要', 'local-only': '仅本地', denied: '已保护' }[access] ?? access
}

function recentSummary(events: AuditEvent[]) {
  if (events.length === 0) return '尚无 AI 访问记录'
  const latest = events[0]
  return `${latest.clientId} · ${latest.eventType}`
}

export default function OverviewPage({ client, onNavigate }: Props) {
  const [value, setValue] = useState<OverviewSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    client.overview().then((data) => { if (!cancelled) setValue(data) })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : '加载失败。') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [client])

  if (loading) return <div className="skeletons" aria-label="加载中"><i /><i /><i /></div>
  if (error) return <div className="profile-empty"><h3>无法加载总览</h3><p>{error}</p></div>
  if (!value) return <div className="profile-empty"><h3>总览</h3><p>正在读取本地档案。</p></div>

  const { profile, memory, clients, recentAccess, growth, pending } = value
  const latestMonth = growth.latestMonth

  return <section className="overview-page" aria-label="个人智能中枢总览">
    <div className="overview-hero">
      <div className="ai-core" aria-hidden="true">
        <span className="core-ring ring-1" /><span className="core-ring ring-2" /><span className="core-ring ring-3" /><span className="core-nucleus" />
      </div>
      <div className="core-caption">
        <p className="eyebrow">PERSONAL INTELLIGENCE CORE</p>
        <h2>你的个人智能中枢</h2>
        <p>档案、记忆、连接与成长，都在这里汇总——所有数据仅在本机，由你掌控。</p>
      </div>
      <div className="core-metrics" aria-label="核心指标">
        <article><strong>{memory.confirmedMemories}</strong><span>确认记忆</span></article>
        <article><strong>{clients.total}</strong><span>已连接 AI</span></article>
        <article><strong>{pending}</strong><span>待处理</span></article>
      </div>
    </div>

    <div className="overview-modules" aria-label="功能模块">
      <button className="overview-module" onClick={() => onNavigate('profile')}>
        <span className="module-icon"><UserCircle size={26} /></span>
        <div><p className="eyebrow">PROFILE</p><h3>个人档案</h3><p>当前状态：{accessLabel(profile.access)}</p></div>
      </button>
      <button className="overview-module" onClick={() => onNavigate('review')}>
        <span className="module-icon"><Stack size={26} /></span>
        <div><p className="eyebrow">MEMORY</p><h3>记忆</h3><p>{memory.confirmedMemories} 条确认 · {memory.candidateMemories} 条候选</p></div>
      </button>
      <button className="overview-module" onClick={() => onNavigate('privacy')}>
        <span className="module-icon"><Network size={26} /></span>
        <div><p className="eyebrow">AI CONNECTIONS</p><h3>AI 客户端</h3><p>{clients.total} 个已授权连接</p></div>
      </button>
      <button className="overview-module" onClick={() => onNavigate('privacy')}>
        <span className="module-icon"><ShieldCheck size={26} /></span>
        <div><p className="eyebrow">RECENT ACCESS</p><h3>最近访问</h3><p>{recentSummary(recentAccess)}</p></div>
      </button>
      <button className="overview-module" onClick={() => onNavigate('growth')}>
        <span className="module-icon"><Brain size={26} /></span>
        <div><p className="eyebrow">GROWTH</p><h3>成长变化</h3><p>{latestMonth ? `最新：${latestMonth.month}` : '尚无已确认的成长记录'}</p></div>
      </button>
      <button className="overview-module" onClick={() => onNavigate('review')}>
        <span className="module-icon"><Clock size={26} /></span>
        <div><p className="eyebrow">NEXT</p><h3>待处理</h3><p>{pending > 0 ? `${pending} 条候选记忆待审核` : '暂无待处理事项'}</p></div>
      </button>
    </div>

    {recentAccess.length > 0 && <div className="overview-recent" aria-label="最近访问明细">
      <h3>最近 AI 访问</h3>
      <ul>{recentAccess.slice(0, 4).map((event) => <li key={event.eventId}><span className={event.result}>{event.result}</span><strong>{event.clientId}</strong><em>{event.eventType}</em><time>{displayTime(event.timestamp)}</time></li>)}</ul>
    </div>}
  </section>
}
