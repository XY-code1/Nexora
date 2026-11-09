import { useEffect, useState } from 'react'
import { CheckCircle, Eye, ShieldCheck, Trash, Warning } from '@phosphor-icons/react'
import type { ApiClient, GitHubConnection, GitHubDeviceCode, GitHubRepository, GitHubStatus } from './api'

type Props = { client: ApiClient }

export default function GitHubBackupPage({ client }: Props) {
  const [status, setStatus] = useState<GitHubStatus | null>(null)
  const [repos, setRepos] = useState<GitHubRepository[]>([])
  const [clientId, setClientId] = useState('')
  const [code, setCode] = useState<GitHubDeviceCode | null>(null)
  const [selected, setSelected] = useState('')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  async function load() {
    try {
      const next = await client.githubStatus()
      setStatus(next)
      setRepos(await client.githubRepositories().catch(() => []))
    } catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : '无法读取 GitHub 状态。' }) }
  }

  useEffect(() => { void load() }, [client])

  async function saveClientId() {
    setBusy('client'); setMessage(null)
    try { await client.githubConfigureClientId(clientId.trim()); setMessage({ kind: 'success', text: 'Client ID 已保存（仅本机）。' }); await load() }
    catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : '保存失败。' }) }
    finally { setBusy('') }
  }

  async function startDevice() {
    setBusy('device'); setMessage(null)
    try {
      const next = await client.githubDeviceCode()
      setCode(next)
      setMessage({ kind: 'success', text: `请在 ${next.verificationUri} 输入代码 ${next.userCode}。` })
    } catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Device Flow 启动失败。' }) }
    finally { setBusy('') }
  }

  async function poll() {
    setBusy('poll'); setMessage(null)
    try {
      const result = await client.githubDevicePoll()
      if (result.status === 'authorized') { setCode(null); setMessage({ kind: 'success', text: 'GitHub 已授权（token 只保留在本地服务内存中）。' }); await load() }
      else if (result.status === 'expired') { setCode(null); setMessage({ kind: 'error', text: 'Device Flow 已过期，请重新开始。' }) }
      else setMessage({ kind: 'success', text: '尚未完成授权，请继续在浏览器中确认。' })
    } catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : '轮询失败。' }) }
    finally { setBusy('') }
  }

  async function verify(repository: string) {
    if (!repository) return
    setBusy('verify'); setMessage(null)
    try {
      const result = await client.githubVerify(repository)
      setMessage({ kind: result.private ? 'success' : 'error', text: result.private ? `${result.fullName} 已确认是 private。` : `${result.fullName} 是 public，不能用作私人备份。` })
    } catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : '校验失败。' }) }
    finally { setBusy('') }
  }

  async function connect(repository: string) {
    if (!repository) return
    setBusy('connect'); setMessage(null)
    try {
      const result: GitHubConnection = await client.githubConnect(repository)
      setMessage({ kind: 'success', text: `已配置 remote ${result.remoteName} → ${result.repository}（已确认 private）。` })
      await load()
    } catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : '连接失败。' }) }
    finally { setBusy('') }
  }

  async function disconnect() {
    setBusy('disconnect'); setMessage(null)
    try { await client.githubDisconnect(); setMessage({ kind: 'success', text: '已移除 remote 并清除内存中的授权。' }); await load() }
    catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : '断开失败。' }) }
    finally { setBusy('') }
  }

  return <section className="github-page">
    <header className="backup-heading compact-heading">
      <div><p className="eyebrow">GITHUB PRIVATE BACKUP / ONBOARDING</p><p>通过 Device Flow 授权，验证仓库确实是 private，再写入 remote。授权 token 只保留在本地服务内存中，不写入 Vault、前端或 localStorage。</p></div>
      <span className="boundary-badge"><ShieldCheck size={18} />不保存 token</span>
    </header>

    {message && <div className={`backup-message ${message.kind}`} role="status">{message.kind === 'success' ? <CheckCircle /> : <Warning />}<span>{message.text}</span></div>}

    <section className="github-panel">
      <header><p className="eyebrow">STATUS</p><h3>当前状态</h3></header>
      <dl className="github-status">
        <div><dt>Client ID</dt><dd>{status?.configured ? '已配置' : '未配置'}</dd></div>
        <div><dt>授权会话</dt><dd>{status?.sessionActive ? '内存中有效' : '未授权'}</dd></div>
        <div><dt>Remote</dt><dd>{status?.connected ? status.repository : '未连接'}</dd></div>
        <div><dt>隐私验证</dt><dd>{status?.visibilityVerified || '—'}</dd></div>
      </dl>
      {status?.connected && <button className="secondary-action" onClick={() => void disconnect()} disabled={Boolean(busy)}><Trash size={16} />断开连接并移除 remote</button>}
    </section>

    <section className="github-panel">
      <header><p className="eyebrow">STEP 1 / OAUTH APP</p><h3>配置 GitHub OAuth App</h3></header>
      <label className="provider-field">Client ID<input aria-label="GitHub OAuth Client ID" value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="例如 Iv1.xxxxxxxx" /></label>
      <button className="secondary-action" onClick={() => void saveClientId()} disabled={Boolean(busy) || !clientId.trim()}>保存 Client ID</button>
      <small>只需 Client ID，不需要 Client Secret。请使用 GitHub OAuth App。</small>
    </section>

    <section className="github-panel">
      <header><p className="eyebrow">STEP 2 / DEVICE FLOW</p><h3>授权账号</h3></header>
      {code ? <div className="github-code"><strong>{code.userCode}</strong><span>有效期 {code.expiresIn} 秒 · 请打开 {code.verificationUri}</span><button className="primary-action" onClick={() => void poll()} disabled={Boolean(busy)}>{busy === 'poll' ? '正在确认…' : '我已授权，继续'}</button></div> : <button className="primary-action" onClick={() => void startDevice()} disabled={Boolean(busy) || !status?.configured}>开始 Device Flow</button>}
    </section>

    <section className="github-panel">
      <header><p className="eyebrow">STEP 3 / VERIFY &amp; CONNECT</p><h3>选择并验证仓库</h3></header>
      {!status?.sessionActive ? <p className="muted">请先完成 Device Flow 授权。</p> : <>
        <label className="provider-field">仓库<select aria-label="GitHub 仓库" value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">选择仓库</option>{repos.map((item) => <option key={item.fullName} value={item.fullName}>{item.fullName}{item.private ? '（private）' : '（public）'}</option>)}</select></label>
        <div className="github-actions">
          <button className="secondary-action" onClick={() => void verify(selected)} disabled={Boolean(busy) || !selected}><Eye size={16} />验证 private</button>
          <button className="primary-action" onClick={() => void connect(selected)} disabled={Boolean(busy) || !selected}>配置 remote</button>
        </div>
        <small>只有 GitHub 返回 private=true 的仓库才能写入 remote；remote URL 不含任何凭据。</small>
      </>}
    </section>
  </section>
}
