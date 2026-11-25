import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { ArrowRight, Archive, Brain, CalendarDots, CheckCircle, Clock, Lightning, Plus, Sparkle, Trash, UserCircle, Warning } from '@phosphor-icons/react'
import type { MonthlyOverview, MonthlyReflection, ReflectionDimension, ReflectionEvent, ReflectionGoal } from './api'
import { ErrorState, LoadingState } from './components/StateBlocks'
import { formatDate, getLanguage, useT } from './i18n'
import { clearReflectionDraft, readReflectionDraft, writeReflectionDraft, type ReflectionDraft } from './reflectionDraft'

const DIMENSION_KEYS: ReflectionDimension[] = ['mind', 'body', 'spirit', 'vocation']

function dimensions(t: (key: string) => string): { key: ReflectionDimension; label: string; short: string; prompts: string[] }[] {
  return [
    { key: 'mind', label: t('monthly.dimension.mind.label'), short: t('monthly.dimension.mind.short'), prompts: [t('monthly.dimension.mind.prompt1'), t('monthly.dimension.mind.prompt2'), t('monthly.dimension.mind.prompt3')] },
    { key: 'body', label: t('monthly.dimension.body.label'), short: t('monthly.dimension.body.short'), prompts: [t('monthly.dimension.body.prompt1'), t('monthly.dimension.body.prompt2'), t('monthly.dimension.body.prompt3')] },
    { key: 'spirit', label: t('monthly.dimension.spirit.label'), short: t('monthly.dimension.spirit.short'), prompts: [t('monthly.dimension.spirit.prompt1'), t('monthly.dimension.spirit.prompt2'), t('monthly.dimension.spirit.prompt3')] },
    { key: 'vocation', label: t('monthly.dimension.vocation.label'), short: t('monthly.dimension.vocation.short'), prompts: [t('monthly.dimension.vocation.prompt1'), t('monthly.dimension.vocation.prompt2'), t('monthly.dimension.vocation.prompt3')] },
  ]
}

type Section = 'overview' | ReflectionDimension | 'events' | 'summary' | 'goals'

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
  /** 上报是否存在未保存内容，供外壳在应用内导航前提醒。 */
  onDirtyChange?: (dirty: boolean) => void
  /** 最近一次保存是否因 revision 冲突被拒绝。 */
  conflict?: boolean
  onConflictDismiss?: () => void
  /** 丢弃本地草稿并重新拉取服务器版本。 */
  onReloadServer?: () => void
}

/**
 * 长文本编辑流程的未保存保护（issue #65）：
 * - 编辑即写入本机草稿，刷新/异常退出后可恢复或丢弃；
 * - 应用内导航、刷新、关闭前提醒；
 * - 保存成功才清除草稿；
 * - revision 冲突时提示并允许丢弃本地、回到服务器版本，绝不静默覆盖。
 */
