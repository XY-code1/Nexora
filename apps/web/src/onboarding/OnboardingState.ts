export const ONBOARDING_STEPS = ['welcome', 'vault', 'import', 'choice', 'conversation', 'review', 'complete'] as const
export type OnboardingStep = typeof ONBOARDING_STEPS[number]

const STEP_KEY = 'nexora.onboarding.step.v2'
const USAGE_KEY = 'nexora.onboarding.usage'
const GITHUB_KEY = 'nexora.onboarding.github-backup'
const TOPIC_KEY = 'nexora.onboarding.topic'

export type OnboardingPreferences = { usage: 'web' | 'obsidian'; githubBackup: boolean; topic: string }

export function readOnboardingStep(): OnboardingStep {
  try {
    const stored = localStorage.getItem(STEP_KEY)
    return ONBOARDING_STEPS.includes(stored as OnboardingStep) ? stored as OnboardingStep : 'welcome'
  } catch { return 'welcome' }
}

export function readOnboardingPreferences(): OnboardingPreferences {
  try {
    return {
      usage: localStorage.getItem(USAGE_KEY) === 'obsidian' ? 'obsidian' : 'web',
      githubBackup: localStorage.getItem(GITHUB_KEY) === 'true',
      topic: localStorage.getItem(TOPIC_KEY) ?? '',
    }
  } catch { return { usage: 'web', githubBackup: false, topic: '' } }
}

export function persistOnboardingStep(step: OnboardingStep) {
  try { localStorage.setItem(STEP_KEY, step) } catch { /* storage is optional */ }
}

export function persistOnboardingPreferences(value: OnboardingPreferences) {
  try {
    localStorage.setItem(USAGE_KEY, value.usage)
    localStorage.setItem(GITHUB_KEY, String(value.githubBackup))
    if (value.topic) localStorage.setItem(TOPIC_KEY, value.topic)
    else localStorage.removeItem(TOPIC_KEY)
  } catch { /* storage is optional */ }
}

export function clearOnboardingDraft() {
  try {
    for (const key of [STEP_KEY, USAGE_KEY, GITHUB_KEY, TOPIC_KEY, 'nexora.onboarding.step']) localStorage.removeItem(key)
  } catch { /* storage is optional */ }
}

export function stepFromHash(hash: string): OnboardingStep | null {
  const match = hash.match(/^#\/onboarding\/([a-z-]+)$/)
  return match && ONBOARDING_STEPS.includes(match[1] as OnboardingStep) ? match[1] as OnboardingStep : null
}

export const onboardingHash = (step: OnboardingStep) => `#/onboarding/${step}`
