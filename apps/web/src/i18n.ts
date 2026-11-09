import { useEffect, useState } from 'react'

export type Language = 'zh-CN' | 'en'

export const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'zh-CN', label: '中文' },
  { value: 'en', label: 'English' },
]

/**
 * Single source of truth for UI strings. Historical pages keep their wording,
 * but every user-facing string added from now on goes through here.
 */
const resources: Record<Language, Record<string, string>> = {
  'zh-CN': {
    'app.title': 'NEXORA',
    'nav.group.core': '核心',
    'nav.group.records': '记录',
    'nav.group.system': '系统',
    'nav.overview': '概览',
    'title.overview': '总览',
    'nav.review': '记忆审核',
    'nav.profile': '个人档案',
    'nav.reflection': '月度复盘',
    'nav.monthly': '月度趋势',
    'nav.human3': 'Human 3.0',
    'nav.growth': '成长仪表盘',
    'nav.timeline': '记忆时间线',
    'nav.privacy': '隐私审计',
    'nav.backup': '备份与恢复',
    'nav.connections': 'AI 连接',
    'nav.import': '导入',
    'nav.providers': 'AI Provider',
    'nav.github': 'GitHub 备份',
    'topbar.localService': '本地服务',
    'topbar.vaultReady': 'Vault 已就绪',
    'topbar.disconnect': '断开连接',
    'topbar.shutdown': '关闭服务',
    'topbar.language': '语言',
    'topbar.refreshCandidates': '同步候选记忆',
    'gate.title': '连接你的本地档案',
    'gate.token': '本地启动令牌',
    'gate.connect': '连接审核空间',
    'gate.hint': '启动令牌只保留在当前页面内存中，关闭或刷新页面后需要重新连接。',
    'common.loading': '正在读取本地数据…',
    'common.refresh': '刷新数据',
    'common.back': '返回',
    'common.next': '下一步',
    'common.confirm': '确认',
    'common.cancel': '取消',
    'common.close': '关闭',
    'common.enabled': '已启用',
    'common.disabled': '未启用',
    'status.verified': '已验证',
    'status.invalid': '异常',
    'status.pending': '待处理',
    'status.synced': '内容已同步',
    'status.externalChange': '检测到外部修改',
    'status.draft': '草稿',
    'status.confirmed': '已确认',
    'status.rejected': '已拒绝',
    'status.archived': '已归档',
    'status.untracked': '未跟踪',
    'status.added': '已新增',
    'status.modified': '已修改',
    'status.deleted': '已删除',
    'status.renamed': '已重命名',
    'error.generic': '本地服务暂时不可用，请稍后重试。',
    'error.token': '启动令牌无效，请检查后重新输入。',
    'error.conflict': '这条记录刚刚被其他入口修改。已保留你的草稿，请刷新后核对再提交。',
    'error.emptyToken': '请输入本次本地服务显示的启动令牌。',
    'error.pathRequired': '请填写文件夹的完整路径。',
    'a11y.openNavigation': '打开导航',
    'a11y.closeNavigation': '关闭导航',
    'a11y.skipToContent': '跳到主要内容',
    'a11y.main': '主要内容',
    'external.banner': '检测到外部修改（例如 Obsidian 编辑）。本地数据已变化，请刷新后核对；系统不会自动覆盖你的编辑。',
    'external.refresh': '刷新数据',
    'external.dismiss': '稍后处理',
  },
  en: {
    'app.title': 'NEXORA',
    'nav.group.core': 'Core',
    'nav.group.records': 'Records',
    'nav.group.system': 'System',
    'nav.overview': 'Overview',
    'title.overview': 'Overview',
    'nav.review': 'Memory Review',
    'nav.profile': 'Profile',
    'nav.reflection': 'Monthly Reflection',
    'nav.monthly': 'Monthly Trend',
    'nav.human3': 'Human 3.0',
    'nav.growth': 'Growth Dashboard',
    'nav.timeline': 'Memory Timeline',
    'nav.privacy': 'Privacy Audit',
    'nav.backup': 'Backup & Recovery',
    'nav.connections': 'AI Connections',
    'nav.import': 'Import',
    'nav.providers': 'AI Provider',
    'nav.github': 'GitHub Backup',
    'topbar.localService': 'Local service',
    'topbar.vaultReady': 'Vault ready',
    'topbar.disconnect': 'Disconnect',
    'topbar.shutdown': 'Shut down',
    'topbar.language': 'Language',
    'topbar.refreshCandidates': 'Sync candidate memories',
    'gate.title': 'Connect your local profile',
    'gate.token': 'Local startup token',
    'gate.connect': 'Connect',
    'gate.hint': 'The startup token stays in this page’s memory only; reconnect after closing or refreshing.',
    'common.loading': 'Reading local data…',
    'common.refresh': 'Refresh data',
    'common.back': 'Back',
    'common.next': 'Next',
    'common.confirm': 'Confirm',
    'common.cancel': 'Cancel',
    'common.close': 'Close',
    'common.enabled': 'Enabled',
    'common.disabled': 'Disabled',
    'status.verified': 'verified',
    'status.invalid': 'attention',
    'status.pending': 'pending',
    'status.synced': 'In sync',
    'status.externalChange': 'External changes detected',
    'status.draft': 'Draft',
    'status.confirmed': 'Confirmed',
    'status.rejected': 'Rejected',
    'status.archived': 'Archived',
    'status.untracked': 'untracked',
    'status.added': 'added',
    'status.modified': 'modified',
    'status.deleted': 'deleted',
    'status.renamed': 'renamed',
    'error.generic': 'The local service is unavailable. Please try again.',
    'error.token': 'The startup token is invalid. Check it and try again.',
    'error.conflict': 'This record was changed elsewhere. Your draft is kept — refresh and review before saving.',
    'error.emptyToken': 'Enter the startup token shown by the local service.',
    'error.pathRequired': 'Enter the full folder path.',
    'a11y.openNavigation': 'Open navigation',
    'a11y.closeNavigation': 'Close navigation',
    'a11y.skipToContent': 'Skip to main content',
    'a11y.main': 'Main content',
    'external.banner': 'External changes detected (for example an Obsidian edit). Your local data changed — refresh to review. The system never overwrites your edits automatically.',
    'external.refresh': 'Refresh data',
    'external.dismiss': 'Later',
  },
}

