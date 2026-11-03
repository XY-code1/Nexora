import { useEffect, useMemo, useState } from 'react'
import { CheckCircle, Clock, Fingerprint, Key, LockKey, MagnifyingGlass, Plus, Pulse, ShieldWarning, UserCircle, XCircle } from '@phosphor-icons/react'
import type { AuditEvent, SecurityCenter } from './api'

type Filters = { clientId: string; eventType: string; result: string; since: string; until: string; page: number; pageSize: number }
type Props = {
  value: SecurityCenter | null
  loading: boolean
  saving: boolean
  credential: string
  onAuthorize: (name: string, scopes: string[]) => Promise<boolean>
  onScopes: (id: string, scopes: string[]) => Promise<boolean>
  onRevoke: (id: string) => Promise<boolean>
  onQuery: (filters: Filters) => Promise<boolean>
  onClearCredential: () => void
}

const scopeDescriptions: Record<string, string> = {
  'profile:read': '读取允许访问的稳定档案', 'context:read': '读取当前上下文', 'memory:search': '搜索已确认且可访问的记忆',
  'memory:propose': '创建候选记忆，不能确认', 'memory:pending': '读取允许访问的候选项', 'project:read': '读取允许访问的活跃项目',
  'assessment:read': '读取允许访问的已确认复盘摘要',
}

function time(value: string) { return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '从未' }

