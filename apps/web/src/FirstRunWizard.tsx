import { useState } from 'react'
import { ArrowRight, Check, FolderOpen, FolderPlus, Globe, Note, Sparkle } from '@phosphor-icons/react'
import type { ApiClient } from './api'
import { ErrorState } from './components/StateBlocks'

/**
 * 首次启动向导（产品流程阶段一）。
 *
 * 设计要点：
 * - 用户第一次打开时不应面对十一个功能菜单，而是一个清晰的初始化向导。
 * - Obsidian 是可选项，不是必须安装的前置条件。
 * - 页面只显示 Vault 的显示名，绝不显示私人文件系统路径。
 */

type Props = {
  client: ApiClient
  vaultName: string
  onStartProfile: () => void
  onSkip: () => void
}

type Step = 'space' | 'usage' | 'profile'

export default function FirstRunWizard({ client, vaultName, onStartProfile, onSkip }: Props) {
  const [step, setStep] = useState<Step>('space')
  const [usage, setUsage] = useState<'web' | 'obsidian'>('web')
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  async function run(action: 'create' | 'connect') {
    const target = path.trim()
    if (!target) {
      setError('请填写文件夹的完整路径。')
      return
    }
    setBusy(true)
    setError('')
    try {
      if (action === 'create') {
        const result = await client.createVault(target)
        setDone(`已创建个人空间「${result.displayName}」。`)
      } else {
        const result = await client.validateVault(target)
        setDone(`已连接个人空间「${result.displayName}」。`)
      }
      setPath('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败，请检查路径后重试。')
    } finally {
      setBusy(false)
    }
  }

  return <main className="wizard" aria-label="首次启动向导">
    <section className="wizard-hero">
      <p className="wizard-badge">首次启动 · Onboarding</p>
      <h1>欢迎来到你的个人智能中枢</h1>
      <p className="wizard-lede">建立一个属于自己的长期个人上下文空间。你的数据默认保存在本地。</p>
      <div className="wizard-visual" aria-hidden="true">
        <span className="core-sphere" />
        <span className="core-halo core-halo-1" />
        <span className="core-halo core-halo-2" />
        <span className="core-chip core-chip-1">Identity</span>
        <span className="core-chip core-chip-2">Memory</span>
        <span className="core-chip core-chip-3">Goals</span>
        <span className="core-chip core-chip-4">Reflection</span>
        <span className="core-chip core-chip-5">Authorized AI</span>
      </div>
    </section>

    <section className="wizard-body">
      <ol className="wizard-steps" aria-label="初始化步骤">
        <li className={step === 'space' ? 'active' : 'done'}><span>1</span>创建你的个人空间</li>
        <li className={step === 'usage' ? 'active' : step === 'profile' ? 'done' : ''}><span>2</span>选择使用方式</li>
        <li className={step === 'profile' ? 'active' : ''}><span>3</span>开始建立个人档案</li>
      </ol>

      {step === 'space' && <div className="wizard-step">
        <div className="wizard-ready">
          <span className="wizard-ready-icon"><FolderOpen size={24} /></span>
          <div><p className="eyebrow">CURRENT SPACE</p><h2>你的个人空间已就绪</h2><p>标准目录与 Markdown 文件已由本地启动器创建。</p></div>
          <strong>{vaultName}</strong>
        </div>
        {done && <p className="wizard-done" role="status"><Check size={17} />{done}</p>}
        {error && <p className="wizard-error" role="alert">{error}</p>}
        <div className="wizard-choices">
          <article className="wizard-choice">
            <span className="wizard-choice-icon"><FolderPlus size={22} /></span>
            <div><h3>创建新的 Vault</h3><p>系统自动创建标准目录和 Markdown 文件。</p></div>
            <label className="wizard-path"><span className="sr-only">新 Vault 的文件夹路径</span><input aria-label="新 Vault 的文件夹路径" value={path} onChange={(event) => { setPath(event.target.value); setError('') }} placeholder="例如 D:\PersonalAIProfile\my-ai-profile" /></label>
            <button className="secondary-action" onClick={() => void run('create')} disabled={busy}>{busy ? '正在创建…' : '创建'}</button>
          </article>
          <article className="wizard-choice">
            <span className="wizard-choice-icon"><FolderOpen size={22} /></span>
            <div><h3>连接已有 Vault</h3><p>选择已有的个人知识库目录。</p></div>
            <label className="wizard-path"><span className="sr-only">已有 Vault 的文件夹路径</span><input aria-label="已有 Vault 的文件夹路径" value={path} onChange={(event) => { setPath(event.target.value); setError('') }} placeholder="填写已有 Vault 的完整路径" /></label>
            <button className="secondary-action" onClick={() => void run('connect')} disabled={busy}>{busy ? '正在连接…' : '连接'}</button>
          </article>
        </div>
        <div className="wizard-actions"><button className="primary-action" onClick={() => setStep('usage')}>继续使用当前空间 <ArrowRight size={17} /></button><button className="text-button" onClick={onSkip}>跳过，先看看</button></div>
      </div>}

      {step === 'usage' && <div className="wizard-step">
        <div className="wizard-step-head"><p className="eyebrow">STEP 2 / HOW YOU WILL USE IT</p><h2>选择使用方式</h2></div>
        <div className="wizard-options" role="radiogroup" aria-label="使用方式">
          <button role="radio" aria-checked={usage === 'web'} className={usage === 'web' ? 'selected' : ''} onClick={() => setUsage('web')}>
            <span className="wizard-option-icon"><Globe size={22} /></span>
            <span><strong>仅使用网页</strong><small>全部功能在浏览器里完成，不需要安装任何其他软件。</small></span>
            <em>默认</em>
          </button>
          <button role="radio" aria-checked={usage === 'obsidian'} className={usage === 'obsidian' ? 'selected' : ''} onClick={() => setUsage('obsidian')}>
            <span className="wizard-option-icon"><Note size={22} /></span>
            <span><strong>同时使用 Obsidian</strong><small>你的 Vault 就是一组 Markdown 文件，可以用 Obsidian 打开同一个目录。</small></span>
            <em>可选</em>
          </button>
        </div>
        <p className="wizard-hint">这里的 Obsidian 只是一个可选开关，而不是必须安装的前置条件。</p>
        <div className="wizard-actions"><button className="primary-action" onClick={() => setStep('profile')}>下一步 <ArrowRight size={17} /></button><button className="text-button" onClick={() => setStep('space')}>上一步</button></div>
      </div>}

      {step === 'profile' && <div className="wizard-step">
        <div className="wizard-step-head"><p className="eyebrow">STEP 3 / BUILD YOUR PROFILE</p><h2>开始建立个人档案</h2></div>
        <button className="wizard-start" onClick={onStartProfile}>
          <span className="wizard-start-icon"><Sparkle size={22} weight="duotone" /></span>
          <span><strong>开始了解我</strong><small>通过轻量对话逐步建立个人信息。每一条回答都会先成为候选记忆，由你确认后才进入正式档案。</small></span>
          <ArrowRight size={20} />
        </button>
        {usage === 'obsidian' && <p className="wizard-hint">想用 Obsidian 的话，在设置里用「备份与恢复」查看 Vault 位置，再用 Obsidian 打开同一个文件夹即可。</p>}
        <div className="wizard-actions"><button className="primary-action" onClick={onStartProfile}>开始了解我 <ArrowRight size={17} /></button><button className="text-button" onClick={() => setStep('usage')}>上一步</button></div>
      </div>}
    </section>
  </main>
}

export function WizardError({ message }: { message: string }) {
  return <ErrorState title="初始化向导暂时不可用" description={message} />
}
