export type MemoryStatus = 'candidate' | 'confirmed' | 'rejected' | 'archived'

export type Memory = {
  id: string
  status: string
  type: string
  subject: string
  sourceAgent: string
  created: string
  updated: string
  visibility: string
  aiAccess: string
  tags: string[]
  content: string
  revision: string
}

export type MemoryStats = { candidateMemories: number; pendingReview: number; confirmedMemories: number }

export type ProfileOverview = { access: string; protected: boolean; visibility?: string; hasConfirmedMemories?: boolean; sections: { title: string; items: string[] }[] }
export type TimelineItem = Omit<Memory, 'content' | 'revision'> & { access: string; previewAvailable: boolean; preview: string }
export type PrivacyAudit = { totalMemories: number; byStatus: Record<string, number>; byAccess: Record<string, number>; bySource: Record<string, number>; mcpEvents: Record<string, number>; issues: { id: string; issue: string }[]; rules: string[] }
export type SecurityClient = { id: string; name: string; status: 'active' | 'revoked'; connectionStatus: 'recent' | 'inactive'; scopes: string[]; authorizedAt: string; lastAccessAt: string; revokedAt: string }
export type AuditEvent = { eventId: string; timestamp: string; clientId: string; eventType: string; resourceType: string; scope: string; result: 'allowed' | 'denied'; reasonCode: string; correlationId: string; details: Record<string, unknown> }
export type AuditPage = { items: AuditEvent[]; page: number; pageSize: number; total: number; integrity: { status: 'missing' | 'verified' | 'invalid'; events: number; line?: number } }
export type SecurityOverview = { diagnostics: { localService: string; vault: string; mcp: string; authorizedClients: number; recentDenied: number; audit: AuditPage['integrity'] }; scopes: string[] }
export type SecurityCenter = { overview: SecurityOverview; clients: SecurityClient[]; audit: AuditPage; lifecycle: AuditPage }
export type Human3Trend = { disclaimer: string; dimensions: string[]; points: { date: string; scores: Record<string, number>; summary: string }[] }
export type OnboardingTopic = { key: string; title: string; prompt: string; status: 'available' | 'pending' | 'confirmed' }
export type OnboardingState = { topics: OnboardingTopic[]; nextTopic: string | null; completed: boolean; notice: string }
export type Human3Dimension = { key: string; title: string; prompt: string; reflection: string; evidence: string; evidenceState: 'sufficient' | 'limited' | 'insufficient'; score: number | null; answered: boolean }
export type Human3Session = { id: string; date: string; status: 'draft'; dimensions: Human3Dimension[]; summary: string; plan: string; readyToConfirm: boolean; revision: string; disclaimer: string }
export type ReflectionDimension = 'mind' | 'body' | 'spirit' | 'vocation'
export type ReflectionEvent = { id: string; title: string; date: string; dimension: ReflectionDimension; description: string; feeling: string; project: string }
export type ReflectionGoal = { id: string; title: string; action: string; priority: 'low' | 'medium' | 'high'; due: string; completed: boolean; previousGoalId: string }
export type MonthlyReflection = { id: string; month: string; status: 'draft' | 'confirmed'; dimensions: Record<ReflectionDimension, string>; events: ReflectionEvent[]; summary: string; summarySource: string; goals: ReflectionGoal[]; completedDimensions: number; readyToConfirm: boolean; revision: string; updated: string }
export type MonthlyOverview = { currentMonth: string; reflections: MonthlyReflection[] }

