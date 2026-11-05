import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { ArrowRight, Archive, Brain, CalendarDots, CheckCircle, Clock, Lightning, Plus, Sparkle, Trash, UserCircle } from '@phosphor-icons/react'
import type { MonthlyOverview, MonthlyReflection, ReflectionDimension, ReflectionEvent, ReflectionGoal } from './api'
import { ErrorState, LoadingState } from './components/StateBlocks'

const dimensions: { key: ReflectionDimension; label: string; short: string; prompts: string[] }[] = [
  { key: 'mind', label: 'MIND — 认知与思维', short: 'MIND', prompts: ['本月学习了什么？', '哪些认知或思维方式发生了变化？', '困难与最重要的收获是什么？'] },
  { key: 'body', label: 'BODY — 身体与精力', short: 'BODY', prompts: ['睡眠、休息与运动情况如何？', '精力和生活习惯有哪些变化？', '下个月希望改善什么？'] },
  { key: 'spirit', label: 'SPIRIT — 意义与关系', short: 'SPIRIT', prompts: ['有哪些重要关系或个人感受？', '什么事件带来了意义？', '哪些关系希望改善？'] },
  { key: 'vocation', label: 'VOCATION — 工作与创造', short: 'VOCATION', prompts: ['完成了哪些项目或创造性成果？', '职业与学习有哪些进展或困难？', '下一阶段目标是什么？'] },
]

type Props = {
  overview: MonthlyOverview | null
  selected: MonthlyReflection | null
  loading: boolean
  saving: boolean
  onSelect: (value: MonthlyReflection) => void
  onCreate: (month: string) => Promise<boolean>
  onDimension: (dimension: ReflectionDimension, content: string) => Promise<boolean>
  onAddEvent: (event: Omit<ReflectionEvent, 'id'>) => Promise<boolean>
  onDeleteEvent: (eventId: string) => Promise<boolean>
  onGoals: (goals: ReflectionGoal[]) => Promise<boolean>
  onGenerateSummary: () => Promise<boolean>
  onSummary: (summary: string) => Promise<boolean>
  onConfirm: () => Promise<boolean>
}

