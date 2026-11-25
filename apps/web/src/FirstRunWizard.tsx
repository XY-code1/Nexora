import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, FolderOpen, FolderPlus, GithubLogo, Globe, Note, Sparkle, Trash } from '@phosphor-icons/react'
import type { ApiClient, OnboardingState, RegisteredVault } from './api'
import ConversationalOnboardingPage from './ConversationalOnboardingPage'
import { vaultHint } from './vaultHints'
import onboardingOrb from './assets/onboarding-intelligence-orb.webp'
import { useT } from './i18n'

function joinPath(base: string, name: string) {
  return `${base.replace(/[\\/]+$/, '')}/${name.replace(/^[\\/]+/, '')}`
}

const TOTAL_STEPS = 5
const STEP_KEY = 'nexora.onboarding.step'
const USAGE_KEY = 'nexora.onboarding.usage'
const GITHUB_KEY = 'nexora.onboarding.github-backup'
const STEP_ITEMS = ['wizard.stepWelcome', 'wizard.stepSpace', 'wizard.stepData', 'wizard.stepMemory', 'wizard.stepDone']

function readStep(): number {
  try {
    const value = Number(localStorage.getItem(STEP_KEY))
    return value >= 1 && value <= TOTAL_STEPS ? value : 1
  } catch {
    return 1
  }
}

function readUsage(): 'web' | 'obsidian' {
  try { return localStorage.getItem(USAGE_KEY) === 'obsidian' ? 'obsidian' : 'web' } catch { return 'web' }
}

function readGithubPreference(): boolean {
  try { return localStorage.getItem(GITHUB_KEY) === 'true' } catch { return false }
}

type Props = { client: ApiClient; vaultName: string; onFinish: (destination: 'overview' | 'review') => void }

/**
 * 分步首次启动引导（issue #63）：
 * 1) 创建/连接个人空间；2) 用简洁语言说明本地优先的数据归属；
 * 3) 创建第一条候选记忆；4) 完成页给出明确的下一步入口。
 * 进度写入本机，中断后可从上次步骤继续；完成时才标记已初始化，已有用户不会被重复引导。
 */
