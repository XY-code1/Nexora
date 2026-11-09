import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

// 每个测试后卸载上一棵组件树：否则残留实例会在后续测试里继续响应未完成的
// promise，造成状态污染与随机的 act(...) 警告（同一输入下时过时不过）。
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})
beforeEach(() => {
  window.history.replaceState(null, '', '/#/memory-review')
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

const memory = {
  id: 'mem-20261102-12345678', status: 'candidate', type: 'preference', subject: '回答风格', sourceAgent: 'test-agent',
  created: '2026-11-02T10:00:00+00:00', updated: '2026-11-02T10:00:00+00:00', visibility: 'private', aiAccess: 'summary-only', tags: [], content: '回答先给结论。', revision: 'a'.repeat(64),
}
const stats = { candidateMemories: 1, pendingReview: 1, confirmedMemories: 0 }
// 已使用过的 Vault（档案/记忆非全空），用于跳过一次性首次启动向导的场景。
const usedStats = { candidateMemories: 1, pendingReview: 1, confirmedMemories: 1 }
const securityOverview = {
  diagnostics: { localService: 'ok', vault: 'ready', mcp: 'not-configured', authorizedClients: 0, recentDenied: 0, audit: { status: 'missing', events: 0, lastHash: '' } },
  scopes: ['profile:read', 'memory:search'],
}
const emptyAudit = { items: [], page: 1, pageSize: 25, total: 0, integrity: { status: 'missing', events: 0 } }

function response(data: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }))
}

/**
 * 按请求路径分发响应的 mock。
 *
 * 用 `mockImplementationOnce` 链式 mock 时，App 在 useEffect 里触发的后台请求
 * 可能插进链中间，导致后续请求拿到错位的响应——这是既有的 flaky 来源
 * （HEAD 上同样可复现）。按路径分发后，请求顺序不再影响结果。
 *
 * 同一路径需要按调用次序返回不同数据时，把值写成函数：它会收到该路径的调用序号。
 */
function mockApi(routes: Record<string, unknown>) {
  const calls: string[] = []
  const seen: Record<string, number> = {}
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]
    calls.push(path)
    const keys = Object.keys(routes)
    // 精确匹配优先；否则用前缀匹配，但必须能区分 /memories 与 /memories/{id}。
    const key = keys.find((candidate) => path === candidate)
      ?? keys.find((candidate) => path.startsWith(candidate) && !keys.some((other) => other !== candidate && other.startsWith(candidate)))
    if (!key) return response({ error: { code: 'NOT_MOCKED', message: `未预置的请求：${path}`, details: {} }, requestId: 'unmocked' }, 404)
    const value = routes[key]
    const index = (seen[key] = (seen[key] ?? 0) + 1) - 1
    const body = typeof value === 'function' ? (value as (index: number) => unknown)(index) : value
    // 值本身是一个 Promise 时直接返回它，用于构造「延迟解析」的请求。
    if (body instanceof Promise) return body as Promise<Response>
    // 需要模拟失败响应时，把值写成 { error, status }。
    if (body && typeof body === 'object' && 'error' in body && 'status' in body) {
      return response({ error: (body as { error: unknown }).error, requestId: 'mock-error' }, (body as { status: number }).status)
    }
    return response({ data: body, meta: { requestId: 'mock' } })
  })
  return { spy, calls }
}

