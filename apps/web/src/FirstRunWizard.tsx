import type { ApiClient } from './api'
import OnboardingRouter from './onboarding/OnboardingRouter'

type Props = { client: ApiClient; vaultName: string; onFinish: (destination: 'overview' | 'review') => void }

/** First-run is mounted before the Workspace shell and owns its route, layout and state. */
export default function FirstRunWizard(props: Props) {
  return <OnboardingRouter {...props} />
}
