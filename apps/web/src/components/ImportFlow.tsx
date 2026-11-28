import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle, CloudArrowUp, Warning } from '@phosphor-icons/react'
import type { ApiClient, ImportPreview, ImportResult } from '../api'
import { useT } from '../i18n'
import { StateBlock } from './StateBlocks'

type Format = 'markdown' | 'json'
type Props = { client: ApiClient; context?: 'workspace' | 'onboarding'; onContinue?: () => void; onSkip?: () => void }

function sampleContent(format: Format, t: (key: string) => string): string {
  return format === 'markdown' ? t('import.sampleMd') : t('import.sampleJson')
}

export default function ImportFlow({ client, context = 'workspace', onContinue, onSkip }: Props) {
  const t = useT()
  const [format, setFormat] = useState<Format>('markdown')
  const [content, setContent] = useState('')
  const [source, setSource] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [result, setResult] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const labels = { ready: t('import.statusReady'), duplicate: t('import.statusDuplicate'), invalid: t('import.statusInvalid') } as const

  function reset() { setPreview(null); setResult(null); setSelected(new Set()); setError('') }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      setContent(await file.text())
      setFormat(file.name.toLowerCase().endsWith('.json') ? 'json' : 'markdown')
      reset()
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('import.readFailed')) }
  }

  async function runPreview() {
    setBusy('preview'); setError(''); setResult(null)
    try {
      const next = await client.importPreview(format, content)
      setPreview(next)
      setSelected(new Set(next.items.filter((item) => item.status === 'ready').map((item) => item.index)))
    } catch (reason) { setError(reason instanceof Error ? reason.message : t('import.parseFailed')) }
    finally { setBusy('') }
  }

  function toggle(index: number) {
    setSelected((current) => { const next = new Set(current); if (next.has(index)) next.delete(index); else next.add(index); return next })
  }

  async function runImport() {
    if (!preview) return
    const items = preview.items.filter((item) => selected.has(item.index) && item.status === 'ready')
    if (!items.length) return
    setBusy('commit'); setError('')
    try { setResult(await client.importCommit(items.map((item) => ({ type: item.type, subject: item.subject, content: item.content })), source.trim() || 'local-import')) }
    catch (reason) { setError(reason instanceof Error ? reason.message : t('import.importFailed')) }
    finally { setBusy('') }
  }

  const readyItems = preview?.items.filter((item) => item.status === 'ready') ?? []
  const selectedCount = readyItems.filter((item) => selected.has(item.index)).length

  return <div className={`import-flow import-flow-${context}`}>
    {error && <div className="backup-message error" role="alert"><Warning /><span>{error}</span><button className="text-button" onClick={() => setError('')}>{t('import.dismissError')}</button></div>}
    {!result && <>
      <section className="import-input" aria-label={t('import.inputLabel')}>
        <div className="import-formats" role="group" aria-label={t('import.formatLabel')}>{(['markdown', 'json'] as Format[]).map((key) => <button key={key} className={format === key ? 'active' : ''} aria-pressed={format === key} onClick={() => { setFormat(key); reset() }}>{key === 'markdown' ? 'Markdown' : 'JSON'}</button>)}</div>
        <label className="import-source">{t('import.sourceLabel')}<input aria-label={t('import.sourceAria')} value={source} onChange={(event) => { setSource(event.target.value); reset() }} placeholder={t('import.sourcePlaceholder')} /></label>
        <textarea aria-label={t('import.contentAria')} value={content} onChange={(event) => { setContent(event.target.value); reset() }} placeholder={format === 'markdown' ? t('import.contentPlaceholderMd') : t('import.contentPlaceholderJson')} spellCheck={false} />
        <div className="import-actions"><button className="secondary-action" onClick={() => fileRef.current?.click()} disabled={Boolean(busy)}><CloudArrowUp size={16} />{t('import.chooseFile')}</button>{context === 'workspace' && <button className="text-button" onClick={() => { setContent(sampleContent(format, t)); reset() }} disabled={Boolean(busy)}>{t('import.fillSample')}</button>}<button className="primary-action" onClick={() => void runPreview()} disabled={Boolean(busy) || !content.trim()}>{busy === 'preview' ? t('import.parsing') : t('import.preview')}</button></div>
        <input ref={fileRef} type="file" accept=".md,.markdown,.json,.txt" className="sr-only" onChange={(event) => void handleFile(event)} />
      </section>
      {preview && <section className="import-preview" aria-label={t('import.previewLabel')}>
        <header><div><p className="eyebrow">PREVIEW / CONFIRM REQUIRED</p><h3>{t('import.confirmTitle')}</h3></div><span>{t('import.readyCount', { ready: preview.summary.ready, total: preview.summary.total })}</span></header>
        <p className="import-hint">{t('import.hint')}</p>
        <ul className="import-list">{preview.items.map((item) => <li key={item.index} className={`import-item status-${item.status}`}><label className="import-check"><input type="checkbox" checked={item.status === 'ready' && selected.has(item.index)} disabled={item.status !== 'ready'} onChange={() => toggle(item.index)} aria-label={t('import.selectItem', { index: item.index + 1 })} /></label><div className="import-item-body"><div className="import-item-head"><span className="import-type">{item.type}</span>{item.subject && <strong>{item.subject}</strong>}<span className={`import-status import-status-${item.status}`}>{labels[item.status]}</span></div><p className="import-preview-text">{item.preview}</p>{item.reason && <p className="import-reason">{item.reason}</p>}</div></li>)}</ul>
        <div className="import-actions"><button className="text-button" onClick={reset} disabled={Boolean(busy)}><ArrowLeft size={16} />{t('import.backToEdit')}</button><button className="primary-action" onClick={() => void runImport()} disabled={Boolean(busy) || !selectedCount}>{busy === 'commit' ? t('import.importing') : t('import.commit', { count: selectedCount })}</button></div>
      </section>}
      {context === 'onboarding' && !preview && <div className="first-run-import-skip"><button className="first-run-text" disabled={Boolean(busy)} onClick={onSkip}>{t('import.skipForNow')}</button></div>}
    </>}
    {result && <section className="import-result" aria-label={t('import.resultLabel')}>
      <StateBlock tone="success" icon={<CheckCircle size={22} />} title={t('import.doneTitle', { count: result.created.length })} description={t('import.doneDetail')} />
      {result.skipped.length > 0 && <div className="import-skipped"><h4>{t('import.skippedTitle', { count: result.skipped.length })}</h4><ul>{result.skipped.map((item, index) => <li key={index}><span className="import-type">{item.type}</span>{item.subject && <strong>{item.subject}</strong>}<span>{item.reason}</span></li>)}</ul></div>}
      <div className="import-actions"><button className="secondary-action" onClick={() => { reset(); setContent(''); setSource('') }}>{t('import.continue')}</button><button className="primary-action" onClick={onContinue ?? (() => { window.location.hash = '#/memory-review' })}>{context === 'onboarding' ? t('import.continueSetup') : t('import.goReview')}<ArrowRight size={16} /></button></div>
    </section>}
  </div>
}
