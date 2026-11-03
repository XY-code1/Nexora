import { useMemo, useState } from 'react'
import { CheckCircle, Clock, FileText, Funnel, LockKey, MagnifyingGlass, NotePencil, Tag, UserCircle, XCircle } from '@phosphor-icons/react'
import type { Memory, MemoryStats } from './api'

type Props = {
  memories: Memory[]
  stats: MemoryStats
  selected: Memory | null
  draft: string
  rejectionReason: string
  loading: boolean
  saving: boolean
  onSelect: (memory: Memory) => void
  onDraft: (value: string) => void
  onRejectionReason: (value: string) => void
  onSave: () => Promise<boolean>
  onAct: (action: 'confirm' | 'reject') => Promise<boolean>
}

function displayTime(value: string) {
  if (!value) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export default function MemoryReviewPage(props: Props) {
  const { memories, stats, selected, draft, rejectionReason, loading, saving } = props
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [status, setStatus] = useState('all')
  const [editing, setEditing] = useState(false)
  const categories = useMemo(() => [...new Set(memories.map((memory) => memory.type))].sort(), [memories])
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return memories.filter((memory) =>
      (category === 'all' || memory.type === category) &&
      (status === 'all' || memory.status === status) &&
      (!needle || `${memory.subject} ${memory.content} ${memory.sourceAgent}`.toLocaleLowerCase().includes(needle)),
    )
  }, [memories, query, category, status])

  function select(memory: Memory) {
    setEditing(false)
    props.onSelect(memory)
  }

  async function save() {
    if (await props.onSave()) setEditing(false)
  }

  return <section className="review-page">
    <header className="review-heading">
      <div><p className="eyebrow">MEMORY LIFECYCLE / HUMAN REVIEW</p><h2>Memory Review</h2><p>Review candidate memories before they become part of your Personal AI Profile.</p></div>
      <div className="review-stats" aria-label="真实记忆统计">
        <article><span>Candidate Memories</span><strong>{stats.candidateMemories}</strong></article>
        <article><span>Pending Review</span><strong>{stats.pendingReview}</strong></article>
        <article><span>Confirmed Memories</span><strong>{stats.confirmedMemories}</strong></article>
      </div>
    </header>

    <div className="review-toolbar">
      <label className="search-field"><MagnifyingGlass size={18} /><span className="sr-only">搜索候选记忆</span><input aria-label="搜索候选记忆" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、内容或来源…" /></label>
      <label><Funnel size={17} /><span className="sr-only">分类筛选</span><select aria-label="分类筛选" value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">全部分类</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label><Clock size={17} /><span className="sr-only">状态筛选</span><select aria-label="状态筛选" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部待审核状态</option><option value="candidate">Candidate</option><option value="disputed">Disputed</option></select></label>
    </div>

    <div className="review-workspace">
      <aside className="candidate-queue" aria-label="候选记忆列表">
        <div className="queue-heading"><div><p className="eyebrow">CANDIDATE QUEUE</p><h3>等待你的判断</h3></div><span>{filtered.length} / {memories.length}</span></div>
        {loading && <div className="skeletons" aria-label="加载中"><i /><i /><i /></div>}
        {!loading && memories.length === 0 && <div className="review-empty"><FileText size={28} /><h3>暂时没有候选记忆</h3><p>新的候选内容会在这里等待人工审核，不会自动成为正式记忆。</p></div>}
        {!loading && memories.length > 0 && filtered.length === 0 && <div className="review-empty"><MagnifyingGlass size={28} /><h3>没有匹配结果</h3><p>调整搜索词或筛选条件后重试。</p></div>}
        {!loading && filtered.map((memory) => <button key={memory.id} className={`candidate-row ${memory.id === selected?.id ? 'selected' : ''}`} aria-pressed={memory.id === selected?.id} onClick={() => select(memory)}>
          <span className="candidate-icon"><FileText size={20} /></span><span className="candidate-copy"><small>{memory.type} · {memory.status}</small><strong>{memory.subject || '未命名候选记忆'}</strong><span>{memory.content}</span><em>{memory.sourceAgent} · {displayTime(memory.created)}</em></span>
        </button>)}
      </aside>

      <section className="memory-inspector" aria-live="polite">
        {!selected && !loading && <div className="inspector-empty"><FileText size={34} /><h3>选择一条候选记忆</h3><p>完整内容与生命周期操作会显示在这里。</p></div>}
        {selected && <>
          <header className="inspector-heading"><div><p className="eyebrow">MEMORY INSPECTOR / {selected.status.toUpperCase()}</p><h3>{selected.subject || '未命名候选记忆'}</h3></div><span className="lifecycle-badge">Candidate</span></header>
          <div className="lifecycle-track" aria-label="记忆生命周期"><strong>Candidate</strong><i /><span>Explicit confirmation</span><i /><span>Formal memory</span></div>
          <dl className="inspector-meta">
            <div><UserCircle size={17} /><dt>来源</dt><dd>{selected.sourceAgent}</dd></div>
            <div><Clock size={17} /><dt>创建时间</dt><dd>{displayTime(selected.created)}</dd></div>
            <div><Tag size={17} /><dt>分类</dt><dd>{selected.type}</dd></div>
            <div><LockKey size={17} /><dt>AI 权限</dt><dd>{selected.aiAccess || 'denied'}</dd></div>
            <div><FileText size={17} /><dt>可见性</dt><dd>{selected.visibility || 'private'}</dd></div>
            <div><NotePencil size={17} /><dt>Revision</dt><dd><code>{selected.revision.slice(0, 12)}…</code></dd></div>
          </dl>
          <section className="memory-content-panel"><div className="content-label"><span>完整内容</span>{selected.tags?.length ? <span>{selected.tags.join(' · ')}</span> : <span>未设置标签</span>}</div>{editing ? <textarea aria-label="记忆内容" value={draft} onChange={(event) => props.onDraft(event.target.value)} maxLength={4000} disabled={saving} /> : <p>{selected.content}</p>}</section>
          <label className="rejection-field" htmlFor="rejection-reason">拒绝原因（可选）<input id="rejection-reason" value={rejectionReason} onChange={(event) => props.onRejectionReason(event.target.value)} maxLength={200} placeholder="例如：不是长期信息" disabled={saving} /></label>
          <footer className="inspector-actions">
            <p>写操作通过 Core 执行，并校验当前 Revision。</p>
            <div>{editing ? <><button className="secondary" onClick={() => { props.onDraft(selected.content); setEditing(false) }} disabled={saving}>取消编辑</button><button className="secondary" onClick={() => void save()} disabled={saving || !draft.trim()}>保存修改</button></> : <button className="secondary" onClick={() => setEditing(true)} disabled={saving}><NotePencil size={18} />Edit Memory</button>}<button className="danger" onClick={() => void props.onAct('reject')} disabled={saving}><XCircle size={18} />Reject Memory</button><button className="confirm" onClick={() => void props.onAct('confirm')} disabled={saving}><CheckCircle size={18} />Confirm Memory</button></div>
          </footer>
        </>}
      </section>
    </div>
  </section>
}