const STORAGE_KEY = 'nexora.language'

let current: Language = 'zh-CN'
try {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'zh-CN' || stored === 'en') current = stored
} catch { /* storage unavailable */ }

const listeners = new Set<() => void>()

export function getLanguage(): Language {
  return current
}

export function setLanguage(next: Language): void {
  current = next
  try { localStorage.setItem(STORAGE_KEY, next) } catch { /* storage unavailable */ }
  listeners.forEach((listener) => listener())
}

export function translate(key: string, language: Language = current): string {
  return resources[language][key] ?? resources['zh-CN'][key] ?? key
}

export function useLanguage(): [Language, (next: Language) => void] {
  const [language, set] = useState<Language>(current)
  useEffect(() => {
    const onChange = () => set(current)
    listeners.add(onChange)
    return () => { listeners.delete(onChange) }
  }, [])
  return [language, setLanguage]
}

export function useT(): (key: string) => string {
  const [language] = useLanguage()
  return (key: string) => translate(key, language)
}

/** Locale-aware date formatting; falls back to the raw value. */
export function formatDate(language: Language, value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  try {
    return new Intl.DateTimeFormat(language === 'zh-CN' ? 'zh-CN' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
  } catch {
    return value
  }
}

/** Locale-aware error text, so raw backend messages never leak untranslated. */
export function localizedError(language: Language, message: string): string {
  if (!message) return translate('error.generic', language)
  if (message.includes('启动令牌无效') || message.toLowerCase().includes('unauthorized')) return translate('error.token', language)
  if (message.includes('其他入口修改') || message.includes('其他进程修改')) return translate('error.conflict', language)
  return message
}
