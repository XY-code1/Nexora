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
export type SecurityClient = { id: string; name: string; authorization: 'pending_authorization' | 'authorized' | 'revoked' | 'deleted'; activity: 'never_connected' | 'recently_active' | 'inactive' | 'error'; scopes: string[]; registeredAt: string; authorizedAt: string; lastAccessAt: string; revokedAt: string; deletedAt: string }
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
export type MonthlyTrendDimension = { key: ReflectionDimension; title: string }
export type MonthlyTrendPoint = { month: string; dimensions: Record<ReflectionDimension, string>; completedDimensions: number; events: ReflectionEvent[]; eventCount: number; goals: ReflectionGoal[]; goalTotal: number; goalCompleted: number; summary: string; updated: string }
export type MonthlyTrend = { disclaimer: string; dimensions: MonthlyTrendDimension[]; points: MonthlyTrendPoint[] }
export type GrowthDimensionKey = 'mind' | 'body' | 'spirit' | 'vocation'
export type GrowthDimensionItem = { key: GrowthDimensionKey; title: string; subtitle: string; areas: string[]; month: string; monthlyText: string; score: number | null; assessmentDate: string; assessmentSummary: string }
export type GrowthDimensions = { disclaimer: string; dimensions: GrowthDimensionItem[] }
export type GrowthDimensionContent = { current: string; evidence: string; challenges: string; direction: string }
export type GrowthAssessment = { id: string; month: string; status: 'draft' | 'confirmed'; level: string; dimensions: Record<GrowthDimensionKey, GrowthDimensionContent>; completedDimensions: number; readyToConfirm: boolean; revision: string; updated: string }
export type GrowthOverview = { currentMonth: string; assessments: GrowthAssessment[] }
export type GrowthHuman3Point = { id: string; date: string; scores: Record<GrowthDimensionKey, number>; summary: string }
export type GrowthTimelinePoint = { month: string; assessment: GrowthAssessment | null; human3: GrowthHuman3Point | null; monthly: MonthlyReflection | null }
export type GrowthTimeline = { disclaimer: string; months: GrowthTimelinePoint[] }
export type GrowthAssociation = { id: string; fromDimension: GrowthDimensionKey; fromEventId: string; toDimension: GrowthDimensionKey; toEventId: string; relationType: 'correlation' | 'causation'; note: string; createdAt: string; revision: string }
export type GrowthGoal = { id: string; horizon: 'long-term' | 'quarterly' | 'monthly'; title: string; action: string; priority: 'low' | 'medium' | 'high'; due: string; completed: boolean; previousGoalId: string; createdAt: string; updatedAt: string; revision: string }
export type VaultBackup = { id: string; created: string; schemaVersion: number; fileCount: number; sizeBytes: number; integrity: 'verified' | 'invalid'; managed: boolean; pruned?: string[] }
export type BackupOverview = { currentRevision: string; backups: VaultBackup[] }
export type VaultStatus = { vaultId: string; displayName: string; schemaVersion: number; revision: string; externalChange: boolean; lastSeenRevision?: string; watched?: boolean }
export type VaultEvent = { revision: string; detectedAt: string }
export type VaultEvents = VaultStatus & { events: VaultEvent[] }
export type RegisteredVault = { vaultId: string; displayName: string; available: boolean; lastOpenedAt: string }
export type GitStatus = { configured?: boolean; message?: string; branch?: string; head?: string; upstream?: string | null; ahead?: number; behind?: number; dirty: string[]; unmerged: string[] }
export type GitHubStatus = { configured: boolean; sessionActive: boolean; connected: boolean; repository: string; visibilityVerified: string; remoteName: string; remoteHost: string; lastVerifiedAt: string }
export type GitHubDeviceCode = { userCode: string; verificationUri: string; expiresIn: number; interval: number }
export type GitHubDevicePoll = { status: 'pending' | 'slow_down' | 'expired' | 'authorized' }
export type GitHubRepository = { name: string; fullName: string; private: boolean; permissions: Record<string, boolean> }
export type GitHubVerification = { fullName: string; private: boolean; defaultBranch: string; permissions: Record<string, boolean> }
export type GitHubConnection = { provider: string; repository: string; visibilityVerified: string; remoteName: string; remoteHost: string; lastVerifiedAt: string; sessionActive: boolean }

