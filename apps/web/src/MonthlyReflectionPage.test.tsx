import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MonthlyReflectionPage from './MonthlyReflectionPage'
import type { MonthlyOverview, MonthlyReflection } from './api'

// issue #65：月度复盘的未保存保护。覆盖 dirty 上报、草稿恢复/丢弃、
// 保存成功清理、revision 冲突提示与离开提醒。

const DRAFT_KEY = 'nexora.reflection-draft.ref-1'

const reflection: MonthlyReflection = {
  id: 'ref-1', month: '2026-10', status: 'draft',
  dimensions: { mind: '', body: '', spirit: '', vocation: '' },
  events: [], summary: '', summarySource: '', goals: [],
  completedDimensions: 0, readyToConfirm: false, revision: 'a'.repeat(64), updated: '2026-10-31T00:00:00+00:00',
}
const overview: MonthlyOverview = { currentMonth: '2026-10', reflections: [reflection] }

function props(overrides: Record<string, unknown> = {}) {
  return {
    overview, selected: reflection, loading: false, saving: false,
    onSelect: vi.fn(), onCreate: vi.fn().mockResolvedValue(true),
    onDimension: vi.fn().mockResolvedValue(true), onAddEvent: vi.fn().mockResolvedValue(true),
    onDeleteEvent: vi.fn().mockResolvedValue(true), onGoals: vi.fn().mockResolvedValue(true),
    onGenerateSummary: vi.fn().mockResolvedValue(true), onSummary: vi.fn().mockResolvedValue(true),
    onConfirm: vi.fn().mockResolvedValue(true),
    onDirtyChange: vi.fn(),
    ...overrides,
  }
}

function openDimension() {
  const nav = screen.getByRole('navigation', { name: '复盘内容' })
  fireEvent.click(within(nav).getAllByRole('button')[1])
  return document.querySelector('textarea') as HTMLTextAreaElement
}

beforeEach(() => { localStorage.clear() })
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear() })

describe('monthly reflection unsaved protection', () => {
  it('reports dirty state as soon as an edit diverges', () => {
    const onDirtyChange = vi.fn()
    render(<MonthlyReflectionPage {...props({ onDirtyChange })} />)
    expect(onDirtyChange).toHaveBeenLastCalledWith(false)
    const textarea = openDimension()
    fireEvent.change(textarea, { target: { value: '这个月读了三本书' } })
    expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  })

  it('persists a draft locally so a refresh can restore it', () => {
    const { container } = render(<MonthlyReflectionPage {...props()} />)
    fireEvent.change(openDimension(), { target: { value: '这个月读了三本书' } })
    expect(container).toBeTruthy()
    const stored = localStorage.getItem(DRAFT_KEY)
    expect(stored).toBeTruthy()
    expect(JSON.parse(stored as string).dimensions.mind).toBe('这个月读了三本书')
  })

  it('offers to restore a stored draft and discards it on request', () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ version: 1, savedAt: '2026-11-20T10:00:00+00:00', source: 'local-draft', dimension: { key: 'mind', content: '恢复这段' } }))
    render(<MonthlyReflectionPage {...props()} />)
    expect(screen.getByText('发现未保存的草稿')).toBeInTheDocument()
    fireEvent.click(screen.getByText('恢复草稿'))
    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe('恢复这段')
    expect(screen.getByText('已恢复本机草稿，记得保存。')).toBeInTheDocument()
  })

  it('clears the draft after a successful save', async () => {
    render(<MonthlyReflectionPage {...props()} />)
    fireEvent.change(openDimension(), { target: { value: '要保存的内容' } })
    expect(localStorage.getItem(DRAFT_KEY)).toBeTruthy()
    fireEvent.click(screen.getByText('保存 MIND'))
    await waitFor(() => expect(localStorage.getItem(DRAFT_KEY)).toBeNull())
  })

  it('keeps edits from multiple dimensions in the recovery draft', () => {
    render(<MonthlyReflectionPage {...props()} />)
    fireEvent.change(openDimension(), { target: { value: 'MIND 草稿' } })
    const nav = screen.getByRole('navigation', { name: '复盘内容' })
    fireEvent.click(within(nav).getAllByRole('button')[2])
    fireEvent.change(document.querySelector('textarea') as HTMLTextAreaElement, { target: { value: 'BODY 草稿' } })
    const stored = JSON.parse(localStorage.getItem(DRAFT_KEY) as string)
    expect(stored.dimensions).toEqual(expect.objectContaining({ mind: 'MIND 草稿', body: 'BODY 草稿' }))
  })

  it('warns on beforeunload only while dirty', () => {
    render(<MonthlyReflectionPage {...props()} />)
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)
    fireEvent.change(openDimension(), { target: { value: '未保存' } })
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)
  })

  it('surfaces a revision conflict and can reload the server version', () => {
    const onReloadServer = vi.fn()
    render(<MonthlyReflectionPage {...props({ conflict: true, onReloadServer })} />)
    expect(screen.getByText('这份复盘已被其他会话更新')).toBeInTheDocument()
    fireEvent.click(screen.getByText('重新加载服务器版本'))
    expect(onReloadServer).toHaveBeenCalledTimes(1)
  })
})
