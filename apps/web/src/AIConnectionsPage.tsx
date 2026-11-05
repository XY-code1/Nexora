import { useEffect, useState } from 'react'
import { CheckCircle, Copy, Key, Link, PlugsConnected, ShieldCheck, Trash, Warning } from '@phosphor-icons/react'
import type { ApiClient, SecurityClient, SecurityOverview } from './api'

const scopeText: Record<string, string> = {
  'profile:read': '读取允许访问的稳定档案', 'context:read': '读取当前上下文', 'memory:search': '搜索已确认记忆',
  'memory:propose': '创建候选记忆', 'memory:pending': '只读候选项统计', 'project:read': '读取允许访问的项目',
  'assessment:read': '读取已确认复盘摘要',
}
const authText = { pending_authorization: '待授权', authorized: '已授权', revoked: '已撤销', deleted: '已删除' }
const activityText = { never_connected: '从未连接', recently_active: '最近活跃', inactive: '未活跃', error: '连接错误' }

export default function AIConnectionsPage({ client }: { client: ApiClient }) {
  const [overview, setOverview] = useState<SecurityOverview | null>(null)
  const [clients, setClients] = useState<SecurityClient[]>([])
  const [name, setName] = useState('')
  const [host, setHost] = useState('claude-desktop')
  const [scopes, setScopes] = useState<string[]>(['profile:read'])
  const [credential, setCredential] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    try { const value = await client.securityCenter(); setOverview(value.overview); setClients(value.clients); setError('') }
    catch (reason) { setError(reason instanceof Error ? reason.message : '连接状态读取失败。') }
  }
  useEffect(() => { void load() }, [client])
  function toggle(scope: string) { setScopes((value) => value.includes(scope) ? value.filter((item) => item !== scope) : [...value, scope]) }
  async function action(run: () => Promise<unknown>) { setBusy(true); setError(''); try { await run(); await load() } catch (reason) { setError(reason instanceof Error ? reason.message : '操作失败。') } finally { setBusy(false) } }
  async function register() { await action(async () => { await client.registerSecurityClient(name.trim(), scopes); setName('') }) }
  async function authorize(item: SecurityClient) { await action(async () => { const value = await client.authorizeRegisteredClient(item.id); setCredential(value.credential) }) }
  async function reissue(item: SecurityClient) { if (!window.confirm(`重新签发 ${item.name} 的 Token？旧 Token 会立即失效。`)) return; await action(async () => { const value = await client.reissueSecurityToken(item.id); setCredential(value.credential) }) }
  async function revoke(item: SecurityClient) { if (!window.confirm(`撤销 ${item.name} 的授权？`)) return; await action(() => client.revokeSecurityClient(item.id)) }
  async function remove(item: SecurityClient) { if (!window.confirm(`逻辑删除 ${item.name}？审计记录仍会保留。`)) return; await action(() => client.deleteSecurityClient(item.id)) }
  const command = `python scripts/mcp_host_config.py --host ${host} --vault "<PRIVATE_VAULT>" --client-id "<CLIENT_ID>" --output "<PRIVATE_OUTPUT>.json"`

  return <section className="connections-page">
    <header className="connections-hero"><div><p className="eyebrow">MODEL-AGNOSTIC / LOCAL STDIO</p><h2>AI Connections</h2><p>为每个 AI 建立独立身份和最小权限。连接不会获得正式记忆确认权。</p></div><span><PlugsConnected />{overview?.diagnostics.authorizedClients ?? 0} 个已授权客户端</span></header>
    {error && <div className="notice error" role="alert"><Warning />{error}</div>}
    {credential && <section className="connection-credential" role="status"><Key /><div><strong>Token 仅显示这一次</strong><code>{credential}</code><small>保存后请立即清除屏幕。本页不会恢复该 Token。</small></div><button onClick={() => setCredential('')}>我已保存</button></section>}
    <div className="connections-grid">
      <section className="connection-panel"><p className="eyebrow">01 / REGISTER</p><h3>注册 AI 客户端</h3><label>客户端名称<input aria-label="AI 客户端名称" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 Claude Desktop" /></label><fieldset><legend>最小权限</legend>{(overview?.scopes ?? []).map((scope) => <label key={scope}><input type="checkbox" checked={scopes.includes(scope)} onChange={() => toggle(scope)} /><span><strong>{scope}</strong><small>{scopeText[scope]}</small></span></label>)}</fieldset><button className="primary-action" disabled={busy || !name.trim() || !scopes.length} onClick={() => void register()}><Link />创建待授权连接</button></section>
      <section className="connection-panel"><p className="eyebrow">02 / HOST SETUP</p><h3>本地接入向导</h3><label>AI Host<select aria-label="AI Host" value={host} onChange={(event) => setHost(event.target.value)}><option value="claude-desktop">Claude Desktop</option><option value="cursor">Cursor</option><option value="vscode">VS Code</option></select></label><ol><li>创建待授权客户端。</li><li>在右侧明确授权并保存一次性 Token。</li><li>在本地终端设置 <code>PROFILE_CLIENT_TOKEN</code>，再生成私有配置。</li><li>合并到 Host 配置并完全重启 Host。</li></ol><pre>{command}</pre><button onClick={() => void navigator.clipboard.writeText(command)}><Copy />复制不含私密的命令模板</button><p className="connection-boundary"><ShieldCheck />页面不返回或显示真实 Vault 路径。</p></section>
    </div>
    <section className="connection-panel connection-list"><header><div><p className="eyebrow">03 / MANAGE</p><h3>真实连接记录</h3></div><button onClick={() => void load()} disabled={busy}>刷新</button></header>{clients.length === 0 ? <p className="security-empty">尚未注册 AI 客户端。</p> : clients.map((item) => <article key={item.id} className={item.authorization}><div><PlugsConnected /><span><strong>{item.name}</strong><small>{item.id}</small></span></div><div className="connection-state"><span>{authText[item.authorization]}</span><em>{activityText[item.activity]}</em></div><div className="connection-scopes">{item.scopes.map((scope) => <code key={scope}>{scope}</code>)}</div><div className="connection-actions">{item.authorization === 'pending_authorization' && <button className="primary-action" onClick={() => void authorize(item)} disabled={busy}><CheckCircle />授权并签发 Token</button>}{item.authorization === 'authorized' && <><button onClick={() => void reissue(item)} disabled={busy}>重签 Token</button><button className="danger" onClick={() => void revoke(item)} disabled={busy}>撤销</button></>}{item.authorization !== 'deleted' && <button aria-label={`删除 ${item.name}`} onClick={() => void remove(item)} disabled={busy}><Trash /></button>}</div></article>)}</section>
  </section>
}