export default function FirstRunWizard({ client, vaultName, onFinish }: Props) {
  const t = useT()
  const [usage, setUsageState] = useState<'web' | 'obsidian'>(readUsage)
  const [githubBackup, setGithubBackupState] = useState(readGithubPreference)
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
  const [step, setStepState] = useState(readStep)
  const [restored] = useState(() => readStep() > 1)

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

  function setStep(next: number) {
    setStepState(next)
    try { localStorage.setItem(STEP_KEY, String(next)) } catch { /* storage unavailable */ }
  }

  function setUsage(next: 'web' | 'obsidian') {
    setUsageState(next)
    try { localStorage.setItem(USAGE_KEY, next) } catch { /* storage unavailable */ }
  }

  function setGithubBackup(next: boolean) {
    setGithubBackupState(next)
    try { localStorage.setItem(GITHUB_KEY, String(next)) } catch { /* storage unavailable */ }
  }

  function startOver() {
    try { localStorage.removeItem(STEP_KEY); localStorage.removeItem(USAGE_KEY); localStorage.removeItem(GITHUB_KEY) } catch { /* ignore */ }
    setUsageState('web'); setGithubBackupState(false); setMode(null); setPath(''); setFolderName(''); setError(''); setDone(''); setStepState(1)
  }

  async function run(action: 'create' | 'connect') {
    const target = path.trim()
    if (!target) { setError(t('wizard.pathRequired')); return }
    setBusy('run'); setError(''); setDone('')
    try {
      const result = action === 'create' ? await client.createVault(target) : await client.validateVault(target)
      setDone(t('wizard.spaceDone', { action: action === 'create' ? t('wizard.created') : t('wizard.connected'), name: result.displayName }))
    } catch (reason) {
      setError(vaultHint(reason instanceof Error ? reason.message : t('wizard.actionFailed')))
    } finally { setBusy('') }
  }

  async function browse() {
    setBusy('browse'); setError('')
    try {
      const result = await client.browseVault()
      setPath(result.path)
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('wizard.browserFailed')) }
    finally { setBusy('') }
  }

  function useRecommended() {
    const name = folderName.trim() || 'my-ai-profile'
    setPath(joinPath(defaultPath || 'C:\\Nexora\\vault', name))
    setError('')
  }

  async function forget(item: RegisteredVault) {
    if (!window.confirm(t('wizard.forgetConfirm', { name: item.displayName }))) return
    setBusy(`forget:${item.vaultId}`); setError('')
    try {
      await client.forgetVault(item.vaultId)
      setRegistered((current) => current.filter((entry) => entry.vaultId !== item.vaultId))
      setDone(t('wizard.forgotten'))
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('wizard.forgetFailed')) }
    finally { setBusy('') }
  }

  async function connect(item: RegisteredVault) {
    setConnecting(item.vaultId); setError(''); setDone('')
    try {
      await client.connectVault(item.vaultId)
      setDone(t('wizard.opening', { name: item.displayName }))
    } catch (reason) {
      setError(vaultHint(reason instanceof Error ? reason.message : t('wizard.connectFailed')))
    } finally { setConnecting('') }
  }

  async function finish(destination: 'overview' | 'review') {
    try { localStorage.removeItem(STEP_KEY) } catch { /* ignore */ }
    try { localStorage.removeItem(USAGE_KEY) } catch { /* ignore */ }
    try { localStorage.removeItem(GITHUB_KEY) } catch { /* ignore */ }
    try { await client.markInitialized() } catch { /* The wizard reappears next time; that does not block usage. */ }
    onFinish(destination)
  }

  async function startInterview() {
    setInterview(true); setInterviewLoading(true); setError('')
    try { setInterviewState(await client.onboarding()) }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('wizard.interviewFailed')) }
    finally { setInterviewLoading(false) }
  }

  async function saveInterview(topic: string, content: string) {
    setBusy('interview'); setError('')
    try { const result = await client.onboardingResponse(topic, content); setInterviewState(result.state); return true }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('wizard.candidateFailed')); return false }
    finally { setBusy('') }
  }

  if (interview) return <main className="wizard wizard-interview" aria-label={t('wizard.interviewLabel')}>
    <header className="wizard-interview-header"><div><p className="wizard-badge"><Sparkle size={14} weight="fill" />{t('wizard.interviewLabel')} · Local only</p><h1>{t('wizard.interviewTitle')}</h1><p>{t('wizard.interviewHint')}</p></div><button className="text-button" onClick={() => { setInterview(false); setStep(5) }}>{t('wizard.finishAndEnter')}</button></header>
    {error && <p className="wizard-error" role="alert">{error}</p>}
    <ConversationalOnboardingPage value={interviewState} loading={interviewLoading} saving={Boolean(busy)} onSave={saveInterview} onReview={() => void finish('review')} />
  </main>

  const stepLabels = STEP_ITEMS.map((key) => t(key))

  return <main className="wizard" aria-label={t('wizard.label')}>
    <header className="wizard-intro">
      <p className="wizard-badge"><Sparkle size={14} weight="fill" />NEXORA 知序 · Onboarding</p>
      <h1>{t('wizard.welcome')}</h1>
      <p>{t('wizard.subtitle')}</p>
      <p className="wizard-note">{t('wizard.vaultNote')}</p>
    </header>

    <figure className="wizard-hero-image">
      <img src={onboardingOrb} alt={t('wizard.orbAlt')} />
      <figcaption><strong>Your Intelligence. Your Data. Your Control.</strong><span>Local-first personal intelligence platform</span></figcaption>
    </figure>

    <ol className="wizard-flow" aria-label={t('wizard.label')}>
      {stepLabels.map((label, index) => {
        const number = index + 1
        const state = number < step ? 'done' : number === step ? 'active' : ''
        return <li key={label} className={`wizard-flow-step ${state}`.trim()} aria-current={number === step ? 'step' : undefined}>
          <span className="wizard-flow-dot">{number < step ? <Check size={13} /> : number}</span>
          <span className="wizard-flow-label">{label}</span>
        </li>
      })}
    </ol>
    {restored && <p className="wizard-progress-note">{t('wizard.progressRestored')}</p>}

    {step === 1 && <section className="wizard-step-panel" aria-labelledby="wizard-welcome-title">
      <header className="wizard-section-head"><span>01</span><div><h2 id="wizard-welcome-title">{t('wizard.stepWelcome')}</h2><p>{t('wizard.subtitle')}</p></div></header>
      <p className="wizard-hint">{t('wizard.vaultNote')}</p>
    </section>}

    {step === 2 && <section className="wizard-step-panel" aria-labelledby="wizard-space-title">
      <header className="wizard-section-head"><span>02</span><div><h2 id="wizard-space-title">{t('wizard.spaceTitle')}</h2><p>{t('wizard.currentSpace', { name: vaultName })}</p></div></header>
      <div className="wizard-space-grid">
        <button className={mode === 'create' ? 'selected' : ''} onClick={() => { setMode('create'); setError(''); setDone('') }}><FolderPlus size={25} /><span><strong>{t('wizard.createNew')}</strong><small>{t('wizard.createNewHint')}</small></span><ArrowRight size={18} /></button>
        <button className={mode === 'connect' ? 'selected' : ''} onClick={() => { setMode('connect'); setError(''); setDone('') }}><FolderOpen size={25} /><span><strong>{t('wizard.connectExisting')}</strong><small>{t('wizard.connectExistingHint')}</small></span><ArrowRight size={18} /></button>
      </div>
      {mode && <div className="wizard-path-row"><label><span>{mode === 'create' ? t('wizard.newVaultPath') : t('wizard.existingVaultPath')}</span><input aria-label={mode === 'create' ? t('wizard.newVaultAria') : t('wizard.existingVaultAria')} value={path} onChange={(event) => { setPath(event.target.value); setError('') }} placeholder={defaultPath || t('wizard.pathPlaceholder')} /></label><button className="secondary-action" onClick={() => void browse()} disabled={Boolean(busy)}>{busy === 'browse' ? t('wizard.openingPicker') : t('wizard.browse')}</button><button className="secondary-action" onClick={() => void run(mode)} disabled={Boolean(busy)}>{busy ? t('wizard.processing') : mode === 'create' ? t('wizard.createVault') : t('wizard.validateConnect')}</button></div>}
      {mode === 'create' && <div className="wizard-path-row"><label><span>{t('wizard.folderName')}</span><input aria-label={t('wizard.folderNameAria')} value={folderName} onChange={(event) => { setFolderName(event.target.value); setError('') }} placeholder="my-ai-profile" /></label><button className="secondary-action" onClick={useRecommended} disabled={Boolean(busy) || !defaultPath}>{t('wizard.useRecommended')}</button></div>}
      {mode === 'create' && folderName.trim() && <p className="wizard-hint">{t('wizard.willCreate', { path: joinPath(defaultPath || 'C:\\Nexora\\vault', folderName.trim()) })}</p>}
      {registered.length > 0 && <div className="wizard-registered">
        <p className="wizard-registered-title">{t('wizard.recentTitle')}</p>
        <div className="wizard-registered-list">
          {registered.map((item) => <div key={item.vaultId} className="wizard-registered-item">
            <button disabled={!item.available || connecting === item.vaultId} onClick={() => void connect(item)}>
              <FolderOpen size={20} />
              <span><strong>{item.displayName}</strong><small>{item.vaultId.slice(0, 18)}</small></span>
              <em>{item.vaultId === currentVaultId ? t('wizard.currentSpaceTag') : item.available ? (connecting === item.vaultId ? t('wizard.openingTag') : t('wizard.openTag')) : t('wizard.missingDir')}</em>
            </button>
            <button className="wizard-forget" onClick={() => void forget(item)} disabled={Boolean(busy)} aria-label={t('wizard.forgetAria', { id: item.vaultId.slice(0, 8) })} title={t('wizard.forgetTitle', { name: item.displayName })}><Trash size={16} /></button>
          </div>)}
        </div>
      </div>}
      {done && <p className="wizard-done" role="status"><Check size={17} />{done}</p>}
      {error && <p className="wizard-error" role="alert">{error}</p>}
    </section>}

    {step === 3 && <section className="wizard-step-panel" aria-labelledby="wizard-data-title">
      <header className="wizard-section-head"><span>03</span><div><h2 id="wizard-data-title">{t('wizard.dataTitle')}</h2><p>{t('wizard.dataDetail')}</p></div></header>
      <div className="wizard-data-points">
        <div className="wizard-data-point"><strong>{t('wizard.dataPoint1Title')}</strong><small>{t('wizard.dataPoint1Detail')}</small></div>
        <div className="wizard-data-point"><strong>{t('wizard.dataPoint2Title')}</strong><small>{t('wizard.dataPoint2Detail')}</small></div>
        <div className="wizard-data-point"><strong>{t('wizard.dataPoint3Title')}</strong><small>{t('wizard.dataPoint3Detail')}</small></div>
      </div>
      <div className="wizard-options" role="radiogroup" aria-label={t('wizard.usageLabel')}>
        <button role="radio" aria-checked={usage === 'web'} className={usage === 'web' ? 'selected' : ''} onClick={() => setUsage('web')}><Globe size={23} /><span><strong>{t('wizard.webOnly')}</strong><small>{t('wizard.webOnlyHint')}</small></span><em>{t('wizard.webDefault')}</em></button>
        <button role="radio" aria-checked={usage === 'obsidian'} className={usage === 'obsidian' ? 'selected' : ''} onClick={() => setUsage('obsidian')}><Note size={23} /><span><strong>{t('wizard.withObsidian')}</strong><small>{t('wizard.withObsidianHint')}</small></span><em>{t('wizard.obsidianOptional')}</em></button>
      </div>
      <div className="wizard-options">
        <button aria-pressed={githubBackup} className={githubBackup ? 'selected' : ''} onClick={() => setGithubBackup(!githubBackup)}><GithubLogo size={23} /><span><strong>{t('wizard.githubOptional')}</strong><small>{t('wizard.githubOptionalHint')}</small></span><em>{t('wizard.obsidianOptional')}</em></button>
      </div>
      <p className="wizard-hint">{t('wizard.usageHint')}</p>
    </section>}

    {step === 4 && <section className="wizard-step-panel" aria-labelledby="wizard-profile-title">
      <header className="wizard-section-head"><span>04</span><div><h2 id="wizard-profile-title">{t('wizard.profileTitle')}</h2><p>{t('wizard.profileHint')}</p></div></header>
      <div className="wizard-final-actions"><button className="primary-action" onClick={() => void startInterview()}>{t('wizard.startInterview')} <ArrowRight size={17} /></button><button className="text-button" onClick={() => setStep(5)}>{t('wizard.skipInterview')}</button></div>
    </section>}

    {step === 5 && <section className="wizard-step-panel" aria-labelledby="wizard-done-title">
      <header className="wizard-section-head"><span>05</span><div><h2 id="wizard-done-title">{t('wizard.doneTitle')}</h2><p>{t('wizard.doneDetail')}</p></div></header>
      <div className="wizard-data-points">
        <div className="wizard-data-point"><strong>{t('wizard.dataPoint1Title')}</strong><small>{t('wizard.dataPoint1Detail')}</small></div>
        <div className="wizard-data-point"><strong>{t('wizard.dataPoint3Title')}</strong><small>{t('wizard.dataPoint3Detail')}</small></div>
      </div>
      <div className="wizard-final-actions"><button className="primary-action" onClick={() => void finish('overview')}>{t('wizard.goOverview')}</button><button className="secondary-action" onClick={() => void finish('review')}>{t('wizard.goReview')}</button></div>
    </section>}

    <div className="wizard-nav-row">
      <button className="secondary-action" onClick={() => setStep(Math.max(1, step - 1))} disabled={step === 1}><ArrowLeft size={16} />{t('wizard.back')}</button>
      <button className="text-button" onClick={startOver}>{t('wizard.startOver')}</button>
      {step < TOTAL_STEPS
        ? <button className="primary-action" onClick={() => setStep(Math.min(TOTAL_STEPS, step + 1))}>{t('wizard.next')} <ArrowRight size={16} /></button>
        : <button className="primary-action" onClick={() => void finish('overview')}>{t('wizard.goOverview')}</button>}
    </div>
  </main>
}
