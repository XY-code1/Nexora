import type { ReactNode } from 'react'

/**
 * 统一的状态展示层：Loading / Empty / Error / Success 共用一套结构与语气。
 *
 * 原则（来自 UI/UX 任务书第四条）：
 * - 空状态是行动邀请，不是情绪表达；必须给出下一步入口。
 * - 错误要说清发生了什么、怎么办，不道歉、不含糊。
 * - 加载态用骨架屏，避免布局跳动。
 */

type Tone = 'neutral' | 'error' | 'success' | 'warning'

type StateBlockProps = {
  tone?: Tone
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

export function StateBlock({ tone = 'neutral', icon, title, description, action, className = '' }: StateBlockProps) {
  return <div className={`state-block state-${tone} ${className}`.trim()} role={tone === 'error' ? 'alert' : 'status'}>
    {icon && <span className="state-icon">{icon}</span>}
    <div className="state-copy">
      <h3>{title}</h3>
      {description && <p>{description}</p>}
    </div>
    {action && <div className="state-action">{action}</div>}
  </div>
}

export function LoadingState({ label = '正在读取本地数据…', rows = 3 }: { label?: string; rows?: number }) {
  return <div className="skeletons" aria-label="加载中" role="status">
    <span className="sr-only">{label}</span>
    {Array.from({ length: rows }, (_, index) => <i key={index} />)}
  </div>
}

export function ErrorState({ title = '无法读取本地数据', description, action }: { title?: string; description?: string; action?: ReactNode }) {
  return <StateBlock tone="error" title={title} description={description ?? '本地服务暂时不可用，请确认服务仍在运行后重试。'} action={action} />
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: ReactNode; icon?: ReactNode }) {
  return <StateBlock title={title} description={description} action={action} icon={icon} />
}

export function SuccessState({ title, description }: { title: string; description?: string }) {
  return <StateBlock tone="success" title={title} description={description} />
}
