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
  created: '2026-11-02T10:00:00+00:00', updated: '2026-11-02T10:00:00+00:00', content: '回答先给结论。', revision: 'a'.repeat(64),
}

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
      .mockImplementationOnce(() => response({ data: { ...memory, content: '更新内容', revision: 'b'.repeat(64) }, meta: { requestId: '2' } }))
      .mockImplementationOnce(() => response({ data: { id: memory.id, action: 'confirm', status: 'completed' }, meta: { requestId: '3' } }))
      .mockImplementationOnce(() => response({ data: [], meta: { requestId: '4' } }))

    render(<App />)
    await connect()
    fireEvent.change(screen.getByLabelText('记忆内容'), { target: { value: '更新内容' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
    await screen.findByText('修改已保存。')
    fireEvent.click(screen.getByRole('button', { name: '确认记忆' }))
    await screen.findByText('记忆已确认。')
    await screen.findByText('暂时没有候选记忆')
    expect(window.confirm).toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('sends a rejection reason and supports disconnect', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => response({ data: [memory], meta: { requestId: '1' } }))
      .mockImplementationOnce(() => response({ data: { id: memory.id, action: 'reject', status: 'completed' }, meta: { requestId: '2' } }))
      .mockImplementationOnce(() => response({ data: [], meta: { requestId: '3' } }))
    render(<App />)
    await connect()
    fireEvent.change(screen.getByLabelText('拒绝原因（可选）'), { target: { value: '不是长期信息' } })
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }))
    await screen.findByText('候选记忆已拒绝。')
    expect(fetchMock.mock.calls[1]?.[1]?.body).toContain('不是长期信息')
    fireEvent.click(screen.getByRole('button', { name: '断开连接' }))
    expect(screen.getByRole('button', { name: '连接审核空间' })).toBeInTheDocument()
  })

  it('shows a refreshable conflict message for 409', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => response({ data: [memory], meta: { requestId: '1' } }))
      .mockImplementationOnce(() => response({ error: { code: 'REVISION_CONFLICT', message: 'stale', details: {} }, requestId: '2' }, 409))

    render(<App />)
    await connect()
    fireEvent.click(screen.getByRole('button', { name: '确认记忆' }))
    await waitFor(() => expect(screen.getByText(/刚刚被其他入口修改/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '刷新数据' })).toBeInTheDocument()
  })

  it('consumes a launcher token from the fragment and closes the local service', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => response({ data: [memory], meta: { requestId: '1' } }))
      .mockImplementationOnce(() => response({ data: { status: 'shutting-down' }, meta: { requestId: '2' } }))
    window.history.replaceState(null, '', '/#token=launcher-token')

    render(<App />)
    await screen.findAllByText('回答风格')
    expect(window.location.hash).toBe('')
    fireEvent.click(screen.getByRole('button', { name: '关闭服务' }))
    await screen.findByRole('heading', { name: '本地服务已关闭' })
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/shutdown')
  })

  it('shows privacy-trimmed visualization pages on demand', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => response({ data: [memory], meta: { requestId: '1' } }))
      .mockImplementationOnce(() => response({ data: { access: 'allowed', protected: false, sections: [{ title: 'Stable preferences', items: ['先给结论'] }] }, meta: { requestId: '2' } }))
      .mockImplementationOnce(() => response({ data: [{ ...memory, access: 'summary-only', previewAvailable: true, preview: '回答先给结论。' }], meta: { requestId: '3' } }))
      .mockImplementationOnce(() => response({ data: { totalMemories: 1, byStatus: { confirmed: 1 }, byAccess: { 'summary-only': 1 }, bySource: {}, mcpEvents: {}, issues: [], rules: ['所有统计仅在本机生成'] }, meta: { requestId: '4' } }))
      .mockImplementationOnce(() => response({ data: { disclaimer: '仅用于自我反思，不是医学或心理诊断。', dimensions: ['mind', 'body', 'spirit', 'vocation'], points: [] }, meta: { requestId: '5' } }))
    render(<App />)
    await connect()
    fireEvent.click(screen.getByRole('button', { name: '个人档案' }))
    await screen.findByText('先给结论')
    fireEvent.click(screen.getByRole('button', { name: '记忆时间线' }))
    await screen.findByRole('button', { name: '查看确认摘要' })
    expect(screen.queryByText('回答先给结论。')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '查看确认摘要' }))
    expect(screen.getByText('回答先给结论。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '隐私审计' }))
    await screen.findByText('所有统计仅在本机生成')
    fireEvent.click(screen.getByRole('button', { name: 'Human 3.0' }))
    await screen.findByText('还没有已确认的复盘')
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('does not render a stale visualization response after reconnecting', async () => {
    let resolveOld!: (value: Response) => void
    const oldPrivacy = new Promise<Response>((resolve) => { resolveOld = resolve })
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => response({ data: [memory], meta: { requestId: '1' } }))
      .mockImplementationOnce(() => oldPrivacy)
      .mockImplementationOnce(() => response({ data: [], meta: { requestId: '3' } }))
    render(<App />)
    await connect()
    fireEvent.click(screen.getByRole('button', { name: '隐私审计' }))
    fireEvent.click(screen.getByRole('button', { name: '断开连接' }))
    fireEvent.change(screen.getByLabelText('本地启动令牌'), { target: { value: 'new-token' } })
    fireEvent.click(screen.getByRole('button', { name: '连接审核空间' }))
    await screen.findByText('暂时没有候选记忆')
    resolveOld(new Response(JSON.stringify({ data: { totalMemories: 1, byStatus: {}, byAccess: {}, bySource: {}, mcpEvents: {}, issues: [], rules: ['旧 Vault 私密规则'] }, meta: { requestId: '2' } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    await Promise.resolve()
    expect(screen.queryByText('旧 Vault 私密规则')).not.toBeInTheDocument()
    expect(screen.getByText('暂时没有候选记忆')).toBeInTheDocument()
  })
})
