import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { ArrowRight, Check, FolderOpen, FolderPlus, GithubLogo, Globe, HardDrives, Note, PlugsConnected, ShieldCheck, Sparkle } from '@phosphor-icons/react'
import type { ApiClient, Memory, OnboardingState, OnboardingTopic, RegisteredVault } from '../api'
import onboardingOrb from '../assets/onboarding-intelligence-orb.webp'
import type { OnboardingPreferences } from './OnboardingState'

const Primary = ({ children, disabled, onClick }: { children: ReactNode; disabled?: boolean; onClick: () => void }) => <button className="first-run-primary" disabled={disabled} onClick={onClick}>{children}</button>

export function WelcomeStep({ onContinue }: { onContinue: () => void }) {
  const orb = useRef<HTMLElement>(null)
  const [active, setActive] = useState(false)
  function move(event: PointerEvent<HTMLElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - bounds.left) / bounds.width - .5) * 2
    const y = ((event.clientY - bounds.top) / bounds.height - .5) * 2
    event.currentTarget.style.setProperty('--orb-x', `${x * 9}px`)
    event.currentTarget.style.setProperty('--orb-y', `${y * 9}px`)
  }
  function reset() {
    orb.current?.style.setProperty('--orb-x', '0px')
    orb.current?.style.setProperty('--orb-y', '0px')
  }
  return <div className="first-run-welcome">
    <figure ref={orb} className={`first-run-orb${active ? ' active' : ''}`} onPointerMove={move} onPointerLeave={reset} onPointerDown={() => setActive(true)} onPointerUp={() => setActive(false)} style={{ '--orb-x': '0px', '--orb-y': '0px' } as CSSProperties}>
      <img src={onboardingOrb} alt="NEXORA 个人智能核心" />
    </figure>
    <div className="first-run-welcome-copy">
      <p className="first-run-welcome-eyebrow">欢迎来到 NEXORA</p>
      <h1>你的智能。你的数据。<br />你的掌控。</h1>
      <p>本地优先的个人智能空间。由你决定什么值得记住，以及谁可以访问。</p>
      <Primary onClick={onContinue}>开始使用 <ArrowRight size={18} /></Primary>
      <small><ShieldCheck size={14} /> 数据默认保存在本机 · 不需要第三方账号</small>
    </div>
  </div>
}

type VaultProps = { client: ApiClient; currentName: string; currentVaultId: string; registered: RegisteredVault[]; defaultPath: string; busy: boolean; onBusy: (value: boolean) => void; onError: (value: string) => void; onReady: (name: string) => void; onContinue: () => void }
export function VaultStep({ client, currentName, currentVaultId, registered, defaultPath, busy, onBusy, onError, onReady, onContinue }: VaultProps) {
  const [mode, setMode] = useState<'create' | 'connect' | null>(null)
  const [path, setPath] = useState(defaultPath ? `${defaultPath}/my-ai-profile` : '')
  const [recentVaults, setRecentVaults] = useState(registered)
  useEffect(() => { setRecentVaults(registered) }, [registered])
  useEffect(() => { if (defaultPath && !path) setPath(`${defaultPath}/my-ai-profile`) }, [defaultPath, path])
  const recent = recentVaults.filter((item) => item.available).slice(0, 3)
  async function browse() { onBusy(true); onError(''); try { setPath((await client.browseVault()).path) } catch (reason) { onError(reason instanceof Error ? reason.message : '无法打开文件夹选择器。') } finally { onBusy(false) } }
  async function apply() {
    if (!mode || !path.trim()) { onError('请选择创建或连接方式，并填写本地路径。'); return }
    onBusy(true); onError('')
    try { const result = mode === 'create' ? await client.createVault(path.trim()) : await client.validateVault(path.trim()); onReady(result.displayName); await client.switchVault(path.trim()) }
    catch (reason) { onError(reason instanceof Error ? reason.message : '个人空间未能准备完成。') } finally { onBusy(false) }
  }
  async function open(item: RegisteredVault) { onBusy(true); onError(''); try { await client.connectVault(item.vaultId) } catch (reason) { onError(reason instanceof Error ? reason.message : '无法打开该个人空间。') } finally { onBusy(false) } }
  async function forget(item: RegisteredVault) { onBusy(true); onError(''); try { await client.forgetVault(item.vaultId); setRecentVaults((items) => items.filter((entry) => entry.vaultId !== item.vaultId)) } catch (reason) { onError(reason instanceof Error ? reason.message : '无法从最近列表移除此空间。') } finally { onBusy(false) } }
  return <div className="first-run-vault"><div className="first-run-current"><ShieldCheck size={20} /><span><small>当前已验证</small><strong>{currentName}</strong></span><em>Schema 与 Vault Identity 有效</em></div><div className="first-run-choice-grid"><button className={mode === 'create' ? 'selected' : ''} onClick={() => setMode('create')}><FolderPlus size={23} /><span><strong>创建新的 Vault</strong><small>为新用户建立标准本地空间</small></span></button><button className={mode === 'connect' ? 'selected' : ''} onClick={() => setMode('connect')}><FolderOpen size={23} /><span><strong>连接已有 Vault</strong><small>先验证身份与版本，不覆盖内容</small></span></button></div>{mode && <div className="first-run-path"><label><span>{mode === 'create' ? '新 Vault 保存位置' : '已有 Vault 路径'}</span><input aria-label="Vault 路径" value={path} onChange={(event) => setPath(event.target.value)} placeholder={defaultPath || '选择本地文件夹'} /></label>{defaultPath && <button onClick={() => setPath(`${defaultPath}/my-ai-profile`)} disabled={busy}>使用推荐位置</button>}<button onClick={() => void browse()} disabled={busy}>选择位置</button><button onClick={() => void apply()} disabled={busy}>{busy ? '正在验证…' : mode === 'create' ? '创建并打开' : '验证并打开'}</button></div>}{recent.length > 0 && <div className="first-run-recents"><p>最近使用</p>{recent.map((item) => <div className="first-run-recent" key={item.vaultId}><button disabled={busy || item.vaultId === currentVaultId} onClick={() => void open(item)}><FolderOpen size={18} /><span>{item.displayName}</span><em>{item.vaultId === currentVaultId ? '当前空间' : '打开'}</em></button>{item.vaultId !== currentVaultId && <button className="first-run-forget" aria-label={`忘记个人空间 ${item.vaultId}`} disabled={busy} onClick={() => void forget(item)}>忘记</button>}</div>)}</div>}<div className="first-run-actions"><Primary disabled={busy} onClick={onContinue}>继续使用此 Vault <ArrowRight size={18} /></Primary></div></div>
}

