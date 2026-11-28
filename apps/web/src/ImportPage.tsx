import { CheckCircle } from '@phosphor-icons/react'
import type { ApiClient } from './api'
import ImportFlow from './components/ImportFlow'
import { useT } from './i18n'

export default function ImportPage({ client }: { client: ApiClient }) {
  const t = useT()
  return <section className="import-page">
    <header className="backup-heading compact-heading">
      <div><p className="eyebrow">IMPORT / CANDIDATE REVIEW</p><p>{t('import.heading')}</p></div>
      <span className="boundary-badge"><CheckCircle size={18} />{t('import.noAutoConfirm')}</span>
    </header>
    <ImportFlow client={client} />
  </section>
}