export default function MonthlyReflectionPage(props: Props) {
  const { overview, selected, loading, saving } = props
  const [section, setSection] = useState<'overview' | ReflectionDimension | 'events' | 'summary' | 'goals'>('overview')
  const [dimensionDraft, setDimensionDraft] = useState('')
  const [summaryDraft, setSummaryDraft] = useState('')
  const [event, setEvent] = useState({ title: '', date: '', dimension: 'mind' as ReflectionDimension, description: '', feeling: '', project: '' })
  const [goals, setGoals] = useState<ReflectionGoal[]>([])
  useEffect(() => { setSummaryDraft(selected?.summary ?? ''); setGoals(selected?.goals ?? []) }, [selected])
  const current = useMemo(() => overview?.reflections.find((item) => item.month === overview.currentMonth), [overview])
  const recent = useMemo(() => {
    if (!overview) return []
    const sorted = [...overview.reflections].sort((a, b) => b.month.localeCompare(a.month))
    return sorted.slice(0, 3)
  }, [overview])
  const archived = useMemo(() => {
    if (!overview) return []
    const sorted = [...overview.reflections].sort((a, b) => b.month.localeCompare(a.month))
    return sorted.slice(3)
  }, [overview])
  if (loading) return <LoadingState label="正在读取本地月度复盘…" />
  if (!overview) return <ErrorState title="月度复盘暂时不可用" description="本地服务没有返回复盘数据，请确认服务仍在运行后重试。" />

  async function addEvent() {
    if (await props.onAddEvent(event)) setEvent({ title: '', date: '', dimension: 'mind', description: '', feeling: '', project: '' })
  }
  function addGoal() { setGoals((items) => [...items, { id: `goal-${crypto.randomUUID().slice(0, 8)}`, title: '', action: '', priority: 'medium', due: '', completed: false, previousGoalId: '' }]) }

  return <section className="monthly-page">
    <header className="monthly-heading compact-heading"><div><p className="eyebrow">MONTHLY REFLECTION / LOCAL INTELLIGENCE</p><p>以真实经历完成本月复盘，摘要、修改和正式确认始终由你控制。</p></div>{selected && <div className={`reflection-status ${selected.status}`}><i /><span><small>{selected.month}</small><strong>{selected.status === 'confirmed' ? '正式复盘' : '本地草稿'}</strong></span></div>}</header>
    <section className="monthly-command" aria-label="本月复盘任务"><div><small>CURRENT MONTH</small><strong>{overview.currentMonth}</strong><span>{current ? `${current.completedDimensions}/4 个维度已完成` : '尚未创建本月复盘'}</span></div><progress max="4" value={current?.completedDimensions ?? 0} aria-label="复盘完成进度" /><button className="primary-action" onClick={() => void props.onCreate(overview.currentMonth)} disabled={saving || Boolean(current)}>{current ? '本月复盘已创建' : <><Plus />创建本月复盘</>}</button></section>
    <div className="monthly-layout">
      <aside className="month-archive"><div className="archive-title"><p className="eyebrow">REFLECTION ARCHIVE</p><h3>月份</h3></div>{!current && <button className="create-month" onClick={() => void props.onCreate(overview.currentMonth)} disabled={saving}><Plus />创建 {overview.currentMonth} 复盘</button>}<div className="month-list">{recent.map((item) => <button key={item.id} className={item.id === selected?.id ? 'active' : ''} onClick={() => { props.onSelect(item); setSection('overview') }}><CalendarDots /><span><strong>{item.month}</strong><small>{item.status === 'confirmed' ? '已确认' : `${item.completedDimensions}/4 维度`}</small></span><i /></button>)}</div>{recent.length === 0 && <div className="archive-empty">还没有月度复盘。创建后，草稿会持久保存在本地 Vault。</div>}{archived.length > 0 && <details className="archive-history"><summary><Archive size={15} />更早的复盘（{archived.length}）</summary><div className="month-list">{archived.map((item) => <button key={item.id} className={item.id === selected?.id ? 'active' : ''} onClick={() => { props.onSelect(item); setSection('overview') }}><CalendarDots /><span><strong>{item.month}</strong><small>{item.status === 'confirmed' ? '已确认' : `${item.completedDimensions}/4 维度`}</small></span><i /></button>)}</div></details>}</aside>
      <main className="reflection-console">
        {!selected ? <div className="reflection-welcome"><span><CalendarDots size={34} /></span><p className="eyebrow">START A PRIVATE REVIEW</p><h3>回顾 {overview.currentMonth}</h3><p>创建一份本地草稿，再按自己的节奏填写。未确认内容不会成为正式复盘。</p><button className="primary-action" onClick={() => void props.onCreate(overview.currentMonth)} disabled={saving || Boolean(current)}>创建本月复盘 <ArrowRight /></button></div> : <>
<nav className="reflection-nav" aria-label="复盘内容"><button disabled={saving} className={section === 'overview' ? 'active' : ''} onClick={() => setSection('overview')}>Overview</button>{dimensions.map((item) => <button disabled={saving} key={item.key} className={section === item.key ? 'active' : ''} onClick={() => { setDimensionDraft(selected.dimensions[item.key]); setSection(item.key) }}>{item.short}<i className={selected.dimensions[item.key] ? 'done' : ''} /></button>)}<button disabled={saving} className={section === 'events' ? 'active' : ''} onClick={() => setSection('events')}>Events</button><button disabled={saving} className={section === 'summary' ? 'active' : ''} onClick={() => { setSummaryDraft(selected.summary); setSection('summary') }}>Summary</button><button disabled={saving} className={section === 'goals' ? 'active' : ''} onClick={() => { setGoals(selected.goals); setSection('goals') }}>Goals</button></nav>
          {section === 'overview' && <Overview reflection={selected} onSection={setSection} onConfirm={props.onConfirm} saving={saving} />}
          {dimensions.some((item) => item.key === section) && <section className="dimension-editor">{(() => { const item = dimensions.find((entry) => entry.key === section)!; return <><header><div><p className="eyebrow">DIMENSION / {item.short}</p><h3>{item.label}</h3></div><span>{selected.dimensions[item.key] ? '已保存' : '待填写'}</span></header><div className="prompt-grid">{item.prompts.map((prompt) => <p key={prompt}>{prompt}</p>)}</div><label>本月记录<textarea aria-label={`${item.short} 复盘内容`} value={dimensionDraft} onChange={(e) => setDimensionDraft(e.target.value)} maxLength={5000} placeholder="记录真实经历、观察与自己的判断…" /></label><footer><span>{dimensionDraft.length} / 5000 · 手动保存</span><button className="primary-action" onClick={() => void props.onDimension(item.key, dimensionDraft)} disabled={saving || dimensionDraft === selected.dimensions[item.key]}>保存 {item.short}</button></footer></> })()}</section>}
          {section === 'events' && <section className="events-editor"><header><p className="eyebrow">IMPORTANT EVENTS</p><h3>重要事件</h3><p>记录真实发生的节点；系统不会从内容推断情绪或心理状态。</p></header><div className="event-form"><label>事件标题<input aria-label="事件标题" value={event.title} onChange={(e) => setEvent({ ...event, title: e.target.value })} /></label><label>日期<input aria-label="事件日期" type="date" value={event.date} onChange={(e) => setEvent({ ...event, date: e.target.value })} /></label><label>所属维度<select aria-label="事件所属维度" value={event.dimension} onChange={(e) => setEvent({ ...event, dimension: e.target.value as ReflectionDimension })}>{dimensions.map((d) => <option key={d.key} value={d.key}>{d.short}</option>)}</select></label><label className="wide">事件描述<textarea aria-label="事件描述" value={event.description} onChange={(e) => setEvent({ ...event, description: e.target.value })} /></label><label>个人感受<input aria-label="个人感受" value={event.feeling} onChange={(e) => setEvent({ ...event, feeling: e.target.value })} /></label><label>关联项目（可选）<input aria-label="关联项目" value={event.project} onChange={(e) => setEvent({ ...event, project: e.target.value })} /></label><button className="primary-action" onClick={() => void addEvent()} disabled={saving || !event.title || !event.date}>添加事件</button></div><div className="event-list">{selected.events.map((item) => <article key={item.id}><span>{item.date}</span><div><strong>{item.title}</strong><p>{item.description || '无描述'}</p><small>{item.dimension.toUpperCase()}{item.project ? ` · ${item.project}` : ''}{item.feeling ? ` · ${item.feeling}` : ''}</small></div><button aria-label={`删除事件 ${item.title}`} onClick={() => void props.onDeleteEvent(item.id)}><Trash /></button></article>)}{selected.events.length === 0 && <p className="muted">还没有重要事件。</p>}</div></section>}
          {section === 'summary' && <section className="summary-editor"><header><div><p className="eyebrow">LOCAL REFLECTION ASSISTANT</p><h3>AI Reflection Summary</h3><p>当前项目没有外部 AI Provider。此功能在本地从你填写的维度中提取首个事实片段生成草稿，不上传数据、不补写事件。</p></div><button className="secondary-action" onClick={() => void props.onGenerateSummary()} disabled={saving || selected.completedDimensions === 0}><Sparkle />本地整理摘要</button></header><label>可编辑摘要<textarea aria-label="复盘摘要" value={summaryDraft} onChange={(e) => setSummaryDraft(e.target.value)} maxLength={2400} placeholder="先填写维度，或直接写下自己的总结…" /></label><footer><span>来源：{selected.summarySource || '尚未生成'}</span><button className="primary-action" onClick={() => void props.onSummary(summaryDraft)} disabled={saving || !summaryDraft.trim() || summaryDraft === selected.summary}>保存摘要修改</button></footer></section>}
          {section === 'goals' && <section className="goals-editor"><header><div><p className="eyebrow">NEXT MONTH GOALS</p><h3>下月目标与行动</h3></div><button className="secondary-action" onClick={addGoal}><Plus />添加目标</button></header><div className="goal-list">{goals.map((goal, index) => <article key={goal.id}><label className="goal-check"><input type="checkbox" checked={goal.completed} onChange={(e) => setGoals(goals.map((item, i) => i === index ? { ...item, completed: e.target.checked } : item))} /><span>已完成</span></label><label>目标<input aria-label={`目标 ${index + 1}`} value={goal.title} onChange={(e) => setGoals(goals.map((item, i) => i === index ? { ...item, title: e.target.value } : item))} /></label><label>具体行动<input value={goal.action} onChange={(e) => setGoals(goals.map((item, i) => i === index ? { ...item, action: e.target.value } : item))} /></label><label>优先级<select value={goal.priority} onChange={(e) => setGoals(goals.map((item, i) => i === index ? { ...item, priority: e.target.value as ReflectionGoal['priority'] } : item))}><option value="high">高</option><option value="medium">中</option><option value="low">低</option></select></label><label>预期完成<input type="date" value={goal.due} onChange={(e) => setGoals(goals.map((item, i) => i === index ? { ...item, due: e.target.value } : item))} /></label><button aria-label={`删除目标 ${index + 1}`} onClick={() => setGoals(goals.filter((_, i) => i !== index))}><Trash /></button></article>)}</div>{goals.length === 0 && <div className="goal-empty">还没有下月目标。目标由你设定，不会根据复盘内容自动生成。</div>}<footer><button className="primary-action" onClick={() => void props.onGoals(goals)} disabled={saving || goals.some((goal) => !goal.title.trim())}>保存目标</button></footer></section>}
        </>}
      </main>
    </div>
  </section>
}

