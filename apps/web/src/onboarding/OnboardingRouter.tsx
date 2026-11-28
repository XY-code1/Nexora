import { useEffect, useMemo, useState } from 'react'
import type { ApiClient, Memory, OnboardingState, RegisteredVault } from '../api'
import { vaultHint } from '../vaultHints'
import OnboardingLayout from './OnboardingLayout'
import ImportFlow from '../components/ImportFlow'
import { clearOnboardingDraft, onboardingHash, ONBOARDING_STEPS, persistOnboardingPreferences, persistOnboardingStep, readOnboardingPreferences, readOnboardingStep, stepFromHash, type OnboardingPreferences, type OnboardingStep } from './OnboardingState'
import { CompleteStep, ConversationStep, DataChoiceStep, MemoryReviewStep, VaultStep, WelcomeStep } from './steps'

type Props = { client: ApiClient; vaultName: string; onFinish: (destination: 'overview' | 'review') => void }
const copy: Record<OnboardingStep, { title: string; description: string }> = {
  welcome: { title: '欢迎来到 NEXORA', description: '一个由你掌控、在本地持续成长的个人智能空间。' },
  vault: { title: '创建或连接个人空间', description: 'Vault 是你的数据主体。创建新空间，或安全连接已有空间。' },
  import: { title: '导入你的第一份知识', description: '选择 Markdown、JSON 或纯文本文件。所有内容先进入预览，再由你决定是否创建候选记忆。' },
  choice: { title: '你的数据，你的选择', description: '本地是默认状态。编辑器、备份与 AI 连接始终由你决定。' },
  conversation: { title: '让 NEXORA 逐步了解你', description: '每次只回答一个问题，也可以随时跳过或稍后继续。' },
  review: { title: '决定哪些内容成为正式记忆', description: '只有你的确认才能改变正式档案。' },
  complete: { title: '你的个人空间已经准备好', description: '从这里开始，在明确的授权边界内长期使用 NEXORA。' },
}

export default function OnboardingRouter({ client, vaultName, onFinish }: Props) {
  const initial = useMemo(() => stepFromHash(window.location.hash) ?? readOnboardingStep(), [])
  const [step, setStep] = useState<OnboardingStep>(initial)
  const [preferences, setPreferences] = useState<OnboardingPreferences>(readOnboardingPreferences)
  const [restored] = useState(initial !== 'welcome')
  const [activeVaultName, setActiveVaultName] = useState(vaultName)
  const [registered, setRegistered] = useState<RegisteredVault[]>([])
  const [currentVaultId, setCurrentVaultId] = useState('')
  const [defaultPath, setDefaultPath] = useState('')
  const [conversation, setConversation] = useState<OnboardingState | null>(null)
  const [candidates, setCandidates] = useState<Memory[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { history.replaceState(null, '', onboardingHash(step)); persistOnboardingStep(step); scrollTo(0, 0) }, [step])
  useEffect(() => { persistOnboardingPreferences(preferences) }, [preferences])
  useEffect(() => { void Promise.allSettled([client.vaultStatus(), client.registeredVaults(), client.vaultDefaultPath()]).then(([status, vaults, path]) => {
    if (status.status === 'fulfilled') { setCurrentVaultId(status.value.vaultId); setActiveVaultName(status.value.displayName) }
    if (vaults.status === 'fulfilled' && Array.isArray(vaults.value)) setRegistered(vaults.value)
    if (path.status === 'fulfilled') setDefaultPath(path.value.path)
  }) }, [client])

  function go(next: OnboardingStep) { setError(''); setStep(next) }
  function back() { const index = ONBOARDING_STEPS.indexOf(step); if (index > 0) go(ONBOARDING_STEPS[index - 1]) }

  useEffect(() => {
    if (step === 'conversation' && !conversation) { setLoading(true); void client.onboarding().then(setConversation).catch((reason) => setError(reason instanceof Error ? reason.message : '暂时无法读取建档问题。')).finally(() => setLoading(false)) }
    if (step === 'review') { setLoading(true); void client.listCandidates().then(setCandidates).catch((reason) => setError(reason instanceof Error ? reason.message : '暂时无法读取候选记忆。')).finally(() => setLoading(false)) }
  }, [client, conversation, step])

  async function finish(destination: 'overview' | 'review') {
    setLoading(true); setError('')
    try { await client.markInitialized(); clearOnboardingDraft(); onFinish(destination) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '初始化状态未能保存，请重试。') }
    finally { setLoading(false) }
  }

  return <OnboardingLayout step={step} {...copy[step]} onBack={step === 'welcome' ? undefined : back} restored={restored}>
    {error && <p className="first-run-error" role="alert">{vaultHint(error)}</p>}
    {step === 'welcome' && <WelcomeStep onContinue={() => go('vault')} />}
    {step === 'vault' && <VaultStep client={client} currentName={activeVaultName} currentVaultId={currentVaultId} registered={registered} defaultPath={defaultPath} busy={loading} onBusy={setLoading} onError={setError} onReady={setActiveVaultName} onContinue={() => go('import')} />}
    {step === 'import' && <ImportFlow client={client} context="onboarding" onSkip={() => go('choice')} onContinue={() => go('choice')} />}
    {step === 'choice' && <DataChoiceStep value={preferences} onChange={setPreferences} onContinue={() => go('conversation')} />}
    {step === 'conversation' && <ConversationStep client={client} value={conversation} loading={loading} preferredTopic={preferences.topic} onTopic={(topic) => setPreferences((value) => ({ ...value, topic }))} onValue={setConversation} onError={setError} onContinue={() => go('review')} />}
    {step === 'review' && <MemoryReviewStep client={client} value={candidates} loading={loading} onValue={setCandidates} onError={setError} onContinue={() => go('complete')} />}
    {step === 'complete' && <CompleteStep vaultName={activeVaultName} pending={candidates.length} busy={loading} onFinish={finish} />}
  </OnboardingLayout>
}
