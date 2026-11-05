import { useEffect, useState } from 'react'
import { ArrowRight, Brain, ChatCircle, Clock, Network, ShieldCheck, Stack, UserCircle } from '@phosphor-icons/react'
import type { ApiClient, AuditEvent, OverviewSnapshot } from './api'
import { EmptyState, ErrorState, LoadingState } from './components/StateBlocks'

type Props = {
  client: ApiClient
  onNavigate: (view: 'review' | 'onboarding' | 'profile' | 'privacy' | 'reflection' | 'growth') => void
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

  if (loading) return <LoadingState label="正在读取本地总览…" />
  if (error) return <ErrorState title="无法加载总览" description={error} />
  if (!value) return <EmptyState title="总览" description="正在读取本地档案。" />

  const { profile, memory, clients, recentAccess, growth, pending } = value
  const latestMonth = growth.latestMonth
  const next = pending > 0
    ? { label: '审核候选记忆', detail: `${pending} 条内容等待你的判断`, view: 'review' as const }
    : memory.confirmedMemories === 0
      ? { label: '开始对话建档', detail: '提交第一条由你控制的候选记忆', view: 'onboarding' as const }
      : { label: '开始本月复盘', detail: '整理本月经历与下一步计划', view: 'reflection' as const }

  return <section className="overview-page" aria-label="个人智能中枢总览">
    <div className="overview-command">
      <div className="command-intro"><p className="eyebrow">PERSONAL INTELLIGENCE WORKSPACE</p><h2>你的个人智能中枢</h2><p>查看真实状态，继续当前最重要的任务。所有数据留在本机并由你确认。</p></div>
      <button className="next-action" onClick={() => onNavigate(next.view)}><span><small>RECOMMENDED NEXT STEP</small><strong>{next.label}</strong><em>{next.detail}</em></span><ArrowRight size={22} /></button>
      <div className="core-metrics" aria-label="核心指标">
        <article><strong>{memory.confirmedMemories}</strong><span>确认记忆</span></article>
        <article><strong>{clients.total}</strong><span>已连接 AI</span></article>
        <article><strong>{pending}</strong><span>待处理</span></article>
      </div>
    </div>

    <div className="overview-body"><div className="overview-modules" aria-label="功能模块">
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
      <button className="overview-module" onClick={() => onNavigate('onboarding')}><span className="module-icon"><ChatCircle size={26} /></span><div><p className="eyebrow">ONBOARDING</p><h3>对话建档</h3><p>明确提交的回答将进入候选审核</p></div></button>
    </div>

    <div className="overview-recent" aria-label="最近访问明细"><h3>最近活动</h3>{recentAccess.length > 0 ? <ul>{recentAccess.slice(0, 4).map((event) => <li key={event.eventId}><span className={event.result}>{event.result}</span><strong>{event.clientId}</strong><em>{event.eventType}</em><time>{displayTime(event.timestamp)}</time></li>)}</ul> : <div className="overview-empty"><Clock size={24} /><p>尚无 AI 访问记录</p></div>}</div></div>
  </section>
}
