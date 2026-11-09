import { useEffect, useState } from 'react'
import { ArrowRight, Check, FolderOpen, FolderPlus, Globe, Note, Sparkle, Trash } from '@phosphor-icons/react'
import type { ApiClient, OnboardingState, RegisteredVault } from './api'
import ConversationalOnboardingPage from './ConversationalOnboardingPage'
import { vaultHint } from './vaultHints'
import onboardingOrb from './assets/onboarding-intelligence-orb.webp'

function joinPath(base: string, name: string) {
  return `${base.replace(/[\\/]+$/, '')}/${name.replace(/^[\\/]+/, '')}`
}

type Props = { client: ApiClient; vaultName: string; onFinish: (destination: 'overview' | 'review') => void }

export default function FirstRunWizard({ client, vaultName, onFinish }: Props) {
  const [usage, setUsage] = useState<'web' | 'obsidian'>('web')
  const [mode, setMode] = useState<'create' | 'connect' | null>(null)
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  const [interview, setInterview] = useState(false)
  const [interviewState, setInterviewState] = useState<OnboardingState | null>(null)
  const [interviewLoading, setInterviewLoading] = useState(false)
  const [registered, setRegistered] = useState<RegisteredVault[]>([])
  const [currentVaultId, setCurrentVaultId] = useState('')
  const [connecting, setConnecting] = useState('')
  const [defaultPath, setDefaultPath] = useState('')
  const [folderName, setFolderName] = useState('')

  useEffect(() => {
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
    void client.vaultStatus().then((status) => setCurrentVaultId(status.vaultId)).catch(() => undefined)
    void client.registeredVaults().then(setRegistered).catch(() => undefined)
    void client.vaultDefaultPath().then((result) => {
      if (!result.path) return
      setDefaultPath(result.path)
      setPath((current) => current || joinPath(result.path, 'my-ai-profile'))
    }).catch(() => undefined)
  }, [client])

  async function run(action: 'create' | 'connect') {
    const target = path.trim()
    if (!target) { setError('请填写文件夹的完整路径。'); return }
    setBusy('run'); setError(''); setDone('')
    try {
      const result = action === 'create' ? await client.createVault(target) : await client.validateVault(target)
      setDone(`${action === 'create' ? '已创建' : '已连接'}个人空间「${result.displayName}」。`)
    } catch (reason) {
      setError(vaultHint(reason instanceof Error ? reason.message : '操作失败，请检查路径后重试。'))
    } finally { setBusy('') }
  }

  async function browse() {
    setBusy('browse'); setError('')
    try {
      const result = await client.browseVault()
      setPath(result.path)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '无法打开文件夹选择器。') }
    finally { setBusy('') }
  }

  function useRecommended() {
    const name = folderName.trim() || 'my-ai-profile'
    setPath(joinPath(defaultPath || 'C:\\Nexora\\vault', name))
    setError('')
  }

  async function forget(item: RegisteredVault) {
    if (!window.confirm(`忘记个人空间「${item.displayName}」？只会从本机登记中移除，不会删除任何文件。`)) return
    setBusy(`forget:${item.vaultId}`); setError('')
    try {
      await client.forgetVault(item.vaultId)
      setRegistered((current) => current.filter((entry) => entry.vaultId !== item.vaultId))
      setDone('已从登记中移除，磁盘文件未改动。')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '移除失败。') }
    finally { setBusy('') }
  }

  async function connect(item: RegisteredVault) {
    setConnecting(item.vaultId); setError(''); setDone('')
    try {
      await client.connectVault(item.vaultId)
      setDone(`正在打开「${item.displayName}」…`)
    } catch (reason) {
      setError(vaultHint(reason instanceof Error ? reason.message : '连接失败，请稍后重试。'))
    } finally { setConnecting('') }
  }

  async function finish(destination: 'overview' | 'review') {
    try { await client.markInitialized() } catch { /* 下次重新显示向导，不影响当前使用。 */ }
    onFinish(destination)
  }

  async function startInterview() {
    setInterview(true); setInterviewLoading(true); setError('')
    try { setInterviewState(await client.onboarding()) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '暂时无法读取建档问题。') }
    finally { setInterviewLoading(false) }
  }

  async function saveInterview(topic: string, content: string) {
    setBusy('interview'); setError('')
    try { const result = await client.onboardingResponse(topic, content); setInterviewState(result.state); return true }
    catch (reason) { setError(reason instanceof Error ? reason.message : '候选记忆创建失败。'); return false }
    finally { setBusy('') }
  }

  if (interview) return <main className="wizard wizard-interview" aria-label="首次对话建档">
    <header className="wizard-interview-header"><div><p className="wizard-badge"><Sparkle size={14} weight="fill" />首次建档 · Local only</p><h1>先完成一次轻量对话</h1><p>回答只会成为候选记忆，确认前不会进入正式档案。</p></div><button className="text-button" onClick={() => void finish('overview')}>暂时结束并进入工作台</button></header>
    {error && <p className="wizard-error" role="alert">{error}</p>}
    <ConversationalOnboardingPage value={interviewState} loading={interviewLoading} saving={busy} onSave={saveInterview} onReview={() => void finish('review')} />
  </main>

  return <main className="wizard" aria-label="首次启动向导">
    <header className="wizard-intro">
      <p className="wizard-badge"><Sparkle size={14} weight="fill" />NEXORA 知序 · Onboarding</p>
      <h1>欢迎来到 NEXORA 个人智能中枢</h1>
      <p>建立一个属于自己的长期个人上下文空间。你的数据默认保存在本地。</p>
      <p className="wizard-note">Vault 是一个本地文件夹：数据只留在本机，路径与内容都不会上传到任何服务。</p>
    </header>

    <figure className="wizard-hero-image">
      <img src={onboardingOrb} alt="蓝紫色个人智能网络球体" />
      <figcaption><strong>Your Intelligence. Your Data. Your Control.</strong><span>Local-first personal intelligence platform</span></figcaption>
    </figure>

    <section className="wizard-section" aria-labelledby="wizard-space-title">
      <header><span>01</span><div><h2 id="wizard-space-title">创建你的个人空间</h2><p>当前空间：{vaultName}</p></div></header>
      <div className="wizard-space-grid">
        <button className={mode === 'create' ? 'selected' : ''} onClick={() => { setMode('create'); setError(''); setDone('') }}><FolderPlus size={25} /><span><strong>创建新的 Vault</strong><small>系统自动创建标准目录和 Markdown 文件</small></span><ArrowRight size={18} /></button>
        <button className={mode === 'connect' ? 'selected' : ''} onClick={() => { setMode('connect'); setError(''); setDone('') }}><FolderOpen size={25} /><span><strong>连接已有 Vault</strong><small>校验并连接已有的个人知识库目录</small></span><ArrowRight size={18} /></button>
      </div>
      {mode && <div className="wizard-path-row"><label><span>{mode === 'create' ? '新 Vault 目录' : '已有 Vault 目录'}</span><input aria-label={mode === 'create' ? '新 Vault 的文件夹路径' : '已有 Vault 的文件夹路径'} value={path} onChange={(event) => { setPath(event.target.value); setError('') }} placeholder={defaultPath || '例如 D:\\Nexora\\vault'} /></label><button className="secondary-action" onClick={() => void browse()} disabled={busy}>{busy === 'browse' ? '正在打开…' : '浏览…'}</button><button className="secondary-action" onClick={() => void run(mode)} disabled={busy}>{busy ? '处理中…' : mode === 'create' ? '创建 Vault' : '验证并连接'}</button></div>}
      {mode === 'create' && <div className="wizard-path-row"><label><span>文件夹名称（可选）</span><input aria-label="文件夹名称" value={folderName} onChange={(event) => { setFolderName(event.target.value); setError('') }} placeholder="my-ai-profile" /></label><button className="secondary-action" onClick={useRecommended} disabled={busy || !defaultPath}>使用推荐目录</button></div>}
      {mode === 'create' && folderName.trim() && <p className="wizard-hint">将创建：{joinPath(defaultPath || 'C:\\Nexora\\vault', folderName.trim())}</p>}
      {registered.length > 0 && <div className="wizard-registered">
        <p className="wizard-registered-title">最近使用的个人空间</p>
        <div className="wizard-registered-list">
          {registered.map((item) => <div key={item.vaultId} className="wizard-registered-item">
            <button disabled={!item.available || connecting === item.vaultId} onClick={() => void connect(item)}>
              <FolderOpen size={20} />
              <span><strong>{item.displayName}</strong><small>{item.vaultId.slice(0, 18)}</small></span>
              <em>{item.vaultId === currentVaultId ? '当前空间' : item.available ? (connecting === item.vaultId ? '正在打开…' : '打开') : '目录不存在'}</em>
            </button>
            <button className="wizard-forget" onClick={() => void forget(item)} disabled={Boolean(busy)} aria-label={`忘记个人空间 ${item.vaultId.slice(0, 8)}`} title={`只移除登记，不删除文件：${item.displayName}`}><Trash size={16} /></button>
          </div>)}
        </div>
      </div>}
      {done && <p className="wizard-done" role="status"><Check size={17} />{done}</p>}
      {error && <p className="wizard-error" role="alert">{error}</p>}
    </section>

    <section className="wizard-section" aria-labelledby="wizard-usage-title">
      <header><span>02</span><div><h2 id="wizard-usage-title">选择使用方式</h2><p>Obsidian 是可选编辑器，不是使用产品的前置条件。</p></div></header>
      <div className="wizard-options" role="radiogroup" aria-label="使用方式">
        <button role="radio" aria-checked={usage === 'web'} className={usage === 'web' ? 'selected' : ''} onClick={() => setUsage('web')}><Globe size={23} /><span><strong>仅使用网页</strong><small>所有功能都在本地浏览器中完成</small></span><em>默认</em></button>
        <button role="radio" aria-checked={usage === 'obsidian'} className={usage === 'obsidian' ? 'selected' : ''} onClick={() => setUsage('obsidian')}><Note size={23} /><span><strong>同时使用 Obsidian</strong><small>用 Obsidian 编辑同一个 Markdown Vault</small></span><em>可选</em></button>
      </div>
    </section>

    <section className="wizard-section wizard-profile-start" aria-labelledby="wizard-profile-title">
      <header><span>03</span><div><h2 id="wizard-profile-title">开始建立个人档案</h2><p>每次回答只创建候选记忆，仍需你在 Memory Review 中确认。</p></div></header>
      <div className="wizard-final-actions"><button className="primary-action" onClick={() => void startInterview()}>开始对话建档 <ArrowRight size={17} /></button><button className="text-button" onClick={() => void finish('overview')}>先进入 Overview</button></div>
    </section>
  </main>
}