async function connect(expected = '回答风格') {
  fireEvent.change(screen.getByLabelText('本地启动令牌'), { target: { value: 'test-token' } })
  fireEvent.click(screen.getByRole('button', { name: '连接审核空间' }))
  await screen.findAllByText(expected)
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
    let confirmed = false
    mockApi({
      // 保存修改后列表仍在（内容已更新）；确认之后才移除。
      '/api/v1/memories': () => (confirmed ? [] : [memory]),
      '/api/v1/memory-stats': (index: number) => (index === 0 ? stats : { ...stats, candidateMemories: 0, pendingReview: 0, confirmedMemories: 1 }),
      '/api/v1/memories/mem-20261102-12345678': () => ({ ...memory, content: '更新内容', revision: 'b'.repeat(64) }),
      '/api/v1/memories/mem-20261102-12345678/confirm': () => {
        confirmed = true
        return { id: memory.id, action: 'confirm', status: 'completed' }
      },
    })

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
  })

  it('sends a rejection reason and supports disconnect', async () => {
    let rejected = false
    const { spy } = mockApi({
      '/api/v1/memories': () => (rejected ? [] : [memory]),
      '/api/v1/memory-stats': (index: number) => (index === 0 ? stats : { ...stats, candidateMemories: 0, pendingReview: 0 }),
      '/api/v1/memories/mem-20261102-12345678/reject': () => {
        rejected = true
        return { id: memory.id, action: 'reject', status: 'completed' }
      },
    })
    render(<App />)
    await connect()
    fireEvent.change(screen.getByLabelText('拒绝原因（可选）'), { target: { value: '不是长期信息' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reject Memory' }))
    await screen.findByText('候选记忆已拒绝。')
    // 拒绝原因必须随请求体提交（按端点路由后不再依赖调用顺序）。
    const rejectCall = spy.mock.calls.find(([, init]) => String(init?.method ?? 'GET').toUpperCase() === 'POST')
    expect(JSON.stringify(rejectCall?.[1]?.body)).toContain('不是长期信息')
    fireEvent.click(screen.getByRole('button', { name: '断开连接' }))
    expect(screen.getByRole('button', { name: '连接审核空间' })).toBeInTheDocument()
  })

  it('shows a refreshable conflict message for 409', async () => {
    mockApi({
      '/api/v1/memories': [memory],
      '/api/v1/memory-stats': stats,
      '/api/v1/memories/mem-20261102-12345678/confirm': { error: { code: 'REVISION_CONFLICT', message: 'stale', details: {} }, status: 409 },
    })

    render(<App />)
    await connect()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Memory' }))
    await waitFor(() => expect(screen.getByText(/刚刚被其他入口修改/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '刷新数据' })).toBeInTheDocument()
  })

  it('consumes a launcher token from the fragment and closes the local service', async () => {
    const { calls } = mockApi({
      '/api/v1/memories': [memory],
      '/api/v1/memory-stats': stats,
      '/api/v1/overview': { profile: { access: 'summary-only', protected: false, sections: [] }, memory: stats, clients: { total: 0, active: [] }, recentAccess: [], growth: { latestMonth: null }, pending: 1, vault: 'ready', initialized: true },
      '/api/v1/visualization/timeline': [],
      '/api/v1/vault': { vaultId: 'v1', displayName: '我的个人空间', schemaVersion: 1, revision: 'r1', externalChange: false },
      '/api/v1/backups': { currentRevision: 'r1', backups: [] },
      '/api/v1/shutdown': { status: 'shutting-down' },
    })
    window.history.replaceState(null, '', '/#token=launcher-token')

    render(<App />)
    await screen.findByText('欢迎回到你的个人空间')
    expect(window.location.hash).toBe('#/overview')
    fireEvent.click(screen.getByRole('button', { name: '关闭服务' }))
    await screen.findByRole('heading', { name: '本地服务已关闭' })
    expect(calls).toContain('/api/v1/shutdown')
  })

  it('shows privacy-trimmed visualization pages on demand', async () => {
    const { calls } = mockApi({
      '/api/v1/memories': [memory],
      '/api/v1/memory-stats': stats,
      '/api/v1/visualization/profile': { access: 'allowed', protected: false, sections: [{ title: 'Stable preferences', items: ['先给结论'] }] },
      '/api/v1/visualization/timeline': [{ ...memory, access: 'summary-only', previewAvailable: true, preview: '回答先给结论。' }],
      '/api/v1/security/overview': securityOverview,
      '/api/v1/security/clients': [],
      '/api/v1/security/audit-events': emptyAudit,
      '/api/v1/visualization/human3': { disclaimer: '仅用于自我反思，不是医学或心理诊断。', dimensions: ['mind', 'body', 'spirit', 'vocation'], points: [] },
    })
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
    // 断言实际访问过的端点，而不是请求总数——请求数依赖 useEffect 的时序顺序。
    expect(calls).toEqual(expect.arrayContaining([
      '/api/v1/visualization/profile',
      '/api/v1/visualization/timeline',
      '/api/v1/security/overview',
      '/api/v1/visualization/human3',
    ]))
  })

  it('shows the monthly trend view with an honest empty state', async () => {
    const { calls } = mockApi({
      '/api/v1/memories': [memory],
      '/api/v1/memory-stats': stats,
      '/api/v1/visualization/monthly': { disclaimer: '月度复盘仅用于自我反思，不推断成长分数。', dimensions: [{ key: 'mind', title: 'MIND — 认知与思维' }, { key: 'body', title: 'BODY — 身体与精力' }, { key: 'spirit', title: 'SPIRIT — 意义与关系' }, { key: 'vocation', title: 'VOCATION — 工作与创造' }], points: [] },
    })
    render(<App />)
    await connect()
    fireEvent.click(screen.getByRole('button', { name: '月度趋势' }))
    await screen.findByText('还没有已确认的月度复盘')
    expect(calls).toContain('/api/v1/visualization/monthly')
  })

  it('renders the Human 3.0 growth dashboard', async () => {
    mockApi({
      '/api/v1/memories': [memory],
      '/api/v1/memory-stats': stats,
      '/api/v1/growth/dimensions': { disclaimer: '仅用于自我反思。', dimensions: [] },
      '/api/v1/growth/assessments': { currentMonth: '2026-11', assessments: [] },
      '/api/v1/growth/timeline': { disclaimer: '仅用于自我反思。', months: [] },
      '/api/v1/growth/associations': [],
      '/api/v1/growth/goals': [],
    })
    render(<App />)
    await connect()
    fireEvent.click(screen.getByRole('button', { name: '成长仪表盘' }))
    await screen.findByText('Personal Growth Intelligence')
  })

  it('renders the overview page from the navigation', async () => {
    mockApi({
      '/api/v1/memories': [memory],
      '/api/v1/memory-stats': stats,
      '/api/v1/overview': { profile: { access: 'summary-only', protected: false, sections: [] }, memory: stats, clients: { total: 0, active: [] }, recentAccess: [], growth: { latestMonth: null }, pending: 0, vault: 'ready', initialized: true },
      '/api/v1/visualization/timeline': [],
      '/api/v1/vault': { vaultId: 'v1', displayName: '我的个人空间', schemaVersion: 1, revision: 'r1', externalChange: false },
      '/api/v1/backups': { currentRevision: 'r1', backups: [] },
    })
    render(<App />)
    await connect()
    fireEvent.click(screen.getByRole('button', { name: '概览' }))
    await screen.findByText('欢迎回到你的个人空间')
    // 首页回答四个问题：档案状态、新记忆、最值得处理的事、已授权 AI。
    expect(screen.getByText('已确认的个人信息')).toBeInTheDocument()
    expect(screen.getByText('最近的记忆变化')).toBeInTheDocument()
    expect(screen.getByText('已授权的 AI 工具')).toBeInTheDocument()
    expect(screen.getByText('本地文件与备份')).toBeInTheDocument()
    expect(screen.getAllByText('查看个人档案').length).toBeGreaterThan(0)
  })

  it('renders an honest empty profile without inventing relationships', async () => {
    mockApi({
      '/api/v1/memories': [],
      '/api/v1/memory-stats': usedStats,
      '/api/v1/visualization/profile': { access: 'allowed', protected: false, sections: [], hasConfirmedMemories: false },
    })
    render(<App />)
    await connect('暂时没有候选记忆')
    fireEvent.click(screen.getByRole('button', { name: '个人档案' }))
    await screen.findByText('档案还是空的')
    expect(screen.getByText('暂无可展示的已确认记忆')).toBeInTheDocument()
    expect(screen.queryByText(/已确认记忆 \([1-9]/)).not.toBeInTheDocument()
  })

  it('does not render a stale visualization response after reconnecting', async () => {
    let resolveOld!: (value: Response) => void
    const oldPrivacy = new Promise<Response>((resolve) => { resolveOld = resolve })
    mockApi({
      // 首次连接有候选记忆；断开重连后列表为空，用于验证旧请求结果不会泄漏。
      '/api/v1/memories': (index: number) => (index === 0 ? [memory] : []),
      '/api/v1/memory-stats': (index: number) => (index === 0 ? stats : { candidateMemories: 0, pendingReview: 0, confirmedMemories: 0 }),
      // 首次进入隐私审计的请求被挂起，断开连接后若仍被渲染即为泄漏。
      '/api/v1/security/overview': () => oldPrivacy,
      '/api/v1/security/clients': [],
      '/api/v1/security/audit-events': emptyAudit,
    })
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

  it('keeps conversational onboarding out of the daily workspace navigation', async () => {
    mockApi({ '/api/v1/memories': [], '/api/v1/memory-stats': usedStats })
    render(<App />)
    await connect('暂时没有候选记忆')
    expect(screen.queryByRole('button', { name: '对话式引导' })).not.toBeInTheDocument()
  })

  it('creates a persistent monthly reflection draft', async () => {
    const reflection = {
      id: 'mr-2026-11-1234abcd', month: '2026-11', status: 'draft', dimensions: { mind: '', body: '', spirit: '', vocation: '' },
      events: [], summary: '', summarySource: '', goals: [], completedDimensions: 0, readyToConfirm: false, revision: 'a'.repeat(64), updated: '2026-11-03T10:00:00Z',
    }
    mockApi({
      '/api/v1/memories': [],
      '/api/v1/memory-stats': usedStats,
      '/api/v1/monthly-reflections': (index: number) => (index === 0 ? { currentMonth: '2026-11', reflections: [] } : reflection),
    })
    render(<App />)
    await connect('暂时没有候选记忆')
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
    mockApi({
      '/api/v1/memories': [],
      '/api/v1/memory-stats': usedStats,
      '/api/v1/monthly-reflections': { currentMonth: '2026-11', reflections: [reflection] },
    })
    render(<App />)
    await connect('暂时没有候选记忆')
    fireEvent.click(screen.getByRole('button', { name: '月度复盘' }))
    const confirm = await screen.findByRole('button', { name: '确认正式复盘' })
    expect(confirm).toBeDisabled()
    expect(screen.getByText(/不会自动评分或生成成长标签/)).toBeInTheDocument()
  })

  it('shows the first-run wizard instead of the full menu for an untouched vault', async () => {
    const { spy, calls } = mockApi({
      '/api/v1/memories': [],
      '/api/v1/memory-stats': { candidateMemories: 0, pendingReview: 0, confirmedMemories: 0 },
      '/api/v1/overview': { profile: { access: 'allowed', protected: false, sections: [] }, memory: { candidateMemories: 0, pendingReview: 0, confirmedMemories: 0 }, clients: { total: 0, active: [] }, recentAccess: [], growth: { latestMonth: null }, pending: 0, vault: 'ready', initialized: false },
      '/api/v1/vault': { vaultId: 'v1', displayName: '我的个人空间', schemaVersion: 1, revision: 'r1', externalChange: false },
      '/api/v1/initialized': { initialized: true },
      '/api/v1/onboarding': { topics: [{ key: 'identity', title: '称呼与基本偏好', prompt: '我应该怎么称呼你？', status: 'available' }], nextTopic: 'identity', completed: false, notice: '回答只会保存为候选记忆。' },
    })
    render(<App />)
    fireEvent.change(screen.getByLabelText('本地启动令牌'), { target: { value: 'test-token' } })
    fireEvent.click(screen.getByRole('button', { name: '连接审核空间' }))

    // 首次启动直接进入一页式引导，不展示完整功能菜单。
    await screen.findByRole('heading', { name: '欢迎来到你的个人智能中枢' })
    expect(screen.queryByRole('button', { name: '成长仪表盘' })).not.toBeInTheDocument()
    expect(screen.getByText('创建你的个人空间')).toBeInTheDocument()
    expect(screen.getByText('Obsidian 是可选编辑器，不是使用产品的前置条件。')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /同时使用 Obsidian/ }))

    fireEvent.click(screen.getByRole('button', { name: /开始对话建档/ }))
    await screen.findByText('我应该怎么称呼你？')
    expect(screen.queryByRole('button', { name: '成长仪表盘' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '暂时结束并进入工作台' }))
    expect(calls).toContain('/api/v1/initialized')
    expect(spy).toHaveBeenCalled()
  })

  it('previews pending Git changes and blocks commit on sensitive files', async () => {
    mockApi({
      '/api/v1/memories': [memory],
      '/api/v1/memory-stats': stats,
      '/api/v1/backups': { currentRevision: 'r1', backups: [] },
      '/api/v1/vault': { vaultId: 'v1', displayName: '我的个人空间', schemaVersion: 1, revision: 'r1', externalChange: false },
      '/api/v1/vaults': [],
      '/api/v1/git/status': { configured: true, branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0, dirty: ['30 Memory/Inbox/new-note.md'], unmerged: [] },
      '/api/v1/git/changes': { changes: [{ path: '30 Memory/Inbox/new-note.md', status: 'untracked', code: '??' }], sensitive: [{ path: 'id_rsa', reason: 'sensitive file name' }], unmerged: [], can_commit: false },
    })
    render(<App />)
    await connect()
    fireEvent.click(screen.getByRole('button', { name: '备份与恢复' }))
    await screen.findByRole('button', { name: '预览变更' })
    fireEvent.click(screen.getByRole('button', { name: '预览变更' }))
    await waitFor(() => expect(screen.getByText('检测到疑似敏感文件，已禁止提交')).toBeInTheDocument())
    expect(screen.getByText('id_rsa')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Commit' })).toBeDisabled()
  })
})
