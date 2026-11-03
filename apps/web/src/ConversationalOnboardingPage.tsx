import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { ArrowRight, CheckCircle, Circle, Clock, LockKey, ShieldCheck, Sparkle, UserCircle } from '@phosphor-icons/react'
import type { OnboardingState, OnboardingTopic } from './api'

type Props = {
  value: OnboardingState | null
  loading: boolean
  saving: boolean
  onSave: (topic: string, content: string) => Promise<boolean>
  onReview: () => void
}

export default function ConversationalOnboardingPage({ value, loading, saving, onSave, onReview }: Props) {
  const [answer, setAnswer] = useState('')
  const [skipped, setSkipped] = useState<string[]>([])
  const [consent, setConsent] = useState(false)
  const available = useMemo(() => value?.topics.filter((item) => item.status === 'available' && !skipped.includes(item.key)) ?? [], [value, skipped])

  if (loading) return <div className="visual-panel" role="status">正在读取本地引导状态…</div>
  if (!value) return <section className="onboarding-page"><div className="onboarding-empty"><h2>暂时无法读取引导状态</h2><p>请检查本地服务状态后重新打开本页面。</p></div></section>

  const topic = available[0]
  const pending = value.topics.filter((item) => item.status === 'pending').length
  const confirmed = value.topics.filter((item) => item.status === 'confirmed').length
  const answered = confirmed + pending
  const percent = value.topics.length ? Math.round((answered / value.topics.length) * 100) : 0

  async function submit(item: OnboardingTopic) {
    if (!answer.trim() || !consent) return
    if (await onSave(item.key, answer.trim())) {
      setAnswer('')
      setConsent(false)
    }
  }

  function skip(item: OnboardingTopic) {
    setSkipped((items) => [...items, item.key])
    setAnswer('')
    setConsent(false)
  }

  return <section className="onboarding-page">
    <header className="onboarding-heading">
      <div><p className="eyebrow">CONVERSATIONAL ONBOARDING / LOCAL ONLY</p><h2>Build your profile through dialogue.</h2><p>通过轻量对话逐步建立档案。你的回答只会成为候选记忆，确认前不会进入正式个人档案。</p></div>
      <div className="onboarding-boundary"><ShieldCheck size={20} /><span><strong>Human confirmation required</strong><small>所有正式记忆都需要你在 Memory Review 中确认</small></span></div>
    </header>

    <div className="onboarding-overview" aria-label="引导进度">
      <div className="progress-orbit" style={{ '--progress': `${percent * 3.6}deg` } as CSSProperties}><span><strong>{percent}%</strong><small>PROFILE SIGNAL</small></span></div>
      <div className="progress-copy"><p className="eyebrow">PROFILE CALIBRATION</p><h3>{answered} / {value.topics.length} 个主题已回答</h3><p>{value.notice}</p><div className="progress-line"><i style={{ width: `${percent}%` }} /></div></div>
      <dl><div><dt>已确认</dt><dd>{confirmed}</dd></div><div><dt>待审核</dt><dd>{pending}</dd></div><div><dt>本轮可继续</dt><dd>{available.length}</dd></div></dl>
    </div>

    <div className="onboarding-layout">
      <main className="dialogue-space" aria-live="polite">
        <div className="dialogue-top"><div><span className="agent-avatar"><Sparkle size={20} weight="duotone" /></span><div><strong>Profile Guide</strong><small><i /> LOCAL SESSION</small></div></div><span>对话内容不会被单独保存</span></div>
        {!topic ? <div className="onboarding-empty"><CheckCircle size={38} /><h3>{value.completed ? '本轮引导已完成' : '已跳过本轮剩余问题'}</h3><p>{pending ? `还有 ${pending} 条候选回答等待你确认。` : '你可以随时返回，继续补充愿意分享的信息。'}</p>{pending > 0 && <button className="primary-action" onClick={onReview}>前往 Memory Review <ArrowRight size={17} /></button>}</div> : <>
          <div className="dialogue-thread">
            <div className="guide-message"><span className="agent-avatar"><Sparkle size={18} /></span><div><small>PROFILE GUIDE · {topic.title}</small><p>{topic.prompt}</p><em>你可以简短回答、详细描述，或暂时跳过。</em></div></div>
            <div className="user-composer">
              <div className="composer-label"><span><UserCircle size={17} />你的回答</span><small>{answer.length} / 1000</small></div>
              <textarea aria-label="你的回答" value={answer} onChange={(event) => setAnswer(event.target.value)} maxLength={1000} placeholder="只填写你愿意保存为候选记忆的内容…" disabled={saving} autoFocus />
              <label className="consent-check"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} disabled={saving} /><span>我同意将这次回答创建为候选记忆，稍后由我审核确认。</span></label>
              <div className="composer-actions"><button className="secondary" onClick={() => skip(topic)} disabled={saving}>暂时跳过</button><button className="primary-action" onClick={() => void submit(topic)} disabled={saving || !answer.trim() || !consent}>{saving ? '正在创建候选…' : <>保存为候选并继续 <ArrowRight size={17} /></>}</button></div>
            </div>
          </div>
          <div className="privacy-rail"><LockKey size={16} /><p><strong>隐私边界</strong>不会保存聊天过程；这里只创建一条待审核候选记忆。请勿填写密码、Token、验证码、证件或银行卡信息。</p></div>
        </>}
      </main>

      <aside className="topic-map" aria-label="建档主题">
        <div><p className="eyebrow">PROFILE SIGNALS</p><h3>建档主题</h3><p>每个主题独立推进，没有必须完成的任务。</p></div>
        <div className="topic-list">{value.topics.map((item, index) => {
          const isSkipped = skipped.includes(item.key)
          const isActive = item.key === topic?.key
          return <article key={item.key} className={`${item.status} ${isActive ? 'active' : ''}`}><span className="topic-index">{String(index + 1).padStart(2, '0')}</span><span className="topic-state">{item.status === 'confirmed' ? <CheckCircle /> : item.status === 'pending' ? <Clock /> : <Circle />}</span><div><strong>{item.title}</strong><small>{item.status === 'confirmed' ? '已确认' : item.status === 'pending' ? '等待审核' : isSkipped ? '本轮跳过' : isActive ? '正在对话' : '可回答'}</small></div></article>
        })}</div>
        {pending > 0 && <button className="review-link" onClick={onReview}><span><Clock size={18} /><b>{pending} 条候选等待审核</b></span><ArrowRight size={18} /></button>}
      </aside>
    </div>
  </section>
}