export function DataChoiceStep({ value, onChange, onContinue }: { value: OnboardingPreferences; onChange: (value: OnboardingPreferences) => void; onContinue: () => void }) {
  return <div className="first-run-data"><div className="first-run-data-map"><div className="data-source"><strong>Local Vault</strong><span>唯一事实源 · 保存在本机 · 由你拥有</span></div><div className="data-branches"><div><Note size={20} /><strong>Obsidian</strong><span>可选编辑同一份 Markdown 数据</span></div><div><HardDrives size={20} /><strong>本地快照</strong><span>本机恢复点，不等于异地备份</span></div><div><GithubLogo size={20} /><strong>GitHub Private Backup</strong><span>可选私有副本，连接不代表备份成功</span></div><div><PlugsConnected size={20} /><strong>AI 客户端</strong><span>只有授权客户端能读取指定 Scope</span></div><div><ShieldCheck size={20} /><strong>AI Provider</strong><span>模型连接不自动获得 Vault 权限</span></div></div></div><div className="first-run-preferences"><button className={value.usage === 'web' ? 'selected' : ''} onClick={() => onChange({ ...value, usage: 'web' })}><Globe size={20} /><span><strong>只使用 NEXORA</strong><small>推荐，所有能力都在本地应用中完成</small></span><Check size={17} /></button><button className={value.usage === 'obsidian' ? 'selected' : ''} onClick={() => onChange({ ...value, usage: 'obsidian' })}><Note size={20} /><span><strong>同时使用 Obsidian</strong><small>编辑同一个 Markdown Vault，不复制另一份档案</small></span></button><button className={value.githubBackup ? 'selected' : ''} onClick={() => onChange({ ...value, githubBackup: !value.githubBackup })}><GithubLogo size={20} /><span><strong>稍后配置 GitHub 私有备份</strong><small>此处不会登录，也不会声称已经备份</small></span></button></div><div className="first-run-actions"><Primary onClick={onContinue}>我明白了，继续 <ArrowRight size={18} /></Primary></div></div>
}

type ConversationProps = { client: ApiClient; value: OnboardingState | null; loading: boolean; preferredTopic: string; onTopic: (topic: string) => void; onValue: (value: OnboardingState) => void; onError: (value: string) => void; onContinue: () => void }
export function ConversationStep({ client, value, loading, preferredTopic, onTopic, onValue, onError, onContinue }: ConversationProps) {
  const [answer, setAnswer] = useState(''); const [consent, setConsent] = useState(false); const [skipped, setSkipped] = useState<string[]>([])
  const available = value?.topics.filter((item) => item.status === 'available' && !skipped.includes(item.key)) ?? []
  const topic = available.find((item) => item.key === preferredTopic) ?? available[0]
  async function submit(item: OnboardingTopic) { if (!answer.trim() || !consent) return; onError(''); try { const result = await client.onboardingResponse(item.key, answer.trim()); onValue(result.state); setAnswer(''); setConsent(false); onTopic(result.state.topics.find((entry) => entry.status === 'available')?.key ?? '') } catch (reason) { onError(reason instanceof Error ? reason.message : '候选记忆未能保存。') } }
  if (loading) return <p className="first-run-loading">正在读取本地建档主题…</p>
  if (!value || !topic) return <div className="first-run-finished-topic"><Sparkle size={28} /><h2>你可以稍后继续完善档案</h2><p>已保存的回答仍然只是候选记忆，需要在下一步由你审核。</p><Primary onClick={onContinue}>查看候选记忆 <ArrowRight size={18} /></Primary></div>
  return <div className="first-run-conversation"><aside><p>{value.topics.filter((item) => item.status !== 'available').length} / {value.topics.length}</p><strong>逐步建立</strong><span>不需要一次回答所有问题</span></aside><section><div className="conversation-orb"><img src={onboardingOrb} alt="NEXORA" /></div><p className="conversation-topic">{topic.title}</p><h2>{topic.prompt}</h2><textarea aria-label="你的回答" value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="输入你的回答…" /><label className="conversation-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />我确认将这段回答保存为候选记忆。它不会自动进入正式档案。</label><div className="first-run-actions split"><button className="first-run-secondary" onClick={() => { setSkipped((items) => [...items, topic.key]); setAnswer(''); setConsent(false); onTopic('') }}>跳过这个问题</button><Primary disabled={!answer.trim() || !consent} onClick={() => void submit(topic)}>保存为候选并继续 <ArrowRight size={18} /></Primary></div><button className="first-run-text" onClick={onContinue}>暂时结束建档，进入审核</button></section></div>
}