function Overview({ reflection, onSection, onConfirm, saving }: { reflection: MonthlyReflection; onSection: (value: 'overview' | ReflectionDimension | 'events' | 'summary' | 'goals') => void; onConfirm: () => Promise<boolean>; saving: boolean }) {
  const percent = Math.round((reflection.completedDimensions / 4) * 100)
  return <section className="monthly-overview"><div className="month-hero"><div className="month-ring" style={{ '--month-progress': `${percent * 3.6}deg` } as CSSProperties}><span><strong>{percent}%</strong><small>DIMENSIONS</small></span></div><div><p className="eyebrow">{reflection.month} / REFLECTION STATUS</p><h3>{reflection.status === 'confirmed' ? '这份复盘已正式确认' : '继续整理这个月'}</h3><p>{reflection.status === 'confirmed' ? '历史内容仍可查看；修改任何内容都会重新进入草稿并要求再次确认。' : '每次保存都会写入本地 Vault，刷新页面不会丢失。'}</p></div></div><div className="dimension-cards">{dimensions.map((item) => <button key={item.key} onClick={() => onSection(item.key)}><span>{reflection.dimensions[item.key] ? <CheckCircle /> : <Clock />}</span><small>{item.short}</small><strong>{reflection.dimensions[item.key] ? '已保存' : '待填写'}</strong><ArrowRight /></button>)}</div><div className="reflection-metrics"><article><UserCircle /><span><strong>{reflection.events.length}</strong><small>重要事件</small></span></article><article><Lightning /><span><strong>{reflection.goals.length}</strong><small>下月目标</small></span></article><article><Brain /><span><strong>{reflection.summary ? 'READY' : 'EMPTY'}</strong><small>摘要状态</small></span></article></div><div className="confirmation-panel"><div><p className="eyebrow">EXPLICIT CONFIRMATION</p><h3>由你决定何时完成</h3><p>四个维度和可编辑摘要完成后，才能保存为正式月度复盘。不会自动评分或生成成长标签。</p></div><button className="primary-action" onClick={() => void onConfirm()} disabled={saving || !reflection.readyToConfirm || reflection.status === 'confirmed'}>确认正式复盘</button></div></section>
}
