import { useEffect, useMemo, useState } from 'react'
import type { ApiClient, GrowthAssessment, GrowthAssociation, GrowthDimensionContent, GrowthDimensionKey, GrowthDimensions, GrowthGoal, GrowthTimeline } from './api'

const DIMENSION_KEYS: GrowthDimensionKey[] = ['mind', 'body', 'spirit', 'vocation']
const HORIZONS: GrowthGoal['horizon'][] = ['long-term', 'quarterly', 'monthly']
const RELATION_TYPES: GrowthAssociation['relationType'][] = ['correlation', 'causation']

type Tab = 'overview' | 'dimensions' | 'assessment' | 'timeline' | 'map' | 'goals'
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Growth Overview' },
  { key: 'dimensions', label: 'Four Dimensions' },
  { key: 'assessment', label: 'Growth Assessment' },
  { key: 'timeline', label: 'Evolution Timeline' },
  { key: 'map', label: 'Cross-Dimension Map' },
  { key: 'goals', label: 'Goals & Actions' },
]

const emptyDimension = (): GrowthDimensionContent => ({ current: '', evidence: '', challenges: '', direction: '' })

export default function GrowthDashboard({ client }: { client: ApiClient }) {
  const [tab, setTab] = useState<Tab>('overview')
  const [dimensions, setDimensions] = useState<GrowthDimensions | null>(null)
  const [assessments, setAssessments] = useState<GrowthAssessment[]>([])
  const [timeline, setTimeline] = useState<GrowthTimeline | null>(null)
  const [associations, setAssociations] = useState<GrowthAssociation[]>([])
  const [goals, setGoals] = useState<GrowthGoal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    Promise.all([
      client.growthDimensions(),
      client.growthAssessments(),
      client.growthTimeline(),
      client.growthAssociations(),
      client.growthGoals(),
    ]).then(([dim, ov, tl, assoc, gl]) => {
      if (cancelled) return
      setDimensions(dim); setAssessments(ov.assessments); setTimeline(tl); setAssociations(assoc); setGoals(gl)
    }).catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : '加载失败。') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [client])

  const stats = useMemo(() => ({
    assessments: assessments.length,
    confirmed: assessments.filter((a) => a.status === 'confirmed').length,
    goals: goals.length,
    goalDone: goals.filter((g) => g.completed).length,
    associations: associations.length,
    months: timeline?.months.length ?? 0,
  }), [assessments, goals, associations, timeline])

  if (loading) return <div className="skeletons" aria-label="加载中"><i /><i /><i /></div>
  if (error) return <div className="profile-empty"><h3>无法加载成长数据</h3><p>{error}</p></div>

  return <section className="growth-dashboard" aria-label="Human 3.0 成长仪表盘">
    <header className="growth-head">
      <div><p className="eyebrow">HUMAN 3.0 / GROWTH</p><h2>Personal Growth Intelligence</h2><p>四维记录、观察、分析与规划你的长期变化。所有分析都基于真实数据，不推断成长分数。</p></div>
      <div className="growth-stats" aria-label="成长概览统计">
        <article><span>Assessments</span><strong>{stats.confirmed}/{stats.assessments}</strong></article>
        <article><span>Goals</span><strong>{stats.goalDone}/{stats.goals}</strong></article>
        <article><span>Associations</span><strong>{stats.associations}</strong></article>
      </div>
    </header>

    <div className="growth-tabs" role="tablist" aria-label="成长视图">
      {TABS.map((item) => <button key={item.key} role="tab" aria-selected={tab === item.key} className={tab === item.key ? 'active' : ''} onClick={() => setTab(item.key)}>{item.label}</button>)}
    </div>

    {tab === 'overview' && <OverviewPane timeline={timeline} dimensions={dimensions} />}
    {tab === 'dimensions' && <DimensionsPane dimensions={dimensions} />}
    {tab === 'assessment' && <AssessmentPane client={client} assessments={assessments} setAssessments={setAssessments} />}
    {tab === 'timeline' && <TimelinePane timeline={timeline} />}
    {tab === 'map' && <MapPane client={client} associations={associations} setAssociations={setAssociations} />}
    {tab === 'goals' && <GoalsPane client={client} goals={goals} setGoals={setGoals} />}
  </section>
}