type ReviewProps = { client: ApiClient; value: Memory[]; loading: boolean; onValue: (value: Memory[]) => void; onError: (value: string) => void; onContinue: () => void }
export function MemoryReviewStep({ client, value, loading, onValue, onError, onContinue }: ReviewProps) {
  const [selectedId, setSelectedId] = useState(''); const selected = useMemo(() => value.find((item) => item.id === selectedId) ?? value[0] ?? null, [value, selectedId]); const [draft, setDraft] = useState(''); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const content = selectedId && selected ? draft : selected?.content ?? ''
  function select(item: Memory) { setSelectedId(item.id); setDraft(item.content); setReason('') }
  async function edit() { if (!selected || !content.trim()) return; setBusy(true); onError(''); try { const updated = await client.edit(selected.id, content.trim(), selected.revision); onValue(value.map((item) => item.id === updated.id ? updated : item)); setDraft(updated.content) } catch (error) { onError(error instanceof Error ? error.message : '候选记忆未能更新。') } finally { setBusy(false) } }
  async function decide(action: 'confirm' | 'reject') { if (!selected) return; setBusy(true); onError(''); try { await client.action(selected.id, action, selected.revision, reason); onValue(value.filter((item) => item.id !== selected.id)); setSelectedId(''); setDraft(''); setReason('') } catch (error) { onError(error instanceof Error ? error.message : '审核操作未完成。') } finally { setBusy(false) } }
  if (loading) return <p className="first-run-loading">正在读取候选记忆…</p>
  if (!selected) return <div className="first-run-finished-topic"><Check size={28} /><h2>当前没有待审核记忆</h2><p>你可以直接进入个人空间，稍后再继续建立档案。</p><Primary onClick={onContinue}>继续 <ArrowRight size={18} /></Primary></div>
  return <div className="first-run-review"><aside><p>待审核 · {value.length}</p>{value.map((item) => <button key={item.id} className={item.id === selected.id ? 'selected' : ''} onClick={() => select(item)}><strong>{item.subject || item.type || '候选记忆'}</strong><span>{item.content}</span></button>)}</aside><section><p className="review-source">来源：{selected.sourceAgent || 'local-onboarding'}</p><textarea aria-label="候选记忆内容" value={content} onChange={(event) => { setSelectedId(selected.id); setDraft(event.target.value) }} /><label><span>拒绝原因（拒绝时填写）</span><input value={reason} onChange={(event) => setReason(event.target.value)} /></label><div className="first-run-actions split"><div><button className="first-run-secondary" disabled={busy || content.trim() === selected.content} onClick={() => void edit()}>保存修改</button><button className="first-run-danger" disabled={busy || !reason.trim()} onClick={() => void decide('reject')}>拒绝</button></div><Primary disabled={busy} onClick={() => void decide('confirm')}>确认记忆 <Check size={18} /></Primary></div><button className="first-run-text" onClick={onContinue}>保留 {value.length} 条待审核记忆并继续</button></section></div>
}

export function CompleteStep({ vaultName, pending, busy, onFinish }: { vaultName: string; pending: number; busy: boolean; onFinish: (destination: 'overview' | 'review') => Promise<void> }) {
  return <div className="first-run-complete"><div className="complete-mark"><Check size={30} /></div><div className="complete-summary"><div><span>Vault</span><strong>{vaultName}</strong><em>本地可用</em></div><div><span>候选记忆</span><strong>{pending} 条待审核</strong><em>{pending ? '可稍后继续' : '当前已处理'}</em></div><div><span>第三方连接</span><strong>未要求配置</strong><em>保持可选</em></div></div>{pending > 0 && <div className="complete-next"><span>下一步建议</span><strong>继续审核候选记忆</strong><p>尚未确认的内容不会进入正式档案，也不会作为已确认个人信息提供给 AI。</p></div>}<div className="first-run-actions final"><Primary disabled={busy} onClick={() => void onFinish('overview')}>{busy ? '正在保存…' : '进入 NEXORA'} <ArrowRight size={18} /></Primary>{pending > 0 && <button className="first-run-secondary" disabled={busy} onClick={() => void onFinish('review')}>立即审核记忆</button>}</div></div>
}
