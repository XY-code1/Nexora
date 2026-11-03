import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

afterEach(() => {
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})
beforeEach(() => vi.spyOn(window, 'confirm').mockReturnValue(true))

const memory = {
  id: 'mem-20261102-12345678', status: 'candidate', type: 'preference', subject: '回答风格', sourceAgent: 'test-agent',
  created: '2026-11-02T10:00:00+00:00', updated: '2026-11-02T10:00:00+00:00', visibility: 'private', aiAccess: 'summary-only', tags: [], content: '回答先给结论。', revision: 'a'.repeat(64),
}
const stats = { candidateMemories: 1, pendingReview: 1, confirmedMemories: 0 }
const securityOverview = {
  diagnostics: { localService: 'ok', vault: 'ready', mcp: 'not-configured', authorizedClients: 0, recentDenied: 0, audit: { status: 'missing', events: 0, lastHash: '' } },
  scopes: ['profile:read', 'memory:search'],
}
const emptyAudit = { items: [], page: 1, pageSize: 25, total: 0, integrity: { status: 'missing', events: 0 } }

function response(data: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }))
}

async function connect() {
  fireEvent.change(screen.getByLabelText('本地启动令牌'), { target: { value: 'test-token' } })
  fireEvent.click(screen.getByRole('button', { name: '连接审核空间' }))
  await screen.findAllByText('回答风格')
}