function OverviewPane({ timeline, dimensions }: { timeline: GrowthTimeline | null; dimensions: GrowthDimensions | null }) {
  const months = timeline?.months ?? []
  const latest = months[months.length - 1]
  return <div className="growth-pane">
    <p className="growth-disclaimer">{dimensions?.disclaimer ?? 'Human 3.0 仅用于自我反思。'}</p>
    {latest ? <div className="overview-latest">
      <p className="eyebrow">LATEST MONTH</p><h3>{latest.month}</h3>
      <p>成长自评 {latest.assessment ? '已记录' : '未记录'} · Human 3.0 {latest.human3 ? '已记录' : '未记录'} · 月度复盘 {latest.monthly ? '已记录' : '未记录'}</p>
    </div> : <p className="muted">还没有任何已确认的成长记录。先从「月度复盘」或「成长自评」开始。</p>}
  </div>
}

function DimensionsPane({ dimensions }: { dimensions: GrowthDimensions | null }) {
  const list = dimensions?.dimensions ?? []
  return <div className="growth-pane"><div className="dimension-grid">
    {list.map((dim) => <article key={dim.key} className="dimension-card">
      <header><h3>{dim.title}</h3><span>{dim.subtitle}</span></header>
      <ul className="dimension-areas">{dim.areas.map((area) => <li key={area}>{area}</li>)}</ul>
      {dim.score !== null && <p className="dimension-score">最近自评 <strong>{dim.score}</strong></p>}
      {dim.monthlyText ? <p className="dimension-monthly">{dim.monthlyText}</p> : <p className="muted">暂无月度内容</p>}
    </article>)}
  </div></div>
}

function TimelinePane({ timeline }: { timeline: GrowthTimeline | null }) {
  const months = timeline?.months ?? []
  if (months.length === 0) return <div className="growth-pane"><p className="muted">还没有成长时间线数据。</p></div>
  return <div className="growth-pane"><div className="timeline-list">
    {months.map((point) => <article key={point.month} className="timeline-point">
      <header><h3>{point.month}</h3></header>
      {point.assessment && <p><span className="tl-label">成长自评</span>{point.assessment.level ? ` Level ${point.assessment.level}` : ''} · 完成 {point.assessment.completedDimensions}/4 维</p>}
      {point.human3 && <p><span className="tl-label">Human 3.0</span>{DIMENSION_KEYS.map((k) => `${k.toUpperCase()} ${point.human3!.scores[k] ?? '-'}`).join(' · ')}</p>}
      {point.monthly && <p><span className="tl-label">月度复盘</span>{point.monthly.events.length} 个事件 · {point.monthly.goals.length} 个目标</p>}
    </article>)}
  </div></div>
}

