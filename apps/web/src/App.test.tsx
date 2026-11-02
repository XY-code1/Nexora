import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'

afterEach(() => vi.restoreAllMocks())

const memory = {
  id: 'mem-20261102-12345678', status: 'candidate', type: 'preference', subject: '回答风格', sourceAgent: 'test-agent',
  created: '2026-11-02T10:00:00+00:00', updated: '2026-11-02T10:00:00+00:00', content: '回答先给结论。', revision: 'a'.repeat(64),
}

function response(data: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }))
}

describe('review workspace', () => {
  it('loads, edits, confirms and removes a candidate', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => response({ data: [memory], meta: { requestId: '1' } }))
      .mockImplementationOnce(() => response({ data: { ...memory, content: '更新内容', revision: 'b'.repeat(64) }, meta: { requestId: '2' } }))
      .mockImplementationOnce(() => response({ data: { id: memory.id, action: 'confirm', status: 'completed' }, meta: { requestId: '3' } }))
      .mockImplementationOnce(() => response({ data: [], meta: { requestId: '4' } }))

    render(<App />)
    fireEvent.change(screen.getByLabelText('本地启动令牌'), { target: { value: 'test-token' } })
    fireEvent.click(screen.getByRole('button', { name: '连接审核空间' }))
    expect((await screen.findAllByText('回答风格')).length).toBeGreaterThan(0)

    fireEvent.change(screen.getByLabelText('记忆内容'), { target: { value: '更新内容' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
    await screen.findByText('修改已保存。')
    fireEvent.click(screen.getByRole('button', { name: '确认记忆' }))
    await screen.findByText('记忆已确认。')
    await screen.findByText('暂时没有候选记忆')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('shows a refreshable conflict message for 409', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => response({ data: [memory], meta: { requestId: '1' } }))
      .mockImplementationOnce(() => response({ error: { code: 'REVISION_CONFLICT', message: 'stale', details: {} }, requestId: '2' }, 409))

    render(<App />)
    fireEvent.change(screen.getByLabelText('本地启动令牌'), { target: { value: 'test-token' } })
    fireEvent.click(screen.getByRole('button', { name: '连接审核空间' }))
    await screen.findAllByText('回答风格')
    fireEvent.click(screen.getByRole('button', { name: '确认记忆' }))
    await waitFor(() => expect(screen.getByText(/刚刚被其他入口修改/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '刷新数据' })).toBeInTheDocument()
  })
})