type Envelope<T> = { data: T; meta: { requestId: string; revision?: string } }
type ErrorEnvelope = { error: { code: string; message: string; details: unknown }; requestId: string }

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export class ApiClient {
  private token: string
  private base: string
  constructor(token: string, base = import.meta.env.VITE_API_URL ?? '') {
    this.token = token
    this.base = base
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.base}${path}`, {
      ...options,
      headers: { Authorization: `Bearer ${this.token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    })
    const data = (await response.json()) as Envelope<T> | ErrorEnvelope
    if (!response.ok) {
      const error = data as ErrorEnvelope
      throw new ApiError(response.status, error.error?.code ?? 'REQUEST_FAILED', error.error?.message ?? '请求未完成。')
    }
    return (data as Envelope<T>).data
  }

  listCandidates(signal?: AbortSignal) { return this.request<Memory[]>('/api/v1/memories?status=candidate', { signal }) }
  memoryStats(signal?: AbortSignal) { return this.request<MemoryStats>('/api/v1/memory-stats', { signal }) }
  profileOverview(signal?: AbortSignal) { return this.request<ProfileOverview>('/api/v1/visualization/profile', { signal }) }
  timeline(signal?: AbortSignal) { return this.request<TimelineItem[]>('/api/v1/visualization/timeline', { signal }) }
  privacyAudit(signal?: AbortSignal) { return this.request<PrivacyAudit>('/api/v1/visualization/privacy', { signal }) }
  async securityCenter(signal?: AbortSignal): Promise<SecurityCenter> { const [overview, clients, audit, lifecycle] = await Promise.all([this.request<SecurityOverview>('/api/v1/security/overview', { signal }), this.request<SecurityClient[]>('/api/v1/security/clients', { signal }), this.request<AuditPage>('/api/v1/security/audit-events', { signal }), this.request<AuditPage>('/api/v1/security/audit-events?resource_type=memory&page_size=100', { signal })]); return { overview, clients, audit, lifecycle } }
  securityEvents(filters: { clientId?: string; eventType?: string; resourceType?: string; result?: string; since?: string; until?: string; page?: number; pageSize?: number }, signal?: AbortSignal) { const query = new URLSearchParams(); Object.entries(filters).forEach(([key, value]) => { if (value !== undefined && value !== '') query.set(key === 'clientId' ? 'client_id' : key === 'eventType' ? 'event_type' : key === 'resourceType' ? 'resource_type' : key === 'pageSize' ? 'page_size' : key, String(value)) }); return this.request<AuditPage>(`/api/v1/security/audit-events?${query}`, { signal }) }
  authorizeSecurityClient(name: string, scopes: string[], signal?: AbortSignal) { return this.request<{ client: SecurityClient; credential: string }>('/api/v1/security/clients', { method: 'POST', body: JSON.stringify({ name, scopes }), signal }) }
  updateSecurityScopes(id: string, scopes: string[], signal?: AbortSignal) { return this.request<SecurityClient>(`/api/v1/security/clients/${id}/scopes`, { method: 'PUT', body: JSON.stringify({ scopes }), signal }) }
  revokeSecurityClient(id: string, signal?: AbortSignal) { return this.request<SecurityClient>(`/api/v1/security/clients/${id}/revoke`, { method: 'POST', signal }) }
  human3Trend(signal?: AbortSignal) { return this.request<Human3Trend>('/api/v1/visualization/human3', { signal }) }
  onboarding(signal?: AbortSignal) { return this.request<OnboardingState>('/api/v1/onboarding', { signal }) }
  onboardingResponse(topic: string, content: string, signal?: AbortSignal) { return this.request<{ candidateId: string; state: OnboardingState }>('/api/v1/onboarding/responses', { method: 'POST', body: JSON.stringify({ topic, content, consent: true }), signal }) }
  human3Session(signal?: AbortSignal) { return this.request<{ session: Human3Session | null }>('/api/v1/human3/session', { signal }) }
  startHuman3(signal?: AbortSignal) { return this.request<{ session: Human3Session }>('/api/v1/human3/session', { method: 'POST', signal }) }
  saveHuman3Dimension(id: string, dimension: string, value: { reflection: string; evidence: string; evidence_state: string; score: number; expected_revision: string }, signal?: AbortSignal) { return this.request<{ session: Human3Session }>(`/api/v1/human3/session/${id}/dimensions/${dimension}`, { method: 'PUT', body: JSON.stringify(value), signal }) }
  saveHuman3Conclusion(id: string, summary: string, plan: string, expected_revision: string, signal?: AbortSignal) { return this.request<{ session: Human3Session }>(`/api/v1/human3/session/${id}/conclusion`, { method: 'PUT', body: JSON.stringify({ summary, plan, expected_revision }), signal }) }
  confirmHuman3(id: string, expected_revision: string, signal?: AbortSignal) { return this.request<{ id: string; status: string; file: string }>(`/api/v1/human3/session/${id}/confirm`, { method: 'POST', body: JSON.stringify({ expected_revision }), signal }) }
  monthlyOverview(signal?: AbortSignal) { return this.request<MonthlyOverview>('/api/v1/monthly-reflections', { signal }) }
  createMonthly(month: string, signal?: AbortSignal) { return this.request<MonthlyReflection>('/api/v1/monthly-reflections', { method: 'POST', body: JSON.stringify({ month }), signal }) }
  saveMonthlyDimension(id: string, dimension: ReflectionDimension, content: string, revision: string, signal?: AbortSignal) { return this.request<MonthlyReflection>(`/api/v1/monthly-reflections/${id}/dimensions/${dimension}`, { method: 'PUT', body: JSON.stringify({ content, expected_revision: revision }), signal }) }
  addMonthlyEvent(id: string, event: Omit<ReflectionEvent, 'id'>, revision: string, signal?: AbortSignal) { return this.request<MonthlyReflection>(`/api/v1/monthly-reflections/${id}/events`, { method: 'POST', body: JSON.stringify({ ...event, expected_revision: revision }), signal }) }
  deleteMonthlyEvent(id: string, eventId: string, revision: string, signal?: AbortSignal) { return this.request<MonthlyReflection>(`/api/v1/monthly-reflections/${id}/events/${eventId}?expected_revision=${revision}`, { method: 'DELETE', signal }) }
  saveMonthlyGoals(id: string, goals: ReflectionGoal[], revision: string, signal?: AbortSignal) { return this.request<MonthlyReflection>(`/api/v1/monthly-reflections/${id}/goals`, { method: 'PUT', body: JSON.stringify({ goals, expected_revision: revision }), signal }) }
  generateMonthlySummary(id: string, revision: string, signal?: AbortSignal) { return this.request<MonthlyReflection>(`/api/v1/monthly-reflections/${id}/summary-draft`, { method: 'POST', body: JSON.stringify({ expected_revision: revision }), signal }) }
  saveMonthlySummary(id: string, summary: string, revision: string, signal?: AbortSignal) { return this.request<MonthlyReflection>(`/api/v1/monthly-reflections/${id}/summary`, { method: 'PUT', body: JSON.stringify({ summary, expected_revision: revision }), signal }) }
  confirmMonthly(id: string, revision: string, signal?: AbortSignal) { return this.request<MonthlyReflection>(`/api/v1/monthly-reflections/${id}/confirm`, { method: 'POST', body: JSON.stringify({ expected_revision: revision }), signal }) }
  edit(id: string, content: string, expected_revision: string, signal?: AbortSignal) { return this.request<Memory>(`/api/v1/memories/${id}`, { method: 'PATCH', body: JSON.stringify({ content, expected_revision }), signal }) }
  action(id: string, action: 'confirm' | 'reject', expected_revision: string, reason = '', signal?: AbortSignal) { return this.request<{ id: string; action: string; status: string }>(`/api/v1/memories/${id}/${action}`, { method: 'POST', body: JSON.stringify({ expected_revision, reason }), signal }) }
  shutdown(signal?: AbortSignal) { return this.request<{ status: string }>('/api/v1/shutdown', { method: 'POST', signal }) }
}
