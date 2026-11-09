import { useEffect, useMemo, useState } from 'react'
import { ArrowCounterClockwise, ArrowLeft, ArrowRight, CheckCircle, ClockCounterClockwise, Database, GitBranch, MagnifyingGlass, ShieldCheck, Warning } from '@phosphor-icons/react'
import type { ApiClient, BackupOverview, GitChanges, GitHistory, GitStatus, RegisteredVault, VaultBackup, VaultStatus } from './api'
import { LoadingState } from './components/StateBlocks'
import { vaultHint } from './vaultHints'
import { formatDate, getLanguage } from './i18n'

function time(value: string) {
  return formatDate(getLanguage(), value)
}

function size(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

type BackupFilter = 'all' | 'verified' | 'invalid'
type BackupSort = 'created' | 'size' | 'files'

const FILTER_LABELS: Record<BackupFilter, string> = { all: '全部', verified: '已验证', invalid: '异常' }
const SORT_LABELS: Record<BackupSort, string> = { created: '最新优先', size: '大小', files: '文件数' }

/**
 * 可复用的备份列表：筛选（完整性）、搜索（ID / 日期）和排序。
 * 主页历史面板与恢复向导的第一步共用同一份浏览能力。
 */
function BackupList({ backups, selectedId, onSelect }: { backups: VaultBackup[]; selectedId: string; onSelect: (id: string) => void }) {
  const [filter, setFilter] = useState<BackupFilter>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<BackupSort>('created')

  const counts = useMemo(() => ({
    all: backups.length,
    verified: backups.filter((item) => item.integrity === 'verified').length,
    invalid: backups.filter((item) => item.integrity === 'invalid').length,
  }), [backups])

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const items = backups.filter((item) => {
      if (filter !== 'all' && item.integrity !== filter) return false
      if (!keyword) return true
      return item.id.toLowerCase().includes(keyword) || item.created.toLowerCase().includes(keyword) || time(item.created).toLowerCase().includes(keyword)
    })
    return [...items].sort((a, b) => sort === 'size' ? b.sizeBytes - a.sizeBytes : sort === 'files' ? b.fileCount - a.fileCount : b.created.localeCompare(a.created))
  }, [backups, filter, query, sort])

  return <div className="backup-list-wrap">
    <div className="backup-filters" role="group" aria-label="备份筛选与排序">
      <div className="backup-filter-tabs">
        {(Object.keys(FILTER_LABELS) as BackupFilter[]).map((key) => <button key={key} className={filter === key ? 'active' : ''} aria-pressed={filter === key} onClick={() => setFilter(key)}>{FILTER_LABELS[key]} <span>{counts[key]}</span></button>)}
      </div>
      <div className="backup-filter-tools">
        <label className="backup-search"><MagnifyingGlass size={16} /><input aria-label="搜索备份" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索备份 ID 或日期…" /></label>
        <label className="backup-sort"><span>排序</span><select aria-label="排序方式" value={sort} onChange={(event) => setSort(event.target.value as BackupSort)}>{(Object.keys(SORT_LABELS) as BackupSort[]).map((key) => <option key={key} value={key}>{SORT_LABELS[key]}</option>)}</select></label>
      </div>
    </div>

    {visible.length ? <div className="backup-list">{visible.map((item) => <button key={item.id} className={selectedId === item.id ? 'active' : ''} aria-pressed={selectedId === item.id} onClick={() => onSelect(item.id)}><span className="backup-icon"><Database /></span><span><strong>{time(item.created)}</strong><small>{item.fileCount} files · {size(item.sizeBytes)} · Schema {item.schemaVersion}</small><em className={item.integrity}><CheckCircle /> {item.integrity === 'verified' ? 'hash verified' : 'integrity failed'}</em></span></button>)}</div> : <div className="backup-empty compact"><Database /><h3>没有符合条件的备份</h3><p>调整筛选或搜索条件后再试。</p></div>}
  </div>
}

const WIZARD_STEPS = ['选择备份', '校验备份', '确认恢复', '完成'] as const

