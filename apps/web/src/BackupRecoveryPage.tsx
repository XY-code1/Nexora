import { useEffect, useMemo, useState } from 'react'
import { ArrowCounterClockwise, CheckCircle, ClockCounterClockwise, Database, ShieldCheck, Warning } from '@phosphor-icons/react'
import type { ApiClient, BackupOverview, VaultBackup } from './api'

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

  async function load() {
    setMessage(null)
    try {
      const next = await client.backups()
      setValue(next)
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

  if (!value && !message) return <div className="visual-panel" role="status">正在核对本地备份目录…</div>

  return <section className="backup-page">
    <header className="backup-heading">
      <div><p className="eyebrow">VAULT RESILIENCE / LOCAL ONLY</p><h2>Backup & Recovery</h2><p>在设备本地创建可验证快照，并以事务方式恢复。备份路径和私人内容不会显示在页面或发送到外部服务；本地快照不是加密保险库。</p></div>
      <span className="boundary-badge"><ShieldCheck size={18} />本机绑定</span>
    </header>

    {message && <div className={`backup-message ${message.kind}`} role="status">{message.kind === 'success' ? <CheckCircle /> : <Warning />}<span>{message.text}</span></div>}

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
  </section>
}
