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

  listCandidates() { return this.request<Memory[]>('/api/v1/memories?status=candidate') }
  edit(id: string, content: string, expected_revision: string) { return this.request<Memory>(`/api/v1/memories/${id}`, { method: 'PATCH', body: JSON.stringify({ content, expected_revision }) }) }
  action(id: string, action: 'confirm' | 'reject', expected_revision: string, reason = '') { return this.request<{ id: string; action: string; status: string }>(`/api/v1/memories/${id}/${action}`, { method: 'POST', body: JSON.stringify({ expected_revision, reason }) }) }
}
