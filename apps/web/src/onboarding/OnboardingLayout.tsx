import type { ReactNode } from 'react'
import { ArrowLeft } from '@phosphor-icons/react'
import { ONBOARDING_STEPS, type OnboardingStep } from './OnboardingState'

const labels: Record<OnboardingStep, string> = { welcome: '欢迎', vault: '个人空间', import: '导入知识', choice: '你的控制权', conversation: '建立档案', review: '审核记忆', complete: '完成' }

type Props = { step: OnboardingStep; title: string; description: string; children: ReactNode; onBack?: () => void; restored?: boolean }

export default function OnboardingLayout({ step, title, description, children, onBack, restored }: Props) {
  const index = ONBOARDING_STEPS.indexOf(step)
  return <main className="first-run-shell" aria-label="NEXORA 首次启动">
    <header className="first-run-chrome">
      <div className="first-run-brand"><span className="first-run-mark">N</span><span><strong>NEXORA</strong><small>PERSONAL INTELLIGENCE</small></span></div>
      <div className="first-run-progress" aria-label={`第 ${index + 1} 步，共 ${ONBOARDING_STEPS.length} 步`}><span>{String(index + 1).padStart(2, '0')}</span><i /><span>{String(ONBOARDING_STEPS.length).padStart(2, '0')}</span><em>{labels[step]}</em></div>
    </header>
    <section key={step} className={`first-run-page first-run-step-${step}`} data-step={step}>
      <header className="first-run-heading">
        {onBack && <button className="first-run-back" onClick={onBack}><ArrowLeft size={18} />上一步</button>}
        <p className="first-run-kicker">NEXORA FIRST-RUN</p><h1>{title}</h1><p>{description}</p>
        {restored && <p className="first-run-restored" role="status">已恢复到你上次中断的位置。未提交的回答没有被保存。</p>}
      </header>
      <div className="first-run-content">{children}</div>
    </section>
  </main>
}
