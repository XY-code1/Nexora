export type MemoryStatus = 'candidate' | 'confirmed' | 'rejected' | 'archived'

export type Memory = {
  id: string
  status: string
  type: string
  subject: string
  sourceAgent: string
  created: string
  updated: string
  content: string
  revision: string
}

export type ProfileOverview = { access: string; protected: boolean; visibility?: string; sections: { title: string; items: string[] }[] }
export type TimelineItem = Omit<Memory, 'content' | 'revision'> & { access: string; previewAvailable: boolean; preview: string }
export type PrivacyAudit = { totalMemories: number; byStatus: Record<string, number>; byAccess: Record<string, number>; bySource: Record<string, number>; mcpEvents: Record<string, number>; issues: { id: string; issue: string }[]; rules: string[] }
export type Human3Trend = { disclaimer: string; dimensions: string[]; points: { date: string; scores: Record<string, number>; summary: string }[] }
export type OnboardingTopic = { key: string; title: string; prompt: string; status: 'available' | 'pending' | 'confirmed' }
export type OnboardingState = { topics: OnboardingTopic[]; nextTopic: string | null; completed: boolean; notice: string }
export type Human3Dimension = { key: string; title: string; prompt: string; reflection: string; evidence: string; evidenceState: 'sufficient' | 'limited' | 'insufficient'; score: number | null; answered: boolean }
export type Human3Session = { id: string; date: string; status: 'draft'; dimensions: Human3Dimension[]; summary: string; plan: string; readyToConfirm: boolean; revision: string; disclaimer: string }

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
  profileOverview(signal?: AbortSignal) { return this.request<ProfileOverview>('/api/v1/visualization/profile', { signal }) }
  timeline(signal?: AbortSignal) { return this.request<TimelineItem[]>('/api/v1/visualization/timeline', { signal }) }
  privacyAudit(signal?: AbortSignal) { return this.request<PrivacyAudit>('/api/v1/visualization/privacy', { signal }) }
  human3Trend(signal?: AbortSignal) { return this.request<Human3Trend>('/api/v1/visualization/human3', { signal }) }
  onboarding(signal?: AbortSignal) { return this.request<OnboardingState>('/api/v1/onboarding', { signal }) }
  onboardingResponse(topic: string, content: string, signal?: AbortSignal) { return this.request<{ candidateId: string; state: OnboardingState }>('/api/v1/onboarding/responses', { method: 'POST', body: JSON.stringify({ topic, content, consent: true }), signal }) }
  human3Session(signal?: AbortSignal) { return this.request<{ session: Human3Session | null }>('/api/v1/human3/session', { signal }) }
  startHuman3(signal?: AbortSignal) { return this.request<{ session: Human3Session }>('/api/v1/human3/session', { method: 'POST', signal }) }
  saveHuman3Dimension(id: string, dimension: string, value: { reflection: string; evidence: string; evidence_state: string; score: number; expected_revision: string }, signal?: AbortSignal) { return this.request<{ session: Human3Session }>(`/api/v1/human3/session/${id}/dimensions/${dimension}`, { method: 'PUT', body: JSON.stringify(value), signal }) }
  saveHuman3Conclusion(id: string, summary: string, plan: string, expected_revision: string, signal?: AbortSignal) { return this.request<{ session: Human3Session }>(`/api/v1/human3/session/${id}/conclusion`, { method: 'PUT', body: JSON.stringify({ summary, plan, expected_revision }), signal }) }
  confirmHuman3(id: string, expected_revision: string, signal?: AbortSignal) { return this.request<{ id: string; status: string; file: string }>(`/api/v1/human3/session/${id}/confirm`, { method: 'POST', body: JSON.stringify({ expected_revision }), signal }) }
  edit(id: string, content: string, expected_revision: string, signal?: AbortSignal) { return this.request<Memory>(`/api/v1/memories/${id}`, { method: 'PATCH', body: JSON.stringify({ content, expected_revision }), signal }) }
  action(id: string, action: 'confirm' | 'reject', expected_revision: string, reason = '', signal?: AbortSignal) { return this.request<{ id: string; action: string; status: string }>(`/api/v1/memories/${id}/${action}`, { method: 'POST', body: JSON.stringify({ expected_revision, reason }), signal }) }
  shutdown(signal?: AbortSignal) { return this.request<{ status: string }>('/api/v1/shutdown', { method: 'POST', signal }) }
}