export default function SecurityCenterPage(props: Props) {
  const { value, loading, saving } = props
  const [name, setName] = useState('')
  const [grantScopes, setGrantScopes] = useState<string[]>([])
  const [selectedClient, setSelectedClient] = useState<string>('')
  const [editedScopes, setEditedScopes] = useState<string[]>([])
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null)
  const [filters, setFilters] = useState<Filters>({ clientId: '', eventType: '', result: '', since: '', until: '', page: 1, pageSize: 25 })
  const client = value?.clients.find((item) => item.id === selectedClient) ?? null
  useEffect(() => { setEditedScopes(client?.scopes ?? []) }, [client])
  useEffect(() => { if (!selectedClient && value?.clients[0]) setSelectedClient(value.clients[0].id) }, [value, selectedClient])
  const eventTypes = useMemo(() => [...new Set(value?.audit.items.map((item) => item.eventType) ?? [])].sort(), [value])
  if (loading) return <div className="visual-panel" role="status">正在验证安全状态与审计链…</div>
  if (!value) return <div className="visual-panel" role="alert">安全中心暂时不可用。受保护操作保持拒绝状态。</div>
  const diagnostics = value.overview.diagnostics
  const integrity = diagnostics.audit.status

  function toggle(list: string[], scope: string, set: (next: string[]) => void) { set(list.includes(scope) ? list.filter((item) => item !== scope) : [...list, scope]) }
  async function authorize() { if (await props.onAuthorize(name, grantScopes)) { setName(''); setGrantScopes([]) } }
  async function applyFilters(next = filters) { await props.onQuery(next) }

  return <section className="security-page">
    <header className="security-heading"><div><p className="eyebrow">PRIVACY AUDIT / SECURITY CENTER</p><h2>Security Center</h2><p>查看真实客户端授权、最小权限、访问决定和记忆生命周期。缺少数据会明确显示为缺失，不会伪装成安全状态。</p></div><span className={`integrity-badge ${integrity}`}><Fingerprint size={19} /><span><small>AUDIT INTEGRITY</small><strong>{integrity === 'verified' ? '链已验证' : integrity === 'missing' ? '尚无审计记录' : '完整性失败'}</strong></span></span></header>

    <section className="security-overview" aria-label="Security Overview">
      <Status label="Local Service" value={diagnostics.localService} good={diagnostics.localService === 'ok'} />
      <Status label="Vault" value={diagnostics.vault} good={diagnostics.vault === 'ready'} />
      <Status label="MCP Server" value={diagnostics.mcp} good={diagnostics.mcp === 'configured'} />
      <Status label="Authorized Clients" value={String(diagnostics.authorizedClients)} good={diagnostics.authorizedClients > 0} neutral={diagnostics.authorizedClients === 0} />
      <Status label="Recent Denied" value={String(diagnostics.recentDenied)} good={diagnostics.recentDenied === 0} neutral={diagnostics.audit.status === 'missing'} />
      <Status label="Audit Events" value={diagnostics.audit.status === 'missing' ? 'missing' : String(diagnostics.audit.events)} good={diagnostics.audit.status === 'verified'} neutral={diagnostics.audit.status === 'missing'} />
    </section>

    {props.credential && <section className="credential-once" role="status"><div><Key /><span><strong>客户端凭据仅显示一次</strong><small>复制到该客户端的 <code>PROFILE_CLIENT_TOKEN</code>。页面关闭后不能恢复，只能撤销并重新授权。</small></span></div><code>{props.credential}</code><button onClick={props.onClearCredential}>我已安全保存</button></section>}

    <div className="security-grid">
      <section className="security-panel access-management"><header><div><p className="eyebrow">AI ACCESS MANAGEMENT</p><h3>真实客户端授权</h3></div><span>{value.clients.length} records</span></header>
        <div className="authorize-form"><label>客户端名称<input aria-label="客户端名称" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：Local Codex" /></label><fieldset><legend>初始最小权限</legend>{value.overview.scopes.map((scope) => <label key={scope}><input type="checkbox" checked={grantScopes.includes(scope)} onChange={() => toggle(grantScopes, scope, setGrantScopes)} /><span><strong>{scope}</strong><small>{scopeDescriptions[scope]}</small></span></label>)}</fieldset><button className="primary-action" onClick={() => void authorize()} disabled={saving || !name.trim() || grantScopes.length === 0}><Plus />授权客户端</button></div>
        <div className="client-list">{value.clients.map((item) => <button key={item.id} className={item.id === selectedClient ? 'active' : ''} onClick={() => setSelectedClient(item.id)}><span className={`client-state ${item.status}`}><UserCircle /></span><span><strong>{item.name}</strong><small>{item.id}</small><em>{item.status === 'revoked' ? `已撤销 ${time(item.revokedAt)}` : `${item.connectionStatus === 'recent' ? '最近访问' : '未连接'} · ${time(item.lastAccessAt)}`}</em></span></button>)}{value.clients.length === 0 && <p className="security-empty">尚未授权任何 AI 客户端。系统不会根据名称猜测 Claude、Codex 或 Cursor 连接。</p>}</div>
      </section>

      <section className="security-panel permission-management"><header><div><p className="eyebrow">LEAST PRIVILEGE</p><h3>Permission Management</h3></div></header>{client ? <><div className="client-identity"><Fingerprint /><div><strong>{client.name}</strong><small>{client.id}</small></div><span className={client.status}>{client.status}</span></div><div className="scope-editor">{value.overview.scopes.map((scope) => <label key={scope}><input type="checkbox" checked={editedScopes.includes(scope)} disabled={client.status === 'revoked'} onChange={() => toggle(editedScopes, scope, setEditedScopes)} /><span><strong>{scope}</strong><small>{scopeDescriptions[scope]}</small></span></label>)}</div><footer><button className="secondary-action" onClick={() => void props.onScopes(client.id, editedScopes)} disabled={saving || client.status === 'revoked' || editedScopes.length === 0 || editedScopes.join() === client.scopes.join()}>保存权限</button><button className="danger" onClick={() => { if (window.confirm(`撤销 ${client.name}？后续请求会立即被拒绝。`)) void props.onRevoke(client.id) }} disabled={saving || client.status === 'revoked'}>撤销授权</button></footer><p className="confirmation-boundary"><LockKey />客户端永远没有正式记忆确认权限。确认仍只存在于本地人工审核流程。</p></> : <p className="security-empty">选择一个真实授权记录后管理权限。</p>}</section>
    </div>

    <section className="security-panel access-timeline"><header><div><p className="eyebrow">ACCESS TIMELINE</p><h3>真实访问事件</h3></div><span>{value.audit.total} events</span></header><div className="audit-filters"><select aria-label="客户端筛选" value={filters.clientId} onChange={(e) => setFilters({ ...filters, clientId: e.target.value, page: 1 })}><option value="">全部客户端</option>{value.clients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select aria-label="事件类型筛选" value={filters.eventType} onChange={(e) => setFilters({ ...filters, eventType: e.target.value, page: 1 })}><option value="">全部事件类型</option>{eventTypes.map((item) => <option key={item} value={item}>{item}</option>)}</select><select aria-label="结果筛选" value={filters.result} onChange={(e) => setFilters({ ...filters, result: e.target.value, page: 1 })}><option value="">Allowed / Denied</option><option value="allowed">Allowed</option><option value="denied">Denied</option></select><input aria-label="开始时间" type="datetime-local" value={filters.since} onChange={(e) => setFilters({ ...filters, since: e.target.value, page: 1 })} /><input aria-label="结束时间" type="datetime-local" value={filters.until} onChange={(e) => setFilters({ ...filters, until: e.target.value, page: 1 })} /><button onClick={() => void applyFilters()}><MagnifyingGlass />查询</button></div>
      {value.audit.integrity.status === 'invalid' ? <div className="audit-invalid"><ShieldWarning />审计链完整性失败，事件查询已停止。</div> : value.audit.integrity.status === 'missing' ? <div className="security-empty">审计日志尚未创建；这与“0 次访问”不同。</div> : <><div className="event-table"><div className="event-head"><span>时间</span><span>客户端</span><span>事件</span><span>Scope</span><span>结果</span></div>{value.audit.items.map((item) => <button key={item.eventId} onClick={() => setSelectedEvent(item)}><span>{time(item.timestamp)}</span><span>{item.clientId}</span><strong>{item.eventType}</strong><code>{item.scope}</code><em className={item.result}>{item.result}</em></button>)}</div><div className="pagination"><button disabled={value.audit.page <= 1} onClick={() => { const next = { ...filters, page: filters.page - 1 }; setFilters(next); void applyFilters(next) }}>上一页</button><span>第 {value.audit.page} 页 · {value.audit.total} 条</span><button disabled={value.audit.page * value.audit.pageSize >= value.audit.total} onClick={() => { const next = { ...filters, page: filters.page + 1 }; setFilters(next); void applyFilters(next) }}>下一页</button></div></>}
    </section>

    <div className="security-grid lower"><section className="security-panel lifecycle-audit"><header><div><p className="eyebrow">MEMORY LIFECYCLE AUDIT</p><h3>真实状态转换</h3></div></header>{value.lifecycle.items.length ? <div className="lifecycle-events">{value.lifecycle.items.map((item) => <article key={item.eventId}><span className={item.eventType.split('.').pop()}><Pulse /></span><div><strong>{item.eventType.replace('memory.', '')}</strong><small>{time(item.timestamp)} · {String(item.details.resourceId ?? '受保护记录')}</small></div></article>)}</div> : <p className="security-empty">尚无已记录的记忆生命周期事件。</p>}</section>
      <section className="security-panel diagnostics"><header><div><p className="eyebrow">SECURITY DIAGNOSTICS</p><h3>检查依据</h3></div></header><ul><li><CheckCircle />FastAPI Bearer 会话已启用</li><li><CheckCircle />客户端凭据仅保存 SHA-256 哈希</li><li><CheckCircle />审计记录不包含正文或令牌</li><li className={integrity === 'verified' ? 'good' : integrity === 'missing' ? 'neutral' : 'bad'}>{integrity === 'verified' ? <CheckCircle /> : integrity === 'missing' ? <Clock /> : <XCircle />}审计链：{integrity}</li><li><CheckCircle />denied / local-only 仍由 Core 强制执行</li></ul></section></div>

    {selectedEvent && <div className="event-detail" role="dialog" aria-modal="true" aria-label="审计事件详情"><button className="event-scrim" aria-label="关闭事件详情" onClick={() => setSelectedEvent(null)} /><article><header><div><p className="eyebrow">AUDIT EVENT DETAIL</p><h3>{selectedEvent.eventType}</h3></div><button onClick={() => setSelectedEvent(null)}>关闭</button></header><dl>{Object.entries(selectedEvent).filter(([key]) => key !== 'details').map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl><pre>{JSON.stringify(selectedEvent.details, null, 2)}</pre></article></div>}
  </section>
}

function Status({ label, value, good, neutral = false }: { label: string; value: string; good: boolean; neutral?: boolean }) { return <article className={good ? 'good' : neutral ? 'neutral' : 'warning'}><span>{good ? <CheckCircle /> : neutral ? <Clock /> : <ShieldWarning />}</span><div><small>{label}</small><strong>{value}</strong></div></article> }