function MapPane({ client, associations, setAssociations }: { client: ApiClient; associations: GrowthAssociation[]; setAssociations: (value: GrowthAssociation[]) => void }) {
  const [from, setFrom] = useState<GrowthDimensionKey>('mind')
  const [to, setTo] = useState<GrowthDimensionKey>('body')
  const [type, setType] = useState<GrowthAssociation['relationType']>('correlation')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  async function add() {
    if (type === 'causation' && !note.trim()) { setError('因果关联必须填写说明。'); return }
    setError('')
    try {
      const record = await client.addGrowthAssociation({ from_dimension: from, from_event_id: '', to_dimension: to, to_event_id: '', relation_type: type, note: note.trim() })
      setAssociations([...associations, record]); setNote('')
    } catch (err) { setError(err instanceof Error ? err.message : '添加失败。') }
  }
  async function remove(id: string) {
    await client.deleteGrowthAssociation(id)
    setAssociations(associations.filter((a) => a.id !== id))
  }

  return <div className="growth-pane">
    <div className="assoc-form">
      <label>从 <select aria-label="起点维度" value={from} onChange={(e) => setFrom(e.target.value as GrowthDimensionKey)}>{DIMENSION_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
      <label>到 <select aria-label="终点维度" value={to} onChange={(e) => setTo(e.target.value as GrowthDimensionKey)}>{DIMENSION_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
      <label>类型 <select aria-label="关联类型" value={type} onChange={(e) => setType(e.target.value as GrowthAssociation['relationType'])}>{RELATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
      <input aria-label="关联说明" placeholder="关联说明（因果必填）" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="primary-action" onClick={() => void add()}>添加关联</button>
    </div>
    {error && <p className="field-error" role="alert">{error}</p>}
    {associations.length === 0 ? <p className="muted">还没有跨维关联。</p> : <ul className="assoc-list">
      {associations.map((a) => <li key={a.id}><span className={`assoc-type ${a.relationType}`}>{a.relationType}</span>{a.fromDimension.toUpperCase()} → {a.toDimension.toUpperCase()}{a.note && <em>：{a.note}</em>}<button className="text-button danger-link" onClick={() => void remove(a.id)}>删除</button></li>)}
    </ul>}
  </div>
}

function GoalsPane({ client, goals, setGoals }: { client: ApiClient; goals: GrowthGoal[]; setGoals: (value: GrowthGoal[]) => void }) {
  const [horizon, setHorizon] = useState<GrowthGoal['horizon']>('monthly')
  const [title, setTitle] = useState('')
  const [action, setAction] = useState('')
  const [priority, setPriority] = useState<GrowthGoal['priority']>('medium')
  const [due, setDue] = useState('')
  const [error, setError] = useState('')

  async function add() {
    if (!title.trim()) { setError('目标标题不能为空。'); return }
    setError('')
    try {
      const record = await client.addGrowthGoal({ horizon, title: title.trim(), action: action.trim(), priority, due, previous_goal_id: '' })
      setGoals([...goals, record]); setTitle(''); setAction(''); setDue('')
    } catch (err) { setError(err instanceof Error ? err.message : '添加失败。') }
  }
  async function toggle(goal: GrowthGoal) {
    const record = await client.updateGrowthGoal(goal.id, { title: goal.title, action: goal.action, priority: goal.priority, due: goal.due, completed: !goal.completed, previous_goal_id: goal.previousGoalId })
    setGoals(goals.map((g) => (g.id === goal.id ? record : g)))
  }
  async function remove(id: string) {
    await client.deleteGrowthGoal(id)
    setGoals(goals.filter((g) => g.id !== id))
  }

  const visible = goals.filter((g) => g.horizon === horizon)

  return <div className="growth-pane">
    <div className="goal-form">
      <select aria-label="目标层级" value={horizon} onChange={(e) => setHorizon(e.target.value as GrowthGoal['horizon'])}>{HORIZONS.map((h) => <option key={h} value={h}>{h}</option>)}</select>
      <input aria-label="目标标题" placeholder="目标" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input aria-label="具体行动" placeholder="具体行动" value={action} onChange={(e) => setAction(e.target.value)} />
      <select aria-label="优先级" value={priority} onChange={(e) => setPriority(e.target.value as GrowthGoal['priority'])}><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></select>
      <input aria-label="截止日期" placeholder="截止 YYYY-MM-DD" value={due} onChange={(e) => setDue(e.target.value)} />
      <button className="primary-action" onClick={() => void add()}>添加目标</button>
    </div>
    {error && <p className="field-error" role="alert">{error}</p>}
    <div className="goal-list">
      {visible.length === 0 ? <p className="muted">当前层级没有目标。</p> : visible.map((g) => <article key={g.id} className={`goal-item ${g.completed ? 'done' : ''}`}>
        <button className="goal-check" aria-label={g.completed ? '标记未完成' : '标记完成'} onClick={() => void toggle(g)}>{g.completed ? '✓' : '○'}</button>
        <div><strong>{g.title}</strong>{g.action && <p>{g.action}</p>}</div>
        <span className="goal-meta">{g.priority}{g.due ? ` · ${g.due}` : ''}</span>
        <button className="text-button danger-link" onClick={() => void remove(g.id)}>删除</button>
      </article>)}
    </div>
  </div>
}

function AssessmentPane({ client, assessments, setAssessments }: { client: ApiClient; assessments: GrowthAssessment[]; setAssessments: (value: GrowthAssessment[]) => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [month, setMonth] = useState('')
  const [draft, setDraft] = useState<Record<GrowthDimensionKey, GrowthDimensionContent>>({ mind: emptyDimension(), body: emptyDimension(), spirit: emptyDimension(), vocation: emptyDimension() })
  const [level, setLevel] = useState('')
  const [error, setError] = useState('')

  const selected = assessments.find((a) => a.id === selectedId) ?? null

  function select(assessment: GrowthAssessment) {
    setSelectedId(assessment.id)
    setDraft(assessment.dimensions)
    setLevel(assessment.level)
  }
  async function create() {
    if (!month) { setError('请输入月份 YYYY-MM。'); return }
    setError('')
    try {
      const record = await client.createGrowthAssessment(month)
      setAssessments([...assessments, record]); select(record); setMonth('')
    } catch (err) { setError(err instanceof Error ? err.message : '创建失败。') }
  }
  async function saveDimension(key: GrowthDimensionKey) {
    if (!selected) return
    try {
      const record = await client.saveGrowthDimension(selected.id, key, draft[key], selected.revision)
      setAssessments(assessments.map((a) => (a.id === selected.id ? record : a))); setDraft(record.dimensions); setSelectedId(record.id); setLevel(record.level)
    } catch (err) { setError(err instanceof Error ? err.message : '保存失败。') }
  }
  async function saveLevel() {
    if (!selected) return
    try {
      const record = await client.saveGrowthLevel(selected.id, level, selected.revision)
      setAssessments(assessments.map((a) => (a.id === selected.id ? record : a))); setLevel(record.level); setSelectedId(record.id)
    } catch (err) { setError(err instanceof Error ? err.message : '保存失败。') }
  }
  async function confirm() {
    if (!selected) return
    try {
      const record = await client.confirmGrowthAssessment(selected.id, selected.revision)
      setAssessments(assessments.map((a) => (a.id === selected.id ? record : a))); setSelectedId(record.id)
    } catch (err) { setError(err instanceof Error ? err.message : '确认失败。') }
  }
  async function remove(id: string) {
    await client.deleteGrowthAssessment(id)
    setAssessments(assessments.filter((a) => a.id !== id)); if (selectedId === id) setSelectedId(null)
  }

  return <div className="growth-pane assessment-pane">
    <div className="assess-create"><input aria-label="新建自评月份" placeholder="月份 YYYY-MM" value={month} onChange={(e) => setMonth(e.target.value)} /><button className="primary-action" onClick={() => void create()}>新建自评</button></div>
    {error && <p className="field-error" role="alert">{error}</p>}
    {assessments.length === 0 ? <p className="muted">还没有成长自评。</p> : <div className="assess-layout">
      <aside className="assess-list" aria-label="成长自评列表">
        {assessments.map((a) => <button key={a.id} className={a.id === selectedId ? 'selected' : ''} onClick={() => select(a)}><span>{a.month}</span><strong>{a.status}</strong><em>{a.completedDimensions}/4 维{a.level ? ` · L${a.level}` : ''}</em></button>)}
      </aside>
      {selected && <section className="assess-editor" aria-label="自评编辑">
        <header><h3>{selected.month}</h3><span className="status">{selected.status}</span></header>
        {DIMENSION_KEYS.map((key) => <fieldset key={key} className="assess-dim">
          <legend>{key.toUpperCase()}</legend>
          <label>当前状态<textarea value={draft[key].current} onChange={(e) => setDraft({ ...draft, [key]: { ...draft[key], current: e.target.value } })} /></label>
          <label>成长证据<textarea value={draft[key].evidence} onChange={(e) => setDraft({ ...draft, [key]: { ...draft[key], evidence: e.target.value } })} /></label>
          <label>困难与挑战<textarea value={draft[key].challenges} onChange={(e) => setDraft({ ...draft, [key]: { ...draft[key], challenges: e.target.value } })} /></label>
          <label>未来方向<textarea value={draft[key].direction} onChange={(e) => setDraft({ ...draft, [key]: { ...draft[key], direction: e.target.value } })} /></label>
          <button className="secondary" onClick={() => void saveDimension(key)}>保存 {key.toUpperCase()}</button>
        </fieldset>)}
        <div className="assess-level"><label>参考层级（自选）<select aria-label="参考层级" value={level} onChange={(e) => setLevel(e.target.value)}><option value="">未选择</option><option value="1.0">1.0</option><option value="2.0">2.0</option><option value="3.0">3.0</option></select></label><button className="secondary" onClick={() => void saveLevel()}>保存层级</button></div>
        <footer className="assess-actions"><p>写操作通过 Core 执行并校验 Revision。</p><div><button className="danger" onClick={() => void remove(selected.id)}>删除</button>{selected.status === 'draft' && <button className="confirm" onClick={() => void confirm()} disabled={!selected.readyToConfirm}>确认自评</button>}</div></footer>
      </section>}
    </div>}
  </div>
}
