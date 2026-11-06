import { useEffect, useMemo, useState } from 'react'
import { ArrowCounterClockwise, CheckCircle, ClockCounterClockwise, Database, GitBranch, ShieldCheck, Warning } from '@phosphor-icons/react'
import type { ApiClient, BackupOverview, GitStatus, RegisteredVault, VaultBackup, VaultStatus } from './api'
import { LoadingState } from './components/StateBlocks'

function time(value: string) {
  if (!value) return '时间未知'
  const stamp = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/)
  const parsed = stamp ? new Date(`${stamp[1]}-${stamp[2]}-${stamp[3]}T${stamp[4]}:${stamp[5]}:${stamp[6]}Z`) : new Date(value)
  return Number.isNaN(parsed.getTime()) ? '时间未知' : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
}

function size(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

export default function BackupRecoveryPage({ client }: { client: ApiClient }) {
  const [value, setValue] = useState<BackupOverview | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [vault, setVault] = useState<VaultStatus | null>(null)
  const [registered, setRegistered] = useState<RegisteredVault[]>([])
  const [git, setGit] = useState<GitStatus | null>(null)
  const [vaultPath, setVaultPath] = useState('')
  const [commitMessage, setCommitMessage] = useState('chore: update personal profile')

  async function load() {
    setMessage(null)
    try {
      const [next, status, vaults, gitStatus] = await Promise.all([client.backups(), client.vaultStatus(), client.registeredVaults(), client.gitStatus()])
      setValue(next)
      setVault(status); setRegistered(vaults); setGit(gitStatus)
      setSelectedId((current) => current && next.backups.some((item) => item.id === current) ? current : next.backups[0]?.id ?? '')
    } catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : '无法读取备份状态。' }) }
  }

  useEffect(() => { void load() }, [client])
  const selected = useMemo(() => value?.backups.find((item) => item.id === selectedId) ?? null, [value, selectedId])
  const phrase = selected ? `RESTORE ${selected.id}` : ''

  async function create() {
    setBusy('create'); setMessage(null)
    try {
      const result = await client.createBackup()
      const next = await client.backups()
      setValue(next); setSelectedId(result.backup.id)
      setMessage({ kind: 'success', text: '完整备份已创建并通过哈希校验。' })
    } catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : '创建备份失败。' }) }
    finally { setBusy('') }
  }

  async function verify(item: VaultBackup) {
    setBusy(`verify:${item.id}`); setMessage(null)
    try {
      await client.verifyBackup(item.id)
      setMessage({ kind: 'success', text: '备份结构、Schema 和文件哈希均已验证。' })
    } catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : '校验失败。' }) }
    finally { setBusy('') }
  }

  async function restore() {
    if (!value || !selected || confirmation !== phrase) return
    setBusy('restore'); setMessage(null)
    try {
      const result = await client.restoreBackup(selected.id, confirmation, value.currentRevision)
      const next = await client.backups()
      setValue(next); setConfirmation('')
      setMessage({ kind: 'success', text: `恢复完成。系统已先创建安全备份 ${result.safetyBackup.id}。切换其他页面时会重新读取恢复后的数据。` })
    } catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : '恢复失败。' }) }
    finally { setBusy('') }
  }

  async function vaultAction(action: 'validate' | 'create' | 'switch') {
    if (!vaultPath.trim()) return
    setBusy(action); setMessage(null)
    try {
      if (action === 'validate') await client.validateVault(vaultPath.trim())
      if (action === 'create') await client.createVault(vaultPath.trim())
      if (action === 'switch') { if (!window.confirm('切换会重启本地服务并使当前会话失效。继续吗？')) return; await client.switchVault(vaultPath.trim()) }
      setMessage({ kind: 'success', text: action === 'switch' ? '正在安全重启到目标 Vault…' : action === 'create' ? '新 Vault 已创建，可在确认后切换。' : 'Vault 校验通过。' })
      if (action !== 'switch') await load()
    } catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Vault 操作失败。' }) }
    finally { setBusy('') }
  }

  async function gitAction(action: 'commit' | 'pull' | 'push') {
    if (!window.confirm(`${action.toUpperCase()} 只会作用于当前私人 Vault。继续吗？`)) return
    setBusy(`git:${action}`); setMessage(null)
    try {
      if (action === 'commit') await client.gitCommit(commitMessage)
      if (action === 'pull') await client.gitPull()
      if (action === 'push') await client.gitPush()
      setGit(await client.gitStatus())
      setMessage({ kind: 'success', text: `Git ${action} 已完成。` })
    } catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : `Git ${action} 失败。` }) }
    finally { setBusy('') }
  }

  if (!value && !message) return <LoadingState label="正在核对本地备份目录…" />

  return <section className="backup-page">
    <header className="backup-heading compact-heading">
      <div><p className="eyebrow">VAULT RESILIENCE / LOCAL ONLY</p><p>在设备本地创建可验证快照，并以事务方式恢复。备份路径和私人内容不会显示在页面或发送到外部服务；本地快照不是加密保险库。</p></div>
      <span className="boundary-badge"><ShieldCheck size={18} />本机绑定</span>
    </header>

    {message && <div className={`backup-message ${message.kind}`} role="status">{message.kind === 'success' ? <CheckCircle /> : <Warning />}<span>{message.text}</span></div>}

    <section className="vault-control" aria-label="Vault 生命周期">
      <div><p className="eyebrow">CURRENT VAULT</p><h3>{vault?.displayName ?? '正在识别'}</h3><p><code>{vault?.vaultId.slice(0, 18) ?? '—'}</code> · Schema {vault?.schemaVersion ?? '—'} · {vault?.externalChange ? '检测到外部修改' : '内容已同步'}</p></div>
      <div className="vault-path-actions"><label>新建、校验或切换 Vault 的本机目录<input aria-label="Vault 目录" value={vaultPath} onChange={(event) => setVaultPath(event.target.value)} placeholder="选择后粘贴本机目录；路径不会写入 Vault" /></label><div><button onClick={() => void vaultAction('validate')} disabled={Boolean(busy) || !vaultPath.trim()}>校验</button><button onClick={() => void vaultAction('create')} disabled={Boolean(busy) || !vaultPath.trim()}>创建</button><button className="secondary-action" onClick={() => void vaultAction('switch')} disabled={Boolean(busy) || !vaultPath.trim()}>安全切换</button></div></div>
      <p className="vault-registry">本机已登记 {registered.length} 个 Vault；切换会重启服务并签发新会话，不会删除任何目录。</p>
    </section>

    <section className="backup-overview" aria-label="备份概览">
      <article><Database /><span>Managed Backups</span><strong>{value?.backups.length ?? 0}</strong></article>
      <article><ShieldCheck /><span>Integrity</span><strong>{value?.backups.every((item) => item.integrity === 'verified') ? 'verified' : 'attention'}</strong></article>
      <article><ClockCounterClockwise /><span>Latest</span><strong>{value?.backups[0] ? time(value.backups[0].created) : '尚无备份'}</strong></article>
      <button className="primary-action" onClick={() => void create()} disabled={Boolean(busy)}>{busy === 'create' ? '正在创建…' : '创建完整备份'}</button>
    </section>

    <div className="backup-layout">
      <section className="backup-panel backup-history"><header><div><p className="eyebrow">VERIFIED SNAPSHOTS</p><h3>备份历史</h3></div><span>{value?.backups.length ?? 0} records</span></header>
        {value?.backups.length ? <div className="backup-list">{value.backups.map((item) => <button key={item.id} className={selectedId === item.id ? 'active' : ''} onClick={() => { setSelectedId(item.id); setConfirmation(''); setMessage(null) }}><span className="backup-icon"><Database /></span><span><strong>{time(item.created)}</strong><small>{item.fileCount} files · {size(item.sizeBytes)} · Schema {item.schemaVersion}</small><em className={item.integrity}><CheckCircle /> {item.integrity === 'verified' ? 'hash verified' : 'integrity failed'}</em></span></button>)}</div> : <div className="backup-empty"><Database /><h3>还没有本地备份</h3><p>创建第一个备份后，这里会显示真实快照信息。</p></div>}
      </section>

      <section className="backup-panel recovery-panel"><header><div><p className="eyebrow">TRANSACTIONAL RESTORE</p><h3>恢复向导</h3></div></header>
        {selected ? <>
          <dl className="backup-details"><div><dt>Created</dt><dd>{time(selected.created)}</dd></div><div><dt>Files</dt><dd>{selected.fileCount}</dd></div><div><dt>Size</dt><dd>{size(selected.sizeBytes)}</dd></div><div><dt>Integrity</dt><dd className={selected.integrity}>{selected.integrity}</dd></div></dl>
          <button className="secondary-action" onClick={() => void verify(selected)} disabled={Boolean(busy)}>{busy === `verify:${selected.id}` ? '正在校验…' : '重新校验备份'}</button>
          <div className="restore-boundary"><Warning /><div><strong>恢复会替换当前 Vault 内容</strong><p>执行前系统会自动保存当前状态。恢复采用事务交换，失败时回滚，不会直接覆盖公共仓库。</p></div></div>
          <label className="restore-confirm">输入确认文字 <code>{phrase}</code><input aria-label="恢复确认文字" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label>
          <button className="danger restore-action" onClick={() => void restore()} disabled={Boolean(busy) || selected.integrity !== 'verified' || confirmation !== phrase}><ArrowCounterClockwise />{busy === 'restore' ? '正在恢复…' : '创建安全备份并恢复'}</button>
        </> : <div className="backup-empty"><ClockCounterClockwise /><h3>选择一个已验证备份</h3><p>只有当前 Vault 在本机创建并绑定的备份可以恢复。</p></div>}
      </section>
    </div>

    <section className="git-backup" aria-label="GitHub Private Backup">
      <header><div><p className="eyebrow">OPTIONAL PRIVATE VERSIONING</p><h3>Git / GitHub Private Backup</h3></div><GitBranch size={26} /></header>
      {git?.configured === false ? <p>{git.message} Web 不会自动初始化仓库或发送网络请求。</p> : <><dl><div><dt>Branch</dt><dd>{git?.branch || '—'}</dd></div><div><dt>Upstream</dt><dd>{git?.upstream || '未配置'}</dd></div><div><dt>Ahead / Behind</dt><dd>{git?.ahead ?? 0} / {git?.behind ?? 0}</dd></div><div><dt>Changes</dt><dd>{git?.dirty.length ?? 0}</dd></div></dl><label>提交说明<input aria-label="Git 提交说明" value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} /></label><div className="git-actions"><button onClick={() => void gitAction('commit')} disabled={Boolean(busy) || !commitMessage.trim()}>Commit</button><button onClick={() => void gitAction('pull')} disabled={Boolean(busy)}>Pull</button><button onClick={() => void gitAction('push')} disabled={Boolean(busy)}>Push</button></div></>}
      <small>仅支持用户预先配置的私人仓库。分叉、脏状态和非 fast-forward 会拒绝自动处理。</small>
    </section>
  </section>
}
