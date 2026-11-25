import type { ReflectionDimension, ReflectionEvent, ReflectionGoal } from './api'

/**
 * Local draft recovery for the Monthly Reflection editor.
 *
 * Drafts are stored in localStorage so a refresh or an abnormal exit does not
 * lose a long editing session. They are device-local, never synced, and are
 * cleared as soon as a save succeeds. A draft is only offered back to the user
 * explicitly — it never overwrites a newer server-side revision.
 */

const PREFIX = 'nexora.reflection-draft.'

export type ReflectionDraft = {
  version: 1
  savedAt: string
  source: 'local-draft'
  dimensions?: Partial<Record<ReflectionDimension, string>>
  summary?: string
  goals?: ReflectionGoal[]
  event?: Omit<ReflectionEvent, 'id'>
}

export function readReflectionDraft(id: string): ReflectionDraft | null {
  try {
    const raw = localStorage.getItem(PREFIX + id)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ReflectionDraft>
    if (parsed.version !== 1 || typeof parsed.savedAt !== 'string') return null
    const legacy = parsed as Partial<ReflectionDraft> & { dimension?: { key: ReflectionDimension; content: string } }
    const dimensions = parsed.dimensions ?? (legacy.dimension ? { [legacy.dimension.key]: legacy.dimension.content } : undefined)
    return { version: 1, savedAt: parsed.savedAt, source: 'local-draft', dimensions, summary: parsed.summary, goals: parsed.goals, event: parsed.event }
  } catch {
    return null
  }
}

export function writeReflectionDraft(id: string, draft: ReflectionDraft): void {
  try {
    localStorage.setItem(PREFIX + id, JSON.stringify(draft))
  } catch {
    /* storage full or unavailable — the editor keeps working in memory */
  }
}

export function clearReflectionDraft(id: string): void {
  try {
    localStorage.removeItem(PREFIX + id)
  } catch {
    /* ignore */
  }
}
