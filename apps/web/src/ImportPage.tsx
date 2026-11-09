import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle, CloudArrowUp, Warning } from '@phosphor-icons/react'
import type { ApiClient, ImportPreview, ImportResult } from './api'
import { StateBlock } from './components/StateBlocks'

type Format = 'markdown' | 'json'

const SAMPLES: Record<Format, string> = {
  markdown: `---
type: preference
subject: 回答风格
---

回答先给结论，再展开依据。

---
type: note
subject: 项目背景
---

Personal AI Profile 是本地优先、由用户控制的个人上下文框架。`,
  json: `[
  { "type": "preference", "subject": "回答风格", "content": "回答先给结论，再展开依据。" },
  { "type": "note", "subject": "项目背景", "content": "Personal AI Profile 是本地优先、由用户控制的个人上下文框架。" }
]`,
}

const STATUS_LABELS = { ready: '可导入', duplicate: '重复', invalid: '无效' } as const

export default function ImportPage({ client }: { client: ApiClient }) {
  const [format, setFormat] = useState<Format>('markdown')
  const [content, setContent] = useState('')
  const [source, setSource] = useState('')
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [result, setResult] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  function reset() {
    setPreview(null); setResult(null); setSelected(new Set()); setError('')
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const text = await file.text()
    setContent(text)
    setFormat(file.name.toLowerCase().endsWith('.json') ? 'json' : 'markdown')
    reset()
  }

  function fillSample() {
    setContent(SAMPLES[format])
    reset()
  }

  async function runPreview() {
    setBusy('preview'); setError(''); setResult(null)
    try {
      const next = await client.importPreview(format, content)
      setPreview(next)
      setSelected(new Set(next.items.filter((item) => item.status === 'ready').map((item) => item.index)))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '解析失败，请检查格式。')
    } finally { setBusy('') }
  }

  function toggle(index: number) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index); else next.add(index)
      return next
    })
  }

  async function runImport() {
    if (!preview) return
    const items = preview.items.filter((item) => selected.has(item.index) && item.status === 'ready')
    if (!items.length) return
    setBusy('commit'); setError('')
    try {
      const next = await client.importCommit(
        items.map((item) => ({ type: item.type, subject: item.subject, content: item.content })),
        source.trim() || 'local-import',
      )
      setResult(next)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '导入失败。')
    } finally { setBusy('') }
  }

  const readyItems = preview?.items.filter((item) => item.status === 'ready') ?? []
  const selectedCount = readyItems.filter((item) => selected.has(item.index)).length

  return <section className="import-page">
    <header className="backup-heading compact-heading">
      <div><p className="eyebrow">IMPORT / CANDIDATE REVIEW</p><p>把 Markdown 或 JSON 中的内容导入为候选记忆。导入只写入本地 Inbox，必须经过记忆审核确认后才会进入正式档案。</p></div>
      <span className="boundary-badge"><CheckCircle size={18} />不自动确认</span>
    </header>

    {error && <div className="backup-message error" role="alert"><Warning /><span>{error}</span></div>}

    {!result && <>
      <section className="import-input" aria-label="导入输入">
        <div className="import-formats" role="group" aria-label="导入格式">
          {(['markdown', 'json'] as Format[]).map((key) => <button key={key} className={format === key ? 'active' : ''} aria-pressed={format === key} onClick={() => { setFormat(key); reset() }}>{key === 'markdown' ? 'Markdown' : 'JSON'}</button>)}
        </div>
        <label className="import-source">来源标注（可选）<input aria-label="来源标注" value={source} onChange={(event) => { setSource(event.target.value); reset() }} placeholder="例如：从 Obsidian 导入" /></label>
        <textarea aria-label="导入内容" value={content} onChange={(event) => { setContent(event.target.value); reset() }} placeholder={format === 'markdown' ? '用 --- 分隔每条记录，可在开头用 type / subject 标注' : '粘贴 JSON 数组，每项包含 type、subject、content'} spellCheck={false} />
        <div className="import-actions">
          <button className="secondary-action" onClick={() => fileRef.current?.click()} disabled={Boolean(busy)}><CloudArrowUp size={16} />选择文件</button>
          <button className="text-button" onClick={fillSample} disabled={Boolean(busy)}>填入示例</button>
          <button className="primary-action" onClick={() => void runPreview()} disabled={Boolean(busy) || !content.trim()}>{busy === 'preview' ? '正在解析…' : '预览'}</button>
        </div>
        <input ref={fileRef} type="file" accept=".md,.markdown,.json,.txt" className="sr-only" onChange={(event) => void handleFile(event)} />
      </section>

      {preview && <section className="import-preview" aria-label="导入预览">
        <header><div><p className="eyebrow">PREVIEW / CONFIRM REQUIRED</p><h3>确认要导入的条目</h3></div><span>{preview.summary.ready} / {preview.summary.total} 可导入</span></header>
        <p className="import-hint">重复或无效的条目不会被导入；导入后仍需逐条审核确认。</p>
        <ul className="import-list">
          {preview.items.map((item) => <li key={item.index} className={`import-item status-${item.status}`}>
            <label className="import-check">
              <input type="checkbox" checked={item.status === 'ready' && selected.has(item.index)} disabled={item.status !== 'ready'} onChange={() => toggle(item.index)} aria-label={`选择条目 ${item.index + 1}`} />
            </label>
            <div className="import-item-body">
              <div className="import-item-head"><span className="import-type">{item.type}</span>{item.subject && <strong>{item.subject}</strong>}<span className={`import-status import-status-${item.status}`}>{STATUS_LABELS[item.status]}</span></div>
              <p className="import-preview-text">{item.preview}</p>
              {item.reason && <p className="import-reason">{item.reason}</p>}
            </div>
          </li>)}
        </ul>
        <div className="import-actions">
          <button className="text-button" onClick={reset} disabled={Boolean(busy)}><ArrowLeft size={16} />返回修改</button>
          <button className="primary-action" onClick={() => void runImport()} disabled={Boolean(busy) || !selectedCount}>{busy === 'commit' ? '正在导入…' : `导入 ${selectedCount} 条候选`}</button>
        </div>
      </section>}
    </>}

    {result && <section className="import-result" aria-label="导入结果">
      <StateBlock tone="success" icon={<CheckCircle size={22} />} title={`已导入 ${result.created.length} 条候选记忆`} description="它们已写入本地 Inbox，等待你在记忆审核中逐条确认。" />
      {result.skipped.length > 0 && <div className="import-skipped"><h4>跳过 {result.skipped.length} 条</h4><ul>{result.skipped.map((item, index) => <li key={index}><span className="import-type">{item.type}</span>{item.subject && <strong>{item.subject}</strong>}<span>{item.reason}</span></li>)}</ul></div>}
      <div className="import-actions">
        <button className="secondary-action" onClick={() => { reset(); setContent(''); setSource('') }}>继续导入</button>
        <button className="primary-action" onClick={() => { window.location.hash = '#/memory-review' }}>前往记忆审核<ArrowRight size={16} /></button>
      </div>
    </section>}
  </section>
}