export default function MonthlyReflectionPage(props: Props) {
  const t = useT()
  const { overview, selected, loading, saving } = props
  const [section, setSection] = useState<Section>('overview')
  const [dimensionDrafts, setDimensionDrafts] = useState<Partial<Record<ReflectionDimension, string>>>({})
  const [summaryDraft, setSummaryDraft] = useState('')
  const [event, setEvent] = useState({ title: '', date: '', dimension: 'mind' as ReflectionDimension, description: '', feeling: '', project: '' })
  const [goals, setGoals] = useState<ReflectionGoal[]>([])
  const [draftOffer, setDraftOffer] = useState<ReflectionDraft | null>(null)
  const [draftRestored, setDraftRestored] = useState(false)
  const previousSelected = useRef<MonthlyReflection | null>(null)
  const list = dimensions(t)

  // 切换复盘时重置编辑器，并检查是否存在可恢复的本机草稿。
  useEffect(() => {
    setSummaryDraft(selected?.summary ?? '')
    setGoals(selected?.goals ?? [])
    setDimensionDrafts(selected?.dimensions ?? {})
    setEvent({ title: '', date: '', dimension: 'mind', description: '', feeling: '', project: '' })
    setDraftRestored(false)
    setDraftOffer(selected ? readReflectionDraft(selected.id) : null)
  }, [selected?.id])

  // Apply server acknowledgements only to buffers that the user has not changed
  // since the previous revision. This keeps unrelated edits while allowing a
  // generated summary or successful save to appear immediately.
  useEffect(() => {
    const previous = previousSelected.current
    if (selected && previous?.id === selected.id) {
      setDimensionDrafts((current) => DIMENSION_KEYS.reduce<Partial<Record<ReflectionDimension, string>>>((next, key) => {
        next[key] = (current[key] ?? '') === previous.dimensions[key] ? selected.dimensions[key] : current[key]
        return next
      }, {}))
      setSummaryDraft((current) => current === previous.summary ? selected.summary : current)
      setGoals((current) => JSON.stringify(current) === JSON.stringify(previous.goals) ? selected.goals : current)
    }
    previousSelected.current = selected
  }, [selected])

  const eventPending = Boolean(event.title || event.date || event.description || event.feeling || event.project)
  const dirty = selected !== null && (
    DIMENSION_KEYS.some((key) => (dimensionDrafts[key] ?? '') !== selected.dimensions[key])
    || summaryDraft !== selected.summary
    || JSON.stringify(goals) !== JSON.stringify(selected.goals)
    || eventPending
  )

  useEffect(() => { props.onDirtyChange?.(dirty) }, [dirty, props.onDirtyChange])

  // 刷新 / 关闭浏览器标签前提醒（应用内导航由外壳拦截）。
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  // 只在有未保存内容时写草稿；保存成功后整份清除。
  useEffect(() => {
    if (!selected || !dirty) return
    const previous = readReflectionDraft(selected.id)
    const next: ReflectionDraft = { version: 1, savedAt: new Date().toISOString(), source: 'local-draft', ...previous }
    next.dimensions = DIMENSION_KEYS.reduce<Partial<Record<ReflectionDimension, string>>>((result, key) => {
      if ((dimensionDrafts[key] ?? '') !== selected.dimensions[key]) result[key] = dimensionDrafts[key] ?? ''
      return result
    }, {})
    if (summaryDraft !== selected.summary) next.summary = summaryDraft; else delete next.summary
    if (JSON.stringify(goals) !== JSON.stringify(selected.goals)) next.goals = goals; else delete next.goals
    if (eventPending) next.event = event; else delete next.event
    writeReflectionDraft(selected.id, next)
  }, [selected, dirty, dimensionDrafts, summaryDraft, goals, event, eventPending])

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
  if (loading) return <LoadingState label={t('monthly.loading')} />
  if (!overview) return <ErrorState title={t('monthly.errorTitle')} description={t('monthly.errorDetail')} />

  function clearSavedFields(fields: Array<'summary' | 'goals' | 'event'>, dimension?: ReflectionDimension) {
    if (!selected) return
    const draft = readReflectionDraft(selected.id)
    if (!draft) return
    if (dimension && draft.dimensions) { delete draft.dimensions[dimension]; if (!Object.keys(draft.dimensions).length) delete draft.dimensions }
    for (const field of fields) delete draft[field]
    if (!draft.dimensions && draft.summary === undefined && !draft.goals && !draft.event) clearReflectionDraft(selected.id)
    else writeReflectionDraft(selected.id, { ...draft, savedAt: new Date().toISOString() })
  }
  async function addEvent() {
    if (await props.onAddEvent(event)) { clearSavedFields(['event']); setEvent({ title: '', date: '', dimension: 'mind', description: '', feeling: '', project: '' }) }
  }
  function addGoal() { setGoals((items) => [...items, { id: `goal-${crypto.randomUUID().slice(0, 8)}`, title: '', action: '', priority: 'medium', due: '', completed: false, previousGoalId: '' }]) }
  async function saveDimension(key: ReflectionDimension, content: string) {
    if (selected && await props.onDimension(key, content)) clearSavedFields([], key)
  }
  async function saveSummary(summary: string) {
    if (selected && await props.onSummary(summary)) clearSavedFields(['summary'])
  }
  async function saveGoals(items: ReflectionGoal[]) {
    if (selected && await props.onGoals(items)) clearSavedFields(['goals'])
  }
  function restoreDraft() {
    if (!selected || !draftOffer) return
    const draft = draftOffer
    if (draft.dimensions) { setDimensionDrafts((current) => ({ ...current, ...draft.dimensions })); const first = DIMENSION_KEYS.find((key) => draft.dimensions?.[key] !== undefined); if (first) setSection(first) }
    if (draft.summary !== undefined) { setSummaryDraft(draft.summary); setSection('summary') }
    if (draft.goals) { setGoals(draft.goals); setSection('goals') }
    if (draft.event) { setEvent(draft.event); setSection('events') }
    setDraftRestored(true)
    setDraftOffer(null)
  }
  function discardDraft() {
    if (selected) clearReflectionDraft(selected.id)
    setDraftOffer(null)
    setDraftRestored(false)
  }

  return <section className="monthly-page">
    <header className="monthly-heading compact-heading"><div><p className="eyebrow">MONTHLY REFLECTION / LOCAL INTELLIGENCE</p><p>{t('monthly.heading')}</p></div>{selected && <div className={`reflection-status ${selected.status}`}><i /><span><small>{selected.month}</small><strong>{selected.status === 'confirmed' ? t('monthly.formal') : t('monthly.draft')}</strong></span></div>}</header>

    {props.conflict && <div className="reflection-alert" role="alert">
      <Warning size={20} />
      <div><strong>{t('monthly.conflictTitle')}</strong><small>{t('monthly.conflictDetail')}</small></div>
      <button className="secondary-action" onClick={() => props.onReloadServer?.()}>{t('monthly.reloadServer')}</button>
      <button className="text-button" onClick={() => props.onConflictDismiss?.()}>{t('monthly.keepDraft')}</button>
    </div>}

    {draftOffer && <div className="draft-banner" role="status">
      <Clock size={18} />
      <div><strong>{t('monthly.draftTitle')}</strong><small>{t('monthly.draftDetail', { time: formatDate(getLanguage(), draftOffer.savedAt), source: t('monthly.draftSource') })}</small></div>
      <button className="secondary-action" onClick={restoreDraft}>{t('monthly.restoreDraft')}</button>
      <button className="text-button" onClick={discardDraft}>{t('monthly.discardDraft')}</button>
    </div>}
    {draftRestored && !draftOffer && <p className="draft-restored" role="status">{t('monthly.draftRestored')}</p>}

    <section className="monthly-command" aria-label={t('monthly.commandLabel')}><div><small>CURRENT MONTH</small><strong>{overview.currentMonth}</strong><span>{current ? t('monthly.dimensionsDone', { done: current.completedDimensions }) : t('monthly.notCreated')}</span></div><progress max="4" value={current?.completedDimensions ?? 0} aria-label={t('monthly.progressLabel')} /><button className="primary-action" onClick={() => void props.onCreate(overview.currentMonth)} disabled={saving || Boolean(current)}>{current ? t('monthly.created') : <><Plus />{t('monthly.create')}</>}</button></section>
    <div className="monthly-layout">
      <aside className="month-archive"><div className="archive-title"><p className="eyebrow">REFLECTION ARCHIVE</p><h3>{t('monthly.archiveTitle')}</h3></div>{!current && <button className="create-month" onClick={() => void props.onCreate(overview.currentMonth)} disabled={saving}><Plus />{t('monthly.createMonth', { month: overview.currentMonth })}</button>}<div className="month-list">{recent.map((item) => <button key={item.id} className={item.id === selected?.id ? 'active' : ''} onClick={() => { props.onSelect(item); setSection('overview') }}><CalendarDots /><span><strong>{item.month}</strong><small>{item.status === 'confirmed' ? t('monthly.confirmed') : t('monthly.dimensionsCount', { done: item.completedDimensions })}</small></span><i /></button>)}</div>{recent.length === 0 && <div className="archive-empty">{t('monthly.archiveEmpty')}</div>}{archived.length > 0 && <details className="archive-history"><summary><Archive size={15} />{t('monthly.olderTitle', { count: archived.length })}</summary><div className="month-list">{archived.map((item) => <button key={item.id} className={item.id === selected?.id ? 'active' : ''} onClick={() => { props.onSelect(item); setSection('overview') }}><CalendarDots /><span><strong>{item.month}</strong><small>{item.status === 'confirmed' ? t('monthly.confirmed') : t('monthly.dimensionsCount', { done: item.completedDimensions })}</small></span><i /></button>)}</div></details>}</aside>
      <main className="reflection-console">
        {!selected ? <div className="reflection-welcome"><span><CalendarDots size={34} /></span><p className="eyebrow">START A PRIVATE REVIEW</p><h3>{t('monthly.reviewTitle', { month: overview.currentMonth })}</h3><p>{t('monthly.reviewHint')}</p><button className="primary-action" onClick={() => void props.onCreate(overview.currentMonth)} disabled={saving || Boolean(current)}>{t('monthly.create')} <ArrowRight /></button></div> : <>
          <nav className="reflection-nav" aria-label={t('monthly.navLabel')}><button disabled={saving} className={section === 'overview' ? 'active' : ''} onClick={() => setSection('overview')}>Overview</button>{list.map((item) => <button disabled={saving} key={item.key} className={section === item.key ? 'active' : ''} onClick={() => setSection(item.key)}>{item.short}<i className={selected.dimensions[item.key] ? 'done' : ''} /></button>)}<button disabled={saving} className={section === 'events' ? 'active' : ''} onClick={() => setSection('events')}>Events</button><button disabled={saving} className={section === 'summary' ? 'active' : ''} onClick={() => setSection('summary')}>Summary</button><button disabled={saving} className={section === 'goals' ? 'active' : ''} onClick={() => setSection('goals')}>Goals</button></nav>
          {section === 'overview' && <Overview reflection={selected} onSection={setSection} onConfirm={props.onConfirm} saving={saving} />}
          {list.some((item) => item.key === section) && <section className="dimension-editor">{(() => { const item = list.find((entry) => entry.key === section)!; const value = dimensionDrafts[item.key] ?? ''; return <><header><div><p className="eyebrow">DIMENSION / {item.short}</p><h3>{item.label}</h3></div><span>{selected.dimensions[item.key] ? t('monthly.saved') : t('monthly.pending')}</span></header><div className="prompt-grid">{item.prompts.map((prompt) => <p key={prompt}>{prompt}</p>)}</div><label>{t('monthly.recordLabel')}<textarea aria-label={t('monthly.recordAria', { short: item.short })} value={value} onChange={(e) => setDimensionDrafts((current) => ({ ...current, [item.key]: e.target.value }))} maxLength={5000} placeholder={t('monthly.recordPlaceholder')} /></label><footer><span>{t('monthly.manualSave', { length: value.length })}</span><button className="primary-action" onClick={() => void saveDimension(item.key, value)} disabled={saving || value === selected.dimensions[item.key]}>{t('monthly.save', { short: item.short })}</button></footer></> })()}</section>}
          {section === 'events' && <section className="events-editor"><header><p className="eyebrow">IMPORTANT EVENTS</p><h3>{t('monthly.eventsTitle')}</h3><p>{t('monthly.eventsHint')}</p></header><div className="event-form"><label>{t('monthly.eventTitle')}<input aria-label={t('monthly.eventTitleAria')} value={event.title} onChange={(e) => setEvent({ ...event, title: e.target.value })} /></label><label>{t('monthly.eventDate')}<input aria-label={t('monthly.eventDateAria')} type="date" value={event.date} onChange={(e) => setEvent({ ...event, date: e.target.value })} /></label><label>{t('monthly.eventDimension')}<select aria-label={t('monthly.eventDimensionAria')} value={event.dimension} onChange={(e) => setEvent({ ...event, dimension: e.target.value as ReflectionDimension })}>{list.map((d) => <option key={d.key} value={d.key}>{d.short}</option>)}</select></label><label className="wide">{t('monthly.eventDescription')}<textarea aria-label={t('monthly.eventDescriptionAria')} value={event.description} onChange={(e) => setEvent({ ...event, description: e.target.value })} /></label><label>{t('monthly.eventFeeling')}<input aria-label={t('monthly.eventFeelingAria')} value={event.feeling} onChange={(e) => setEvent({ ...event, feeling: e.target.value })} /></label><label>{t('monthly.eventProject')}<input aria-label={t('monthly.eventProjectAria')} value={event.project} onChange={(e) => setEvent({ ...event, project: e.target.value })} /></label><button className="primary-action" onClick={() => void addEvent()} disabled={saving || !event.title || !event.date}>{t('monthly.addEvent')}</button></div><div className="event-list">{selected.events.map((item) => <article key={item.id}><span>{item.date}</span><div><strong>{item.title}</strong><p>{item.description || t('monthly.noDescription')}</p><small>{item.dimension.toUpperCase()}{item.project ? ` · ${item.project}` : ''}{item.feeling ? ` · ${item.feeling}` : ''}</small></div><button aria-label={t('monthly.deleteEventAria', { title: item.title })} onClick={() => void props.onDeleteEvent(item.id)}><Trash /></button></article>)}{selected.events.length === 0 && <p className="muted">{t('monthly.noEvents')}</p>}</div></section>}
          {section === 'summary' && <section className="summary-editor"><header><div><p className="eyebrow">LOCAL REFLECTION ASSISTANT</p><h3>{t('monthly.summaryTitle')}</h3><p>{t('monthly.summaryHint')}</p></div><button className="secondary-action" onClick={() => void props.onGenerateSummary()} disabled={saving || selected.completedDimensions === 0}><Sparkle />{t('monthly.generateSummary')}</button></header><label>{t('monthly.summaryLabel')}<textarea aria-label={t('monthly.summaryAria')} value={summaryDraft} onChange={(e) => setSummaryDraft(e.target.value)} maxLength={2400} placeholder={t('monthly.summaryPlaceholder')} /></label><footer><span>{t('monthly.summarySource', { source: selected.summarySource || t('monthly.notGenerated') })}</span><button className="primary-action" onClick={() => void saveSummary(summaryDraft)} disabled={saving || !summaryDraft.trim() || summaryDraft === selected.summary}>{t('monthly.saveSummary')}</button></footer></section>}
          {section === 'goals' && <section className="goals-editor"><header><div><p className="eyebrow">NEXT MONTH GOALS</p><h3>{t('monthly.goalsTitle')}</h3></div><button className="secondary-action" onClick={addGoal}><Plus />{t('monthly.addGoal')}</button></header><div className="goal-list">{goals.map((goal, index) => <article key={goal.id}><label className="goal-check"><input type="checkbox" checked={goal.completed} onChange={(e) => setGoals(goals.map((item, i) => i === index ? { ...item, completed: e.target.checked } : item))} /><span>{t('monthly.done')}</span></label><label>{t('monthly.goalLabel')}<input aria-label={t('monthly.goalAria', { index: index + 1 })} value={goal.title} onChange={(e) => setGoals(goals.map((item, i) => i === index ? { ...item, title: e.target.value } : item))} /></label><label>{t('monthly.actionLabel')}<input value={goal.action} onChange={(e) => setGoals(goals.map((item, i) => i === index ? { ...item, action: e.target.value } : item))} /></label><label>{t('monthly.priorityLabel')}<select value={goal.priority} onChange={(e) => setGoals(goals.map((item, i) => i === index ? { ...item, priority: e.target.value as ReflectionGoal['priority'] } : item))}><option value="high">{t('monthly.priorityHigh')}</option><option value="medium">{t('monthly.priorityMedium')}</option><option value="low">{t('monthly.priorityLow')}</option></select></label><label>{t('monthly.dueLabel')}<input type="date" value={goal.due} onChange={(e) => setGoals(goals.map((item, i) => i === index ? { ...item, due: e.target.value } : item))} /></label><button aria-label={t('monthly.deleteGoalAria', { index: index + 1 })} onClick={() => setGoals(goals.filter((_, i) => i !== index))}><Trash /></button></article>)}</div>{goals.length === 0 && <div className="goal-empty">{t('monthly.goalsEmpty')}</div>}<footer><button className="primary-action" onClick={() => void saveGoals(goals)} disabled={saving || goals.some((goal) => !goal.title.trim())}>{t('monthly.saveGoals')}</button></footer></section>}
        </>}
      </main>
    </div>
  </section>
}

