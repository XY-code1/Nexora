import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OverviewPage from './OverviewPage'
import { setLanguage } from './i18n'
import type { ApiClient, OverviewSnapshot, SecurityClient, VaultBackup, VaultStatus } from './api'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  setLanguage('zh-CN')
})

const activeClient: SecurityClient = {
  id: 'client-1', name: 'Obsidian', authorization: 'authorized', activity: 'recently_active',
  scopes: ['memory:search'], registeredAt: '', authorizedAt: '', lastAccessAt: '', revokedAt: '', deletedAt: '',
}

function overview(overrides: Partial<OverviewSnapshot> = {}): OverviewSnapshot {
  return {
    profile: { access: 'summary-only', protected: false, sections: [{ title: '基础信息', items: ['姓名'] }] },
    memory: { candidateMemories: 2, pendingReview: 3, confirmedMemories: 5 },
    clients: { total: 1, active: [activeClient] }, recentAccess: [],
    growth: { latestMonth: { month: '2026-10', assessment: null, human3: null, monthly: null } },
    pending: 3, vault: 'ready', initialized: true, ...overrides,
  }
}

function vault(overrides: Partial<VaultStatus> = {}): VaultStatus {
  return { vaultId: 'v1', displayName: '我的个人空间', schemaVersion: 1, revision: 'r1', externalChange: false, ...overrides }
}

function makeClient(overrides: Record<string, unknown> = {}): ApiClient {
  return {
    overview: vi.fn().mockResolvedValue(overview()), timeline: vi.fn().mockResolvedValue([]),
    vaultStatus: vi.fn().mockResolvedValue(vault()),
    backups: vi.fn().mockResolvedValue({ currentRevision: 'r1', backups: [{ id: 'b1', created: '2026-11-20T10:00:00Z', schemaVersion: 1, fileCount: 3, sizeBytes: 10, integrity: 'verified', managed: true } as VaultBackup] }),
    ...overrides,
  } as unknown as ApiClient
}

describe('overview command center', () => {
  it('prioritises pending memory review and routes the action', async () => {
    const onNavigate = vi.fn()
    render(<OverviewPage client={makeClient()} onNavigate={onNavigate} onConcepts={vi.fn()} />)
    expect(await screen.findByText('你的本地优先个人智能空间')).toBeInTheDocument()
    expect(screen.getByText('审核候选记忆')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /开始处理/ }))
    expect(onNavigate).toHaveBeenCalledWith('review')
  })

  it('shows unknown Vault and inactive AI states without false healthy claims', async () => {
    const inactive = { ...activeClient, activity: 'never_connected' as const }
    render(<OverviewPage client={makeClient({
      vaultStatus: vi.fn().mockRejectedValue(new Error('offline')),
      overview: vi.fn().mockResolvedValue(overview({ clients: { total: 1, active: [inactive] } })),
    })} onNavigate={vi.fn()} onConcepts={vi.fn()} />)
    expect(await screen.findByText('Vault 状态未知')).toBeInTheDocument()
    expect(screen.getByText('AI 未连接')).toBeInTheDocument()
  })

  it('renders the honest empty activity state', async () => {
    render(<OverviewPage client={makeClient()} onNavigate={vi.fn()} onConcepts={vi.fn()} />)
    expect(await screen.findByText('还没有已确认的记忆')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /记忆审核/ })).toBeInTheDocument()
  })

  it('surfaces overview load failures', async () => {
    render(<OverviewPage client={makeClient({ overview: vi.fn().mockRejectedValue(new Error('local service offline')) })} onNavigate={vi.fn()} onConcepts={vi.fn()} />)
    expect(await screen.findByText('无法加载总览')).toBeInTheDocument()
    expect(screen.getByText('local service offline')).toBeInTheDocument()
  })

  it('localises the primary workspace content', async () => {
    setLanguage('en')
    render(<OverviewPage client={makeClient()} onNavigate={vi.fn()} onConcepts={vi.fn()} />)
    expect(await screen.findByText('Your local-first personal intelligence space')).toBeInTheDocument()
    expect(screen.getByText('Review candidate memories')).toBeInTheDocument()
    expect(screen.getByText('Memory review')).toBeInTheDocument()
  })
})