/**
 * 引导式恢复：把「选择 → 校验 → 确认 → 完成」拆成四个明确步骤，
 * 每步只要求一个动作，降低误操作概率。
 */
function RecoveryWizard({ client, backups, currentRevision, initialId, onExit }: { client: ApiClient; backups: VaultBackup[]; currentRevision: string; initialId?: string; onExit: () => void }) {
  const [step, setStep] = useState(0)
  const [selectedId, setSelectedId] = useState(initialId ?? backups[0]?.id ?? '')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [verified, setVerified] = useState(false)
  const [result, setResult] = useState<{ restoredBackupId: string; safetyBackup: VaultBackup } | null>(null)

  const selected = useMemo(() => backups.find((item) => item.id === selectedId) ?? null, [backups, selectedId])
  const phrase = selected ? `RESTORE ${selected.id}` : ''

  function selectBackup(id: string) {
    setSelectedId(id)
    setVerified(false)
    setConfirmation('')
    setMessage(null)
  }

  async function verifySelected() {
    if (!selected) return
    setBusy('verify'); setMessage(null)
    try {
      await client.verifyBackup(selected.id)
      setVerified(true)
      setMessage({ kind: 'success', text: '备份结构、Schema 和文件哈希均已验证。' })
    } catch (error) {
      setVerified(false)
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : '校验失败。' })
    } finally { setBusy('') }
  }

  async function restore() {
    if (!selected || confirmation !== phrase) return
    setBusy('restore'); setMessage(null)
    try {
      const restored = await client.restoreBackup(selected.id, confirmation, currentRevision)
      setResult(restored)
      setStep(3)
      setMessage({ kind: 'success', text: `恢复完成。系统已先创建安全备份 ${restored.safetyBackup.id}。` })
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : '恢复失败。' })
    } finally { setBusy('') }
  }

  return <div className="recovery-wizard">
    <ol className="wizard-steps" aria-label="恢复步骤">
      {WIZARD_STEPS.map((label, index) => <li key={label} className={index === step ? 'active' : index < step ? 'done' : ''} aria-current={index === step ? 'step' : undefined}>
        <span className="wizard-step-dot">{index < step ? <CheckCircle size={16} /> : index + 1}</span>
        <span className="wizard-step-label">{label}</span>
        {index < WIZARD_STEPS.length - 1 && <span className="wizard-step-connector" aria-hidden="true" />}
      </li>)}
    </ol>

    {message && <div className={`backup-message ${message.kind}`} role="status">{message.kind === 'success' ? <CheckCircle /> : <Warning />}<span>{message.text}</span></div>}

    {step === 0 && <div className="wizard-panel">
      <p className="eyebrow">STEP 1 / SELECT BACKUP</p>
      <h3>选择要恢复的备份</h3>
      <p className="wizard-hint">只有当前 Vault 在本机创建并绑定的备份可以恢复。可先按完整性筛选，或搜索备份 ID。</p>
      {backups.length ? <BackupList backups={backups} selectedId={selectedId} onSelect={selectBackup} /> : <div className="backup-empty compact"><Database /><h3>还没有本地备份</h3><p>请先返回并创建一个完整备份。</p></div>}
      <div className="wizard-actions">
        <button className="text-button" onClick={onExit}><ArrowLeft size={16} />返回备份列表</button>
        <button className="primary-action" disabled={!selected || selected.integrity !== 'verified'} onClick={() => setStep(1)}>下一步<ArrowRight size={16} /></button>
      </div>
    </div>}

    {step === 1 && selected && <div className="wizard-panel">
      <p className="eyebrow">STEP 2 / VERIFY BACKUP</p>
      <h3>校验备份完整性</h3>
      <p className="wizard-hint">恢复前重新校验可以确认快照的结构、Schema 和文件哈希仍然有效。</p>
      <dl className="backup-details"><div><dt>Created</dt><dd>{time(selected.created)}</dd></div><div><dt>Files</dt><dd>{selected.fileCount}</dd></div><div><dt>Size</dt><dd>{size(selected.sizeBytes)}</dd></div><div><dt>Integrity</dt><dd className={selected.integrity}>{selected.integrity}</dd></div></dl>
      <div className="wizard-actions">
        <button className="text-button" onClick={() => setStep(0)}><ArrowLeft size={16} />上一步</button>
        <button className="secondary-action" onClick={() => void verifySelected()} disabled={Boolean(busy)}>{busy === 'verify' ? '正在校验…' : verified ? '重新校验备份' : '校验备份'}</button>
        <button className="primary-action" disabled={!verified || Boolean(busy)} onClick={() => { setMessage(null); setStep(2) }}>下一步<ArrowRight size={16} /></button>
      </div>
    </div>}

    {step === 2 && selected && <div className="wizard-panel">
      <p className="eyebrow">STEP 3 / CONFIRM RESTORE</p>
      <h3>确认恢复</h3>
      <div className="restore-boundary"><Warning /><div><strong>恢复会替换当前 Vault 内容</strong><p>执行前系统会自动保存当前状态。恢复采用事务交换，失败时回滚，不会直接覆盖公共仓库。</p></div></div>
      <label className="restore-confirm">输入确认文字 <code>{phrase}</code><input aria-label="恢复确认文字" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label>
      <div className="wizard-actions">
        <button className="text-button" onClick={() => setStep(1)}><ArrowLeft size={16} />上一步</button>
        <button className="danger restore-action" onClick={() => void restore()} disabled={Boolean(busy) || confirmation !== phrase}><ArrowCounterClockwise />{busy === 'restore' ? '正在恢复…' : '创建安全备份并恢复'}</button>
      </div>
    </div>}

    {step === 3 && result && <div className="wizard-panel wizard-done-panel">
      <p className="eyebrow">STEP 4 / COMPLETE</p>
      <h3><CheckCircle size={22} />恢复完成</h3>
      <p className="wizard-hint">你的 Vault 已切换到选中的快照。系统同时保留了恢复前的安全备份，可在备份历史中查看。</p>
      <dl className="backup-details"><div><dt>已恢复</dt><dd>{result.restoredBackupId}</dd></div><div><dt>安全备份</dt><dd>{result.safetyBackup.id}</dd></div></dl>
      <div className="wizard-actions">
        <button className="primary-action" onClick={onExit}>返回备份列表<ArrowRight size={16} /></button>
      </div>
    </div>}
  </div>
}

