import type { MonthlyTrend } from './api'

export default function MonthlyTrendPage({ value, loading }: { value: MonthlyTrend | null; loading: boolean }) {
  if (loading) return <div className="skeletons" aria-label="加载中"><i /><i /><i /></div>
  if (!value) return <div className="profile-empty"><h3>月度趋势</h3><p>正在读取本地月度复盘数据。</p></div>
  if (value.points.length === 0) return <div className="profile-empty"><h3>还没有已确认的月度复盘</h3><p>确认至少一期月度复盘后，这里会展示跨月对比与趋势。</p></div>

  return <section className="monthly-trend" aria-label="月度复盘趋势">
    <p className="trend-disclaimer">{value.disclaimer}</p>

    <div className="dimension-compare" aria-label="四维对比">
      {value.dimensions.map((dimension) => <div key={dimension.key} className="dimension-column">
        <h3>{dimension.title}</h3>
        {value.points.map((point) => <div key={point.month} className="dimension-cell">
          <span className="cell-month">{point.month}</span>
          <p>{point.dimensions[dimension.key] || '（未填写）'}</p>
        </div>)}
      </div>)}
    </div>

    <div className="trend-timeline" aria-label="跨月时间线">
      {value.points.map((point) => <article key={point.month} className="trend-card">
        <header><h3>{point.month}</h3><span className="trend-stats">维度 {point.completedDimensions}/4 · 事件 {point.eventCount} · 目标 {point.goalCompleted}/{point.goalTotal}</span></header>
        {point.summary && <p className="trend-summary">{point.summary}</p>}
        {point.events.length > 0 && <ul className="trend-list">{point.events.map((event) => <li key={event.id}><span>{event.date}</span>{event.title}</li>)}</ul>}
        {point.goals.length > 0 && <ul className="trend-list">{point.goals.map((goal) => <li key={goal.id} className={goal.completed ? 'done' : ''}><span>{goal.completed ? '已完成' : '进行中'}</span>{goal.title}</li>)}</ul>}
      </article>)}
    </div>
  </section>
}
