import { useEffect, useState } from 'react'
import { CheckCircle, Eye, ShieldCheck, Warning } from '@phosphor-icons/react'
import type { ApiClient, PendingCall, ProviderAdapterInfo, ProviderAdaptersOverview, ProviderAuthorization, ProviderAudit, ProviderCallResult, ProviderOverview } from './api'

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
  const [adapters, setAdapters] = useState<ProviderAdaptersOverview | null>(null)
  const [connector, setConnector] = useState({ provider: 'local-openai', baseUrl: '', model: '', apiKey: '', timeout: 30 })
  const [approved, setApproved] = useState<{ requestId: string; provider: string; scope: string; payload: Record<string, unknown> }[]>([])
  const [callResult, setCallResult] = useState<ProviderCallResult | null>(null)
  const [calling, setCalling] = useState('')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  async function load() {
    try {
      const [next, log, adapterList] = await Promise.all([client.providers(), client.providerAudit(), client.providerAdapters()])
      setOverview(next); setAudit(log); setPending(next.pending); setAdapters(adapterList)
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
      if (result.decision === 'approved') setApproved((current) => [{ requestId: item.requestId, provider: item.provider, scope: item.scope, payload: item.preview }, ...current].slice(0, 10))
      setMessage({ kind: 'success', text: result.decision === 'approved' ? '调用已批准。模块不会真的发送任何内容。' : '调用已拒绝。' })
      await load()
    } catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : '决策失败。' }) }
    finally { setBusy('') }
  }

  async function configure() {
    if (!connector.baseUrl.trim() || !connector.model.trim()) return
    setBusy('configure'); setMessage(null); setCallResult(null)
    try {
      await client.configureProvider(connector.provider, connector.baseUrl.trim(), connector.model.trim(), connector.apiKey, connector.timeout)
      setConnector((current) => ({ ...current, baseUrl: '', model: '', apiKey: '' }))
      setMessage({ kind: 'success', text: '连接器已配置。API Key 只保留在本地服务内存中。' })
      await load()
    } catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : '配置失败。' }) }
    finally { setBusy('') }
  }

  async function removeConnector(item: ProviderAdapterInfo) {
    setBusy(`config:${item.provider}`); setMessage(null)
    try { await client.removeProviderConfig(item.provider); setMessage({ kind: 'success', text: '连接器已移除，内存中的 API Key 已清除。' }); await load() }
    catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : '移除失败。' }) }
    finally { setBusy('') }
  }

  async function callApproved(item: { requestId: string; provider: string }) {
    setCalling(item.requestId); setMessage(null); setCallResult(null)
    try {
      const result = await client.callProvider(item.provider, item.requestId)
      setCallResult(result)
      if (!result.ok) setMessage({ kind: 'error', text: result.error ?? '调用失败。' })
      await load()
    } catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : '调用失败。' }) }
    finally { setCalling('') }
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

    <section className="provider-panel">
      <header><p className="eyebrow">CONNECTORS / REAL CALLS</p><h3>连接器</h3></header>
      <div className="provider-field-row">
        <label className="provider-field">Provider 类型<select aria-label="Provider 类型" value={connector.provider} onChange={(event) => setConnector((current) => ({ ...current, provider: event.target.value, baseUrl: adapters?.defaultBaseUrls[event.target.value] ?? '' }))}>{Object.entries(adapters?.providers ?? {}).map(([key, label]) => <option key={key} value={key}>{key} — {label}</option>)}</select></label>
        <label className="provider-field">Model<input aria-label="连接器 Model" value={connector.model} onChange={(event) => setConnector((current) => ({ ...current, model: event.target.value }))} placeholder="例如 llama3" /></label>
      </div>
      <label className="provider-field">Base URL<input aria-label="连接器 Base URL" value={connector.baseUrl} onChange={(event) => setConnector((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="例如 http://127.0.0.1:11434" /></label>
      <label className="provider-field">API Key（可选，仅内存）<input aria-label="连接器 API Key" type="password" value={connector.apiKey} onChange={(event) => setConnector((current) => ({ ...current, apiKey: event.target.value }))} placeholder="本地端点通常不需要" /></label>
      <button className="primary-action" onClick={() => void configure()} disabled={Boolean(busy) || !connector.baseUrl.trim() || !connector.model.trim()}>配置连接器</button>
      {adapters?.configured.length ? <ul className="provider-list">{adapters.configured.map((item) => <li key={item.provider}>
        <div><strong>{item.provider}</strong><small>{item.baseUrl} · {item.model}{item.hasApiKey ? ' · 已配置 Key' : ' · 无 Key'}</small></div>
        <button className="text-button" onClick={() => removeConnector(item)} disabled={Boolean(busy)}>移除</button>
      </li>)}</ul> : <p className="muted">还没有配置连接器。没有连接器就不会发起任何外部调用。</p>}
    </section>

    <section className="provider-panel">
      <header><p className="eyebrow">APPROVED CALLS / SEND</p><h3>已批准的调用</h3></header>
      {!approved.length ? <p className="muted">批准一次预览后，这里会出现可发送的请求。</p> : <ul className="provider-list">{approved.map((item) => <li key={item.requestId}>
        <div><strong>{item.provider}</strong><small>{item.scope} · {Object.keys(item.payload).join(', ') || '（空）'}</small></div>
        <button className="primary-action" onClick={() => void callApproved(item)} disabled={Boolean(calling) || !adapters?.configured.some((config) => config.provider === item.provider)}>{calling === item.requestId ? '正在调用…' : '调用 Provider'}</button>
      </li>)}</ul>}
      {callResult && <div className={`backup-message ${callResult.ok ? 'success' : 'error'}`} role="status">{callResult.ok ? <CheckCircle /> : <Warning />}<span>{callResult.ok ? `${callResult.model ?? 'Provider'}：${callResult.text}` : `调用失败：${callResult.error}`}</span></div>}
      <small>只有已配置连接器且已批准的请求才能发送；外部失败不会影响本地档案。</small>
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