export default function BackupRecoveryPage({ client, refreshKey = 0 }: { client: ApiClient; refreshKey?: number }) {
  const [value, setValue] = useState<BackupOverview | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [vault, setVault] = useState<VaultStatus | null>(null)
  const [registered, setRegistered] = useState<RegisteredVault[]>([])
  const [git, setGit] = useState<GitStatus | null>(null)
  const [history, setHistory] = useState<GitHistory | null>(null)
  const [vaultPath, setVaultPath] = useState('')
  const [commitMessage, setCommitMessage] = useState('chore: update personal profile')
  const [changes, setChanges] = useState<GitChanges | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)

  async function load() {
    setMessage(null)
    try {
      const [next, status, vaults, gitStatus, gitHistory] = await Promise.all([client.backups(), client.vaultStatus(), client.registeredVaults(), client.gitStatus(), client.gitHistory()])
      setValue(next)
      setVault(status); setRegistered(vaults); setGit(gitStatus); setHistory(gitHistory)
      setSelectedId((current) => current && next.backups.some((item) => item.id === current) ? current : next.backups[0]?.id ?? '')
    } catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : '无法读取备份状态。' }) }
  }

  useEffect(() => { void load() }, [client, refreshKey])
  const selected = useMemo(() => value?.backups.find((item) => item.id === selectedId) ?? null, [value, selectedId])
  const timeline = useMemo(() => {
    const backups = (value?.backups ?? []).map((item) => ({ kind: 'backup' as const, id: item.id, created: item.created, title: '本地备份', detail: `${item.fileCount} files · ${size(item.sizeBytes)}` }))
    const commits = (history?.commits ?? []).map((item) => ({ kind: 'commit' as const, id: item.id, created: item.created, title: 'Git 提交', detail: item.subject || '(无提交说明)' }))
    return [...backups, ...commits].sort((a, b) => b.created.localeCompare(a.created)).slice(0, 50)
  }, [value, history])

  async function restoreCommit(item: { id: string }) {
    if (!value || !window.confirm('恢复到此提交？系统会先创建 managed 安全备份，再把工作区内容回退到该提交（HEAD 不变，回退会显示为未提交改动）。')) return
    setBusy(`restore:${item.id}`); setMessage(null)
    try {
      const result = await client.gitRestore(item.id, value.currentRevision)
      await load()
      setMessage({ kind: 'success', text: `已恢复到提交 ${result.restoredCommit.slice(0, 8)}；安全备份 ${result.safetyBackup.id} 已创建。请核对后提交。` })
    } catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : '恢复失败。' }) }
    finally { setBusy('') }
  }

  async function create() {
    setBusy('create'); setMessage(null)
    try {
      const result = await client.createBackup()
      const next = await client.backups()
      setValue(next); setSelectedId(result.backup.id)
      const pruned = result.backup.pruned?.length ? `（已清理 ${result.backup.pruned.length} 个旧备份）` : ''
      setMessage({ kind: 'success', text: `完整备份已创建并通过哈希校验。${pruned}` })
    } catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : '创建备份失败。' }) }
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
    } catch (error) { setMessage({ kind: 'error', text: vaultHint(error instanceof Error ? error.message : 'Vault 操作失败。') }) }
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
      setChanges(null)
      setMessage({ kind: 'success', text: `Git ${action} 已完成。` })
    } catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : `Git ${action} 失败。` }) }
    finally { setBusy('') }
  }

  async function previewChanges() {
    setBusy('changes'); setMessage(null)
    try { setChanges(await client.gitChanges()) }
    catch (error) { setMessage({ kind: 'error', text: error instanceof Error ? error.message : '无法读取变更预览。' }) }
    finally { setBusy('') }
  }

  if (!value && !message) return <LoadingState label="正在核对本地备份目录…" />

  if (wizardOpen) return <section className="backup-page">
    <header className="backup-heading compact-heading">
      <div><p className="eyebrow">VAULT RESILIENCE / LOCAL ONLY</p><p>按步骤完成一次可验证的本地恢复。每一步只要求一个确认，随时可以返回。</p></div>
      <span className="boundary-badge"><ShieldCheck size={18} />本机绑定</span>
    </header>
    <RecoveryWizard
      client={client}
      backups={value?.backups ?? []}
      currentRevision={value?.currentRevision ?? ''}
      initialId={selectedId}
      onExit={() => { setWizardOpen(false); setMessage(null); void load() }}
    />
  </section>

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

    <section className="backup-timeline" aria-label="版本历史">
      <header><div><p className="eyebrow">VERSION HISTORY / LOCAL + GIT</p><h3>版本历史</h3></div><span>{timeline.length} records</span></header>
      {history?.message && <div className="backup-message error" role="alert"><Warning /><span>{history.message}</span></div>}
      {timeline.length ? <ul className="timeline-list">{timeline.map((item) => <li key={`${item.kind}:${item.id}`} className={`timeline-${item.kind}`}>
        <span className="timeline-dot" aria-hidden="true" />
        <div><p className="timeline-meta">{time(item.created)} · {item.title}</p><strong>{item.detail}</strong><small>{item.kind === 'commit' ? item.id.slice(0, 8) : item.id}</small></div>
        {item.kind === 'commit' && <button className="text-button" onClick={() => void restoreCommit(item)} disabled={Boolean(busy)}>{busy === `restore:${item.id}` ? '正在恢复…' : '恢复到此提交'}</button>}
      </li>)}</ul> : <p className="muted">暂无版本历史记录。</p>}
    </section>

    <div className="backup-layout">
      <section className="backup-panel backup-history"><header><div><p className="eyebrow">VERIFIED SNAPSHOTS</p><h3>备份历史</h3></div><span>{value?.backups.length ?? 0} records</span></header>
        {value?.backups.length ? <BackupList backups={value.backups} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); setMessage(null) }} /> : <div className="backup-empty"><Database /><h3>还没有本地备份</h3><p>创建第一个备份后，这里会显示真实快照信息。</p></div>}
      </section>

      <section className="backup-panel recovery-panel"><header><div><p className="eyebrow">GUIDED RESTORE</p><h3>恢复向导</h3></div></header>
        {selected ? <>
          <p className="recovery-selected">已选备份：<strong>{time(selected.created)}</strong><small>{selected.fileCount} files · {size(selected.sizeBytes)} · <span className={selected.integrity}>{selected.integrity}</span></small></p>
          <p className="wizard-hint">恢复会经过「选择 → 校验 → 确认 → 完成」四个步骤，每一步都需要你明确确认。</p>
        </> : <p className="wizard-hint">从备份历史中选择一个快照，或先创建一个新的完整备份。</p>}
        <button className="primary-action" onClick={() => { setMessage(null); setWizardOpen(true) }} disabled={!value?.backups.length || Boolean(busy)}>开始恢复向导<ArrowRight size={16} /></button>
        <div className="restore-boundary"><Warning /><div><strong>恢复会替换当前 Vault 内容</strong><p>执行前系统会自动保存当前状态。恢复采用事务交换，失败时回滚，不会直接覆盖公共仓库。</p></div></div>
      </section>
    </div>

    <section className="git-backup" aria-label="GitHub Private Backup">
      <header><div><p className="eyebrow">OPTIONAL PRIVATE VERSIONING</p><h3>Git / GitHub Private Backup</h3></div><GitBranch size={26} /></header>
      {git?.configured === false ? <p>{git.message} Web 不会自动初始化仓库或发送网络请求。</p> : <><dl><div><dt>Branch</dt><dd>{git?.branch || '—'}</dd></div><div><dt>Upstream</dt><dd>{git?.upstream || '未配置'}</dd></div><div><dt>Ahead / Behind</dt><dd>{git?.ahead ?? 0} / {git?.behind ?? 0}</dd></div><div><dt>Changes</dt><dd>{changes ? changes.changes.length : (git?.dirty.length ?? 0)}</dd></div></dl><label>提交说明<input aria-label="Git 提交说明" value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} /></label><div className="git-actions"><button className="secondary-action" onClick={() => void previewChanges()} disabled={Boolean(busy)}>{busy === 'changes' ? '正在读取…' : '预览变更'}</button><button onClick={() => void gitAction('commit')} disabled={Boolean(busy) || !commitMessage.trim() || (changes !== null && !changes.can_commit)}>Commit</button><button onClick={() => void gitAction('pull')} disabled={Boolean(busy)}>Pull</button><button onClick={() => void gitAction('push')} disabled={Boolean(busy)}>Push</button></div></>}
      {changes && <div className="git-changes" aria-label="变更预览">
        {changes.message && <div className="backup-message error" role="alert"><Warning /><span>{changes.message}</span></div>}
        {changes.sensitive.length > 0 && <div className="restore-boundary"><Warning /><div><strong>检测到疑似敏感文件，已禁止提交</strong><p>请从 Vault 移除这些文件或加入 .gitignore 后再提交；页面不会显示文件内容。</p><ul className="git-sensitive-list">{changes.sensitive.map((item) => <li key={item.path}><code>{item.path}</code><span>{item.reason}</span></li>)}</ul></div></div>}
        {changes.unmerged.length > 0 && <div className="restore-boundary"><Warning /><div><strong>存在未解决的合并冲突</strong><p>请先手动解决冲突再提交。</p></div></div>}
        {changes.changes.length > 0 ? <ul className="git-change-list">{changes.changes.map((item) => <li key={`${item.code}:${item.path}`}><span className={`git-status git-status-${item.status}`}>{item.status}</span><code>{item.path}</code></li>)}</ul> : <p className="muted">没有待提交的变更。</p>}
        <p className="git-changes-meta">{changes.changes.length} 项变更 · {changes.can_commit ? '可以提交' : '暂不可提交'}</p>
      </div>}
      <small>仅支持用户预先配置的私人仓库。分叉、脏状态和非 fast-forward 会拒绝自动处理。</small>
    </section>
  </section>
}