export type ProviderAuthorization = { provider: string; enabled: boolean; scopes: string[]; createdAt: string; updatedAt: string }
export type PendingCall = { requestId: string; provider: string; scope: string; preview: Record<string, unknown>; droppedFields: string[]; preparedAt: string; status: string }
export type ProviderOverview = { providers: ProviderAuthorization[]; pending: PendingCall[]; scopes: Record<string, string[]> }
export type ProviderDecision = { requestId: string; provider: string; scope: string; decision: 'approved' | 'denied'; payload: Record<string, unknown>; droppedFields: string[]; decidedAt: string }
export type ProviderAuditEntry = { eventId: string; timestamp: string; eventType: string; scope: string; result: string; reasonCode: string; correlationId: string; details: { provider: string; fieldCount: number; droppedFields: string[] } }
export type ProviderAudit = { integrity: { status: string; events: number; line?: number; lastHash: string }; items: ProviderAuditEntry[] }

export type GitCommit = { id: string; created: string; subject: string; author: string }
export type GitHistory = { branch: string; commits: GitCommit[]; message?: string }

export type ImportItemStatus = 'ready' | 'duplicate' | 'invalid'
export type ImportPreviewItem = { index: number; type: string; subject: string; content: string; preview: string; status: ImportItemStatus; reason: string }
export type ImportPreview = { items: ImportPreviewItem[]; summary: { total: number; ready: number; duplicate: number; invalid: number } }
export type ImportCreated = { id: string; type: string; subject: string }
export type ImportSkipped = { type: string; subject: string; reason: string }
export type ImportResult = { created: ImportCreated[]; skipped: ImportSkipped[] }
export type GitChange = { path: string; status: string; code: string }
export type GitChanges = { changes: GitChange[]; sensitive: { path: string; reason: string }[]; unmerged: string[]; can_commit: boolean; message?: string }
export type OverviewSnapshot = { profile: ProfileOverview; memory: MemoryStats; clients: { total: number; active: SecurityClient[] }; recentAccess: AuditEvent[]; growth: { latestMonth: GrowthTimelinePoint | null }; pending: number; vault: string; initialized: boolean }

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
  overview(signal?: AbortSignal) { return this.request<OverviewSnapshot>('/api/v1/overview', { signal }) }
  markInitialized(signal?: AbortSignal) { return this.request<{ initialized: boolean }>('/api/v1/initialized', { method: 'POST', signal }) }
  profileOverview(signal?: AbortSignal) { return this.request<ProfileOverview>('/api/v1/visualization/profile', { signal }) }
  timeline(signal?: AbortSignal) { return this.request<TimelineItem[]>('/api/v1/visualization/timeline', { signal }) }
  privacyAudit(signal?: AbortSignal) { return this.request<PrivacyAudit>('/api/v1/visualization/privacy', { signal }) }
  async securityCenter(signal?: AbortSignal): Promise<SecurityCenter> { const [overview, clients, audit, lifecycle] = await Promise.all([this.request<SecurityOverview>('/api/v1/security/overview', { signal }), this.request<SecurityClient[]>('/api/v1/security/clients', { signal }), this.request<AuditPage>('/api/v1/security/audit-events', { signal }), this.request<AuditPage>('/api/v1/security/audit-events?resource_type=memory&page_size=100', { signal })]); return { overview, clients, audit, lifecycle } }
  securityEvents(filters: { clientId?: string; eventType?: string; resourceType?: string; result?: string; since?: string; until?: string; page?: number; pageSize?: number }, signal?: AbortSignal) { const query = new URLSearchParams(); Object.entries(filters).forEach(([key, value]) => { if (value !== undefined && value !== '') query.set(key === 'clientId' ? 'client_id' : key === 'eventType' ? 'event_type' : key === 'resourceType' ? 'resource_type' : key === 'pageSize' ? 'page_size' : key, String(value)) }); return this.request<AuditPage>(`/api/v1/security/audit-events?${query}`, { signal }) }
  authorizeSecurityClient(name: string, scopes: string[], signal?: AbortSignal) { return this.request<{ client: SecurityClient; credential: string }>('/api/v1/security/clients', { method: 'POST', body: JSON.stringify({ name, scopes }), signal }) }
  registerSecurityClient(name: string, scopes: string[], signal?: AbortSignal) { return this.request<SecurityClient>('/api/v1/security/clients/register', { method: 'POST', body: JSON.stringify({ name, scopes }), signal }) }
  authorizeRegisteredClient(id: string, signal?: AbortSignal) { return this.request<{ client: SecurityClient; credential: string }>(`/api/v1/security/clients/${id}/authorize`, { method: 'POST', signal }) }
  reissueSecurityToken(id: string, signal?: AbortSignal) { return this.request<{ client: SecurityClient; credential: string }>(`/api/v1/security/clients/${id}/reissue`, { method: 'POST', signal }) }
  deleteSecurityClient(id: string, signal?: AbortSignal) { return this.request<SecurityClient>(`/api/v1/security/clients/${id}`, { method: 'DELETE', signal }) }
  updateSecurityScopes(id: string, scopes: string[], signal?: AbortSignal) { return this.request<SecurityClient>(`/api/v1/security/clients/${id}/scopes`, { method: 'PUT', body: JSON.stringify({ scopes }), signal }) }
  revokeSecurityClient(id: string, signal?: AbortSignal) { return this.request<SecurityClient>(`/api/v1/security/clients/${id}/revoke`, { method: 'POST', signal }) }
  human3Trend(signal?: AbortSignal) { return this.request<Human3Trend>('/api/v1/visualization/human3', { signal }) }
  monthlyTrend(signal?: AbortSignal) { return this.request<MonthlyTrend>('/api/v1/visualization/monthly', { signal }) }
  growthDimensions(signal?: AbortSignal) { return this.request<GrowthDimensions>('/api/v1/growth/dimensions', { signal }) }
  growthAssessments(signal?: AbortSignal) { return this.request<GrowthOverview>('/api/v1/growth/assessments', { signal }) }
  createGrowthAssessment(month: string, signal?: AbortSignal) { return this.request<GrowthAssessment>('/api/v1/growth/assessments', { method: 'POST', body: JSON.stringify({ month }), signal }) }
  saveGrowthDimension(id: string, dimension: GrowthDimensionKey, content: GrowthDimensionContent, revision: string, signal?: AbortSignal) { return this.request<GrowthAssessment>(`/api/v1/growth/assessments/${id}/dimensions/${dimension}`, { method: 'PUT', body: JSON.stringify({ ...content, expected_revision: revision }), signal }) }
  saveGrowthLevel(id: string, level: string, revision: string, signal?: AbortSignal) { return this.request<GrowthAssessment>(`/api/v1/growth/assessments/${id}/level`, { method: 'PUT', body: JSON.stringify({ level, expected_revision: revision }), signal }) }
  confirmGrowthAssessment(id: string, revision: string, signal?: AbortSignal) { return this.request<GrowthAssessment>(`/api/v1/growth/assessments/${id}/confirm`, { method: 'POST', body: JSON.stringify({ expected_revision: revision }), signal }) }
  deleteGrowthAssessment(id: string, revision: string, signal?: AbortSignal) { return this.request<{ id: string; action: string }>(`/api/v1/growth/assessments/${id}?expected_revision=${encodeURIComponent(revision)}`, { method: 'DELETE', signal }) }
  growthTimeline(month?: string, signal?: AbortSignal) { return this.request<GrowthTimeline>(`/api/v1/growth/timeline${month ? `?month=${encodeURIComponent(month)}` : ''}`, { signal }) }
  growthAssociations(signal?: AbortSignal) { return this.request<GrowthAssociation[]>('/api/v1/growth/associations', { signal }) }
  addGrowthAssociation(input: { from_dimension: GrowthDimensionKey; from_event_id: string; to_dimension: GrowthDimensionKey; to_event_id: string; relation_type: 'correlation' | 'causation'; note: string }, signal?: AbortSignal) { return this.request<GrowthAssociation>('/api/v1/growth/associations', { method: 'POST', body: JSON.stringify(input), signal }) }
  deleteGrowthAssociation(id: string, revision: string, signal?: AbortSignal) { return this.request<{ id: string; action: string }>(`/api/v1/growth/associations/${id}?expected_revision=${encodeURIComponent(revision)}`, { method: 'DELETE', signal }) }
  growthGoals(horizon?: string, signal?: AbortSignal) { return this.request<GrowthGoal[]>(`/api/v1/growth/goals${horizon ? `?horizon=${encodeURIComponent(horizon)}` : ''}`, { signal }) }
  addGrowthGoal(input: { horizon: 'long-term' | 'quarterly' | 'monthly'; title: string; action: string; priority: 'low' | 'medium' | 'high'; due: string; previous_goal_id: string }, signal?: AbortSignal) { return this.request<GrowthGoal>('/api/v1/growth/goals', { method: 'POST', body: JSON.stringify(input), signal }) }
  updateGrowthGoal(id: string, input: { title: string; action: string; priority: 'low' | 'medium' | 'high'; due: string; completed: boolean; previous_goal_id: string; expected_revision: string }, signal?: AbortSignal) { return this.request<GrowthGoal>(`/api/v1/growth/goals/${id}`, { method: 'PUT', body: JSON.stringify(input), signal }) }
  deleteGrowthGoal(id: string, revision: string, signal?: AbortSignal) { return this.request<{ id: string; action: string }>(`/api/v1/growth/goals/${id}?expected_revision=${encodeURIComponent(revision)}`, { method: 'DELETE', signal }) }
  backups(signal?: AbortSignal) { return this.request<BackupOverview>('/api/v1/backups', { signal }) }
  createBackup(signal?: AbortSignal) { return this.request<{ backup: VaultBackup; currentRevision: string }>('/api/v1/backups', { method: 'POST', signal }) }
  verifyBackup(id: string, signal?: AbortSignal) { return this.request<VaultBackup>(`/api/v1/backups/${encodeURIComponent(id)}/verify`, { signal }) }
  restoreBackup(id: string, confirmation: string, revision: string, signal?: AbortSignal) { return this.request<{ restoredBackupId: string; safetyBackup: VaultBackup; currentRevision: string }>(`/api/v1/backups/${encodeURIComponent(id)}/restore`, { method: 'POST', body: JSON.stringify({ confirmation, expected_vault_revision: revision }), signal }) }
  vaultStatus(signal?: AbortSignal) { return this.request<VaultStatus>('/api/v1/vault', { signal }) }
  vaultEvents(signal?: AbortSignal) { return this.request<VaultEvents>('/api/v1/vault/events', { signal }) }
  registeredVaults(signal?: AbortSignal) { return this.request<RegisteredVault[]>('/api/v1/vaults', { signal }) }
  connectVault(vaultId: string, signal?: AbortSignal) { return this.request<{ status: string; vaultId: string }>('/api/v1/vaults/connect', { method: 'POST', body: JSON.stringify({ vault_id: vaultId }), signal }) }
  validateVault(path: string, signal?: AbortSignal) { return this.request<{ vaultId: string; displayName: string; valid: boolean }>('/api/v1/vaults/validate', { method: 'POST', body: JSON.stringify({ path }), signal }) }
  createVault(path: string, signal?: AbortSignal) { return this.request<{ vaultId: string; displayName: string; created: boolean }>('/api/v1/vaults/create', { method: 'POST', body: JSON.stringify({ path }), signal }) }
  switchVault(path: string, signal?: AbortSignal) { return this.request<{ status: string }>('/api/v1/vault/switch', { method: 'POST', body: JSON.stringify({ path }), signal }) }
  gitStatus(signal?: AbortSignal) { return this.request<GitStatus>('/api/v1/git/status', { signal }) }
  githubStatus(signal?: AbortSignal) { return this.request<GitHubStatus>('/api/v1/github/status', { signal }) }
  githubConfigureClientId(clientId: string, signal?: AbortSignal) { return this.request<{ configured: boolean }>('/api/v1/github/client-id', { method: 'POST', body: JSON.stringify({ client_id: clientId }), signal }) }
  githubDeviceCode(signal?: AbortSignal) { return this.request<GitHubDeviceCode>('/api/v1/github/device-code', { method: 'POST', signal }) }
  githubDevicePoll(signal?: AbortSignal) { return this.request<GitHubDevicePoll>('/api/v1/github/device-poll', { method: 'POST', signal }) }
  githubRepositories(signal?: AbortSignal) { return this.request<GitHubRepository[]>('/api/v1/github/repositories', { signal }) }
  githubVerify(repository: string, signal?: AbortSignal) { return this.request<GitHubVerification>('/api/v1/github/verify', { method: 'POST', body: JSON.stringify({ repository }), signal }) }
  githubCreate(name: string, signal?: AbortSignal) { return this.request<{ fullName: string; private: boolean; created: boolean }>('/api/v1/github/create', { method: 'POST', body: JSON.stringify({ name }), signal }) }
  githubConnect(repository: string, signal?: AbortSignal) { return this.request<GitHubConnection>('/api/v1/github/connect', { method: 'POST', body: JSON.stringify({ repository }), signal }) }
  githubDisconnect(signal?: AbortSignal) { return this.request<{ connected: boolean }>('/api/v1/github/connection', { method: 'DELETE', signal }) }

  providers(signal?: AbortSignal) { return this.request<ProviderOverview>('/api/v1/providers', { signal }) }
  authorizeProvider(provider: string, scopes: string[], signal?: AbortSignal) { return this.request<ProviderAuthorization>('/api/v1/providers', { method: 'POST', body: JSON.stringify({ provider, scopes }), signal }) }
  revokeProvider(provider: string, signal?: AbortSignal) { return this.request<{ provider: string; revoked: boolean }>(`/api/v1/providers/${encodeURIComponent(provider)}`, { method: 'DELETE', signal }) }
  previewProviderCall(provider: string, scope: string, context: Record<string, unknown>, signal?: AbortSignal) { return this.request<PendingCall>('/api/v1/providers/preview', { method: 'POST', body: JSON.stringify({ provider, scope, context }), signal }) }
  decideProviderCall(requestId: string, action: 'approve' | 'deny', reason: string, signal?: AbortSignal) { return this.request<ProviderDecision>('/api/v1/providers/calls', { method: 'POST', body: JSON.stringify({ request_id: requestId, action, reason }), signal }) }
  providerAudit(signal?: AbortSignal) { return this.request<ProviderAudit>('/api/v1/providers/audit', { signal }) }

  gitHistory(limit = 50, signal?: AbortSignal) { return this.request<GitHistory>(`/api/v1/git/history?limit=${limit}`, { signal }) }

  gitChanges(signal?: AbortSignal) { return this.request<GitChanges>('/api/v1/git/changes', { signal }) }
  gitCommit(message: string, signal?: AbortSignal) { return this.request<{ head: string }>('/api/v1/git/commit', { method: 'POST', body: JSON.stringify({ message, confirmation: 'COMMIT' }), signal }) }
  gitPull(signal?: AbortSignal) { return this.request<{ status: string; head: string }>('/api/v1/git/pull', { method: 'POST', body: JSON.stringify({ confirmation: 'PULL' }), signal }) }
  gitPush(signal?: AbortSignal) { return this.request<{ status: string; head: string }>('/api/v1/git/push', { method: 'POST', body: JSON.stringify({ confirmation: 'PUSH' }), signal }) }
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
  importPreview(format: string, content: string, signal?: AbortSignal) { return this.request<ImportPreview>('/api/v1/imports/preview', { method: 'POST', body: JSON.stringify({ format, content }), signal }) }
  importCommit(items: { type: string; subject: string; content: string }[], source: string, signal?: AbortSignal) { return this.request<ImportResult>('/api/v1/imports', { method: 'POST', body: JSON.stringify({ items, source }), signal }) }
  shutdown(signal?: AbortSignal) { return this.request<{ status: string }>('/api/v1/shutdown', { method: 'POST', signal }) }
}
