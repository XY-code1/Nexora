import { useEffect, useState } from 'react'
import { CheckCircle, Eye, ShieldCheck, Warning } from '@phosphor-icons/react'
import type { ApiClient, PendingCall, ProviderAuthorization, ProviderAudit, ProviderOverview } from './api'

type Props = { client: ApiClient }

export default function ProviderAuthPage({ client }: Props) {
  const [overview, setOverview] = useState<ProviderOverview | null>(null)
  const [audit, setAudit] = useState<ProviderAudit | null>(null)
  const [provider, setProvider] = useState('')
  const [scopes, setScopes] = useState<string[]>([])
  const [previewProvider, setPreviewProvider] = useState('')
  const [previewScope, setPreviewScope] = useState('')
  const [context, setContext] = useState('{\n  "summary": "这个月我更关注节奏。",\n  "dimension": "mind"\n}')
  const [pending, setPending] = useState<PendingCall[]>([])
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  async function load() {
    try {
      const [next, log] = await Promise.all([client.providers(), client.providerAudit()])
      setOverview(next); setAudit(log); setPending(next.pending)
    } catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : '无法读取 Provider 状态。' }) }
  }

  useEffect(() => { void load() }, [client])

  function toggleScope(scope: string) {
    setScopes((current) => current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope])
  }

  async function authorize() {
    if (!provider.trim() || !scopes.length) return
    setBusy('authorize'); setMessage(null)
    try {
      await client.authorizeProvider(provider.trim(), scopes)
      setProvider(''); setScopes([])
      setMessage({ kind: 'success', text: 'Provider 已授权。授权只记录在本地，不会发送任何内容。' })
      await load()
    } catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : '授权失败。' }) }
    finally { setBusy('') }
  }

  async function revoke(item: ProviderAuthorization) {
    if (!window.confirm(`撤销 Provider「${item.provider}」的授权？调用审计会保留。`)) return
    setBusy(`revoke:${item.provider}`); setMessage(null)
    try { await client.revokeProvider(item.provider); setMessage({ kind: 'success', text: '授权已撤销。' }); await load() }
    catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : '撤销失败。' }) }
    finally { setBusy('') }
  }

  async function preview() {
    setBusy('preview'); setMessage(null)
    try {
      const parsed = JSON.parse(context)
      const result = await client.previewProviderCall(previewProvider.trim(), previewScope, parsed)
      setPending((current) => [result, ...current])
      setMessage({ kind: 'success', text: `已生成预览：${result.droppedFields.length} 个字段被最小化丢弃。` })
    } catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : '预览失败。' }) }
    finally { setBusy('') }
  }

  async function decide(item: PendingCall, action: 'approve' | 'deny') {
    setBusy(`decide:${item.requestId}`); setMessage(null)
    try {
      const result = await client.decideProviderCall(item.requestId, action, action === 'deny' ? 'user-rejected' : '')
      setPending((current) => current.filter((call) => call.requestId !== item.requestId))
      setMessage({ kind: 'success', text: result.decision === 'approved' ? '调用已批准。模块不会真的发送任何内容。' : '调用已拒绝。' })
      await load()
    } catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : '决策失败。' }) }
    finally { setBusy('') }
  }

  const knownScopes = overview?.scopes ?? {}

  return <section className="provider-page">
    <header className="backup-heading compact-heading">
      <div><p className="eyebrow">AI PROVIDER / EXPLICIT AUTHORIZATION</p><p>按 Scope 授权外部 AI Provider，逐次预览并批准调用。模块不连接任何外部服务，也不会自动发送内容。</p></div>
      <span className="boundary-badge"><ShieldCheck size={18} />不自动发送</span>
    </header>

    {message && <div className={`backup-message ${message.kind}`} role="status">{message.kind === 'success' ? <CheckCircle /> : <Warning />}<span>{message.text}</span></div>}

    <section className="provider-layout">
      <section className="provider-panel">
        <header><p className="eyebrow">AUTHORIZED PROVIDERS</p><h3>已授权 Provider</h3></header>
        {overview?.providers.length ? <ul className="provider-list">{overview.providers.map((item) => <li key={item.provider}>
          <div><strong>{item.provider}</strong><small>{item.scopes.join(' · ')}</small></div>
          <button className="text-button" onClick={() => revoke(item)} disabled={Boolean(busy)}>撤销</button>
        </li>)}</ul> : <p className="muted">还没有授权任何 Provider。没有授权就没有调用。</p>}

        <header><p className="eyebrow">AUTHORIZE</p><h3>新增授权</h3></header>
        <label className="provider-field">Provider 名称<input aria-label="Provider 名称" value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="例如 local-llm" /></label>
        <div className="provider-scopes" role="group" aria-label="授权 Scope">
          {Object.keys(knownScopes).map((scope) => <label key={scope} className="provider-scope"><input type="checkbox" checked={scopes.includes(scope)} onChange={() => toggleScope(scope)} /><span><strong>{scope}</strong><small>{knownScopes[scope].join(', ')}</small></span></label>)}
        </div>
        <button className="primary-action" onClick={() => void authorize()} disabled={Boolean(busy) || !provider.trim() || !scopes.length}>授权 Provider</button>
      </section>

      <section className="provider-panel">
        <header><p className="eyebrow">CALL PREVIEW / DATA MINIMIZATION</p><h3>逐次预览</h3></header>
        <div className="provider-field-row">
          <label className="provider-field">Provider<input aria-label="预览 Provider" value={previewProvider} onChange={(event) => setPreviewProvider(event.target.value)} placeholder="例如 local-llm" /></label>
          <label className="provider-field">Scope<select aria-label="预览 Scope" value={previewScope} onChange={(event) => setPreviewScope(event.target.value)}><option value="">选择 Scope</option>{Object.keys(knownScopes).map((scope) => <option key={scope} value={scope}>{scope}</option>)}</select></label>
        </div>
        <label className="provider-field">调用内容（JSON）<textarea aria-label="调用内容" value={context} onChange={(event) => setContext(event.target.value)} spellCheck={false} /></label>
        <button className="secondary-action" onClick={() => void preview()} disabled={Boolean(busy) || !previewProvider.trim() || !previewScope}><Eye size={16} />生成最小化预览</button>

        {pending.length > 0 && <div className="provider-pending">
          <p className="eyebrow">PENDING APPROVAL</p>
          {pending.map((item) => <div key={item.requestId} className="provider-pending-item">
            <div><strong>{item.provider}</strong><small>{item.scope} · {Object.keys(item.preview).join(', ') || '（空）'}</small></div>
            <div className="provider-pending-actions">
              <button className="primary-action" onClick={() => void decide(item, 'approve')} disabled={Boolean(busy)}>批准</button>
              <button className="secondary-action" onClick={() => void decide(item, 'deny')} disabled={Boolean(busy)}>拒绝</button>
            </div>
          </div>)}
        </div>}
      </section>
    </section>

    <section className="provider-audit">
      <header><div><p className="eyebrow">CALL AUDIT / APPEND ONLY</p><h3>调用审计</h3></div><span>{audit?.integrity.status ?? '—'} · {audit?.integrity.events ?? 0} events</span></header>
      {audit?.items.length ? <ul className="provider-audit-list">{audit.items.map((item) => <li key={item.eventId}>
        <span className={`provider-result ${item.result}`}>{item.result}</span>
        <div><strong>{item.details.provider || '—'}</strong><small>{item.scope} · {item.details.fieldCount} fields · {item.details.droppedFields.length} dropped</small></div>
        <time>{item.timestamp}</time>
      </li>)}</ul> : <p className="muted">还没有调用记录。</p>}
    </section>
  </section>
}