function Overview({ reflection, onSection, onConfirm, saving }: { reflection: MonthlyReflection; onSection: (value: Section) => void; onConfirm: () => Promise<boolean>; saving: boolean }) {
  const t = useT()
  const list = dimensions(t)
  const percent = Math.round((reflection.completedDimensions / 4) * 100)
  return <section className="monthly-overview"><div className="month-hero"><div className="month-ring" style={{ '--month-progress': `${percent * 3.6}deg` } as CSSProperties}><span><strong>{percent}%</strong><small>DIMENSIONS</small></span></div><div><p className="eyebrow">{reflection.month} / REFLECTION STATUS</p><h3>{reflection.status === 'confirmed' ? t('monthly.statusConfirmed') : t('monthly.statusDraft')}</h3><p>{reflection.status === 'confirmed' ? t('monthly.confirmedNote') : t('monthly.draftNote')}</p></div></div><div className="dimension-cards">{list.map((item) => <button key={item.key} onClick={() => onSection(item.key)}><span>{reflection.dimensions[item.key] ? <CheckCircle /> : <Clock />}</span><small>{item.short}</small><strong>{reflection.dimensions[item.key] ? t('monthly.saved') : t('monthly.pending')}</strong><ArrowRight /></button>)}</div><div className="reflection-metrics"><article><UserCircle /><span><strong>{reflection.events.length}</strong><small>{t('monthly.events')}</small></span></article><article><Lightning /><span><strong>{reflection.goals.length}</strong><small>{t('monthly.nextGoals')}</small></span></article><article><Brain /><span><strong>{reflection.summary ? 'READY' : 'EMPTY'}</strong><small>{t('monthly.summaryStatus')}</small></span></article></div><div className="confirmation-panel"><div><p className="eyebrow">EXPLICIT CONFIRMATION</p><h3>{t('monthly.confirmTitle')}</h3><p>{t('monthly.confirmHint')}</p></div><button className="primary-action" onClick={() => void onConfirm()} disabled={saving || !reflection.readyToConfirm || reflection.status === 'confirmed'}>{t('monthly.confirm')}</button></div></section>
}