describe('review workspace', () => {
  it('keeps the token gate open after an invalid token and allows retry', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => response({ error: { code: 'UNAUTHORIZED', message: 'bad token', details: {} }, requestId: '1' }, 401))
    render(<App />)
    fireEvent.change(screen.getByLabelText('本地启动令牌'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: '连接审核空间' }))
    await screen.findByText('启动令牌无效，请检查后重新输入。')
    expect(screen.getByRole('button', { name: '连接审核空间' })).toBeInTheDocument()
  })

  it('loads, edits, confirms and removes a candidate', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => response({ data: [memory], meta: { requestId: '1' } }))
      .mockImplementationOnce(() => response({ data: stats, meta: { requestId: 'stats-1' } }))
      .mockImplementationOnce(() => response({ data: { ...memory, content: '更新内容', revision: 'b'.repeat(64) }, meta: { requestId: '2' } }))
      .mockImplementationOnce(() => response({ data: [{ ...memory, content: '更新内容', revision: 'b'.repeat(64) }], meta: { requestId: 'refresh-1' } }))
      .mockImplementationOnce(() => response({ data: stats, meta: { requestId: 'stats-refresh' } }))
      .mockImplementationOnce(() => response({ data: { id: memory.id, action: 'confirm', status: 'completed' }, meta: { requestId: '3' } }))
      .mockImplementationOnce(() => response({ data: [], meta: { requestId: '4' } }))
      .mockImplementationOnce(() => response({ data: { ...stats, candidateMemories: 0, pendingReview: 0, confirmedMemories: 1 }, meta: { requestId: 'stats-2' } }))

    render(<App />)
    await connect()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Memory' }))
    fireEvent.change(screen.getByLabelText('记忆内容'), { target: { value: '更新内容' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
    await screen.findByText('修改已保存。')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Memory' }))
    await screen.findByText('记忆已确认。')
    await screen.findByText('暂时没有候选记忆')
    expect(window.confirm).toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(8)
  })

  it('sends a rejection reason and supports disconnect', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => response({ data: [memory], meta: { requestId: '1' } }))
      .mockImplementationOnce(() => response({ data: stats, meta: { requestId: 'stats-1' } }))
      .mockImplementationOnce(() => response({ data: { id: memory.id, action: 'reject', status: 'completed' }, meta: { requestId: '2' } }))
      .mockImplementationOnce(() => response({ data: [], meta: { requestId: '3' } }))
      .mockImplementationOnce(() => response({ data: { ...stats, candidateMemories: 0, pendingReview: 0 }, meta: { requestId: 'stats-2' } }))
    render(<App />)
    await connect()
    fireEvent.change(screen.getByLabelText('拒绝原因（可选）'), { target: { value: '不是长期信息' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reject Memory' }))
    await screen.findByText('候选记忆已拒绝。')
    expect(fetchMock.mock.calls[2]?.[1]?.body).toContain('不是长期信息')
    fireEvent.click(screen.getByRole('button', { name: '断开连接' }))
    expect(screen.getByRole('button', { name: '连接审核空间' })).toBeInTheDocument()
  })

  it('shows a refreshable conflict message for 409', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => response({ data: [memory], meta: { requestId: '1' } }))
      .mockImplementationOnce(() => response({ data: stats, meta: { requestId: 'stats-1' } }))
      .mockImplementationOnce(() => response({ error: { code: 'REVISION_CONFLICT', message: 'stale', details: {} }, requestId: '2' }, 409))

    render(<App />)
    await connect()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Memory' }))
    await waitFor(() => expect(screen.getByText(/刚刚被其他入口修改/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '刷新数据' })).toBeInTheDocument()
  })

  it('consumes a launcher token from the fragment and closes the local service', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => response({ data: [memory], meta: { requestId: '1' } }))
      .mockImplementationOnce(() => response({ data: stats, meta: { requestId: 'stats-1' } }))
      .mockImplementationOnce(() => response({ data: { status: 'shutting-down' }, meta: { requestId: '2' } }))
    window.history.replaceState(null, '', '/#token=launcher-token')

    render(<App />)
    await screen.findAllByText('回答风格')
    expect(window.location.hash).toBe('')
    fireEvent.click(screen.getByRole('button', { name: '关闭服务' }))
    await screen.findByRole('heading', { name: '本地服务已关闭' })
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/v1/shutdown')
  })

  it('shows privacy-trimmed visualization pages on demand', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => response({ data: [memory], meta: { requestId: '1' } }))
      .mockImplementationOnce(() => response({ data: stats, meta: { requestId: 'stats-1' } }))
      .mockImplementationOnce(() => response({ data: { access: 'allowed', protected: false, sections: [{ title: 'Stable preferences', items: ['先给结论'] }] }, meta: { requestId: '2' } }))
      .mockImplementationOnce(() => response({ data: [{ ...memory, access: 'summary-only', previewAvailable: true, preview: '回答先给结论。' }], meta: { requestId: '3' } }))
      .mockImplementationOnce(() => response({ data: securityOverview, meta: { requestId: '4a' } }))
      .mockImplementationOnce(() => response({ data: [], meta: { requestId: '4b' } }))
      .mockImplementationOnce(() => response({ data: emptyAudit, meta: { requestId: '4c' } }))
      .mockImplementationOnce(() => response({ data: emptyAudit, meta: { requestId: '4d' } }))
      .mockImplementationOnce(() => response({ data: { disclaimer: '仅用于自我反思，不是医学或心理诊断。', dimensions: ['mind', 'body', 'spirit', 'vocation'], points: [] }, meta: { requestId: '5' } }))
    render(<App />)
    await connect()
    fireEvent.click(screen.getByRole('button', { name: '个人档案' }))
    await screen.findByText('先给结论')
    expect(screen.getByText('确认边界已启用')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /全息关系图谱的视觉框架/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '记忆时间线' }))
    await screen.findByRole('button', { name: '查看确认摘要' })
    expect(screen.queryByText('回答先给结论。')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '查看确认摘要' }))
    expect(screen.getByText('回答先给结论。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '隐私审计' }))
    await screen.findByRole('heading', { name: 'Security Center' })
    expect(screen.getAllByText('尚无审计记录').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Human 3.0趋势' }))
    await screen.findByText('还没有已确认的复盘')
    expect(fetchMock).toHaveBeenCalledTimes(9)
  })

  it('renders an honest empty profile without inventing relationships', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => response({ data: [], meta: { requestId: '1' } }))
      .mockImplementationOnce(() => response({ data: { candidateMemories: 0, pendingReview: 0, confirmedMemories: 0 }, meta: { requestId: 'stats-1' } }))
      .mockImplementationOnce(() => response({ data: { access: 'allowed', protected: false, sections: [], hasConfirmedMemories: false }, meta: { requestId: '2' } }))
    render(<App />)
    fireEvent.change(screen.getByLabelText('本地启动令牌'), { target: { value: 'test-token' } })
    fireEvent.click(screen.getByRole('button', { name: '连接审核空间' }))
    await screen.findByText('暂时没有候选记忆')
    fireEvent.click(screen.getByRole('button', { name: '个人档案' }))
    await screen.findByText('档案还是空的')
    expect(screen.getByText('暂无可展示的已确认记忆')).toBeInTheDocument()
    expect(screen.queryByText(/已确认记忆 \([1-9]/)).not.toBeInTheDocument()
  })

  it('does not render a stale visualization response after reconnecting', async () => {
    let resolveOld!: (value: Response) => void
    const oldPrivacy = new Promise<Response>((resolve) => { resolveOld = resolve })
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => response({ data: [memory], meta: { requestId: '1' } }))
      .mockImplementationOnce(() => response({ data: stats, meta: { requestId: 'stats-1' } }))
      .mockImplementationOnce(() => oldPrivacy)
      .mockImplementationOnce(() => response({ data: [], meta: { requestId: 'security-clients' } }))
      .mockImplementationOnce(() => response({ data: emptyAudit, meta: { requestId: 'security-audit' } }))
      .mockImplementationOnce(() => response({ data: emptyAudit, meta: { requestId: 'security-lifecycle' } }))
      .mockImplementationOnce(() => response({ data: [], meta: { requestId: '3' } }))
      .mockImplementationOnce(() => response({ data: { candidateMemories: 0, pendingReview: 0, confirmedMemories: 0 }, meta: { requestId: 'stats-2' } }))
    render(<App />)
    await connect()
    fireEvent.click(screen.getByRole('button', { name: '隐私审计' }))
    fireEvent.click(screen.getByRole('button', { name: '断开连接' }))
    fireEvent.change(screen.getByLabelText('本地启动令牌'), { target: { value: 'new-token' } })
    fireEvent.click(screen.getByRole('button', { name: '连接审核空间' }))
    await screen.findByText('暂时没有候选记忆')
    resolveOld(new Response(JSON.stringify({ data: securityOverview, meta: { requestId: '2' } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await Promise.resolve()
    expect(screen.queryByRole('heading', { name: 'Security Center' })).not.toBeInTheDocument()
    expect(screen.getByText('暂时没有候选记忆')).toBeInTheDocument()
  })

  it('collects one onboarding answer as a reviewable candidate', async () => {
    const onboarding = {
      topics: [
        { key: 'identity', title: '称呼与基本偏好', prompt: '我应该怎么称呼你？', status: 'available' },
        { key: 'communication', title: '沟通方式', prompt: '希望如何沟通？', status: 'available' },
      ], nextTopic: 'identity', completed: false, notice: '回答只会保存为候选记忆。',
    }
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => response({ data: [], meta: { requestId: '1' } }))
      .mockImplementationOnce(() => response({ data: { candidateMemories: 0, pendingReview: 0, confirmedMemories: 0 }, meta: { requestId: 'stats-1' } }))
      .mockImplementationOnce(() => response({ data: onboarding, meta: { requestId: '2' } }))
      .mockImplementationOnce(() => response({ data: { candidateId: 'mem-onboarding', state: { ...onboarding, topics: [{ ...onboarding.topics[0], status: 'pending' }, onboarding.topics[1]], nextTopic: 'communication' } }, meta: { requestId: '3' } }))
    render(<App />)
    fireEvent.change(screen.getByLabelText('本地启动令牌'), { target: { value: 'test-token' } })
    fireEvent.click(screen.getByRole('button', { name: '连接审核空间' }))
    await screen.findByText('暂时没有候选记忆')
    fireEvent.click(screen.getByRole('button', { name: '对话式引导' }))
    await screen.findByText('我应该怎么称呼你？')
    fireEvent.change(screen.getByLabelText('你的回答'), { target: { value: '请称呼我为小明' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /我同意将这次回答创建为候选记忆/ }))
    fireEvent.click(screen.getByRole('button', { name: '保存为候选并继续' }))
    await screen.findByText('回答已保存为候选记忆，确认前不会成为长期事实。')
    expect(screen.getByText('希望如何沟通？')).toBeInTheDocument()
  })

  it('creates a persistent monthly reflection draft', async () => {
    const reflection = {
      id: 'mr-2026-11-1234abcd', month: '2026-11', status: 'draft', dimensions: { mind: '', body: '', spirit: '', vocation: '' },
      events: [], summary: '', summarySource: '', goals: [], completedDimensions: 0, readyToConfirm: false, revision: 'a'.repeat(64), updated: '2026-11-03T10:00:00Z',
    }
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => response({ data: [], meta: { requestId: '1' } }))
      .mockImplementationOnce(() => response({ data: { candidateMemories: 0, pendingReview: 0, confirmedMemories: 0 }, meta: { requestId: 'stats-1' } }))
      .mockImplementationOnce(() => response({ data: { currentMonth: '2026-11', reflections: [] }, meta: { requestId: '2' } }))
      .mockImplementationOnce(() => response({ data: reflection, meta: { requestId: '3' } }))
    render(<App />)
    fireEvent.change(screen.getByLabelText('本地启动令牌'), { target: { value: 'test-token' } })
    fireEvent.click(screen.getByRole('button', { name: '连接审核空间' }))
    await screen.findByText('暂时没有候选记忆')
    fireEvent.click(screen.getByRole('button', { name: '月度复盘' }))
    const create = await screen.findAllByRole('button', { name: /创建 2026-11 复盘/ })
    fireEvent.click(create[0])
    await screen.findByText('本月复盘草稿已创建并保存在本地。')
    expect(screen.getByText('继续整理这个月')).toBeInTheDocument()
  })

  it('keeps formal monthly confirmation disabled until four dimensions and summary exist', async () => {
    const reflection = {
      id: 'mr-2026-11-1234abcd', month: '2026-11', status: 'draft', dimensions: { mind: '事实', body: '', spirit: '', vocation: '' },
      events: [], summary: '', summarySource: '', goals: [], completedDimensions: 1, readyToConfirm: false, revision: 'a'.repeat(64), updated: '2026-11-03T10:00:00Z',
    }
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => response({ data: [], meta: { requestId: '1' } }))
      .mockImplementationOnce(() => response({ data: { candidateMemories: 0, pendingReview: 0, confirmedMemories: 0 }, meta: { requestId: 'stats-1' } }))
      .mockImplementationOnce(() => response({ data: { currentMonth: '2026-11', reflections: [reflection] }, meta: { requestId: '2' } }))
    render(<App />)
    fireEvent.change(screen.getByLabelText('本地启动令牌'), { target: { value: 'test-token' } })
    fireEvent.click(screen.getByRole('button', { name: '连接审核空间' }))
    await screen.findByText('暂时没有候选记忆')
    fireEvent.click(screen.getByRole('button', { name: '月度复盘' }))
    const confirm = await screen.findByRole('button', { name: '确认正式复盘' })
    expect(confirm).toBeDisabled()
    expect(screen.getByText(/不会自动评分或生成成长标签/)).toBeInTheDocument()
  })
})
