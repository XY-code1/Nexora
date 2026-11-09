/** Map technical Vault errors to short, actionable guidance for the UI. */

const RULES: { match: string[]; hint: string }[] = [
  {
    match: ['目标目录非空'],
    hint: '该目录已有内容。请选择一个空文件夹来创建新 Vault，或改用「连接已有 Vault」。',
  },
  {
    match: ['结构不完整', '缺少'],
    hint: '这个目录不像有效的个人空间（缺少必要文件）。请选择正确的 Vault 目录，或新建一个。',
  },
  {
    match: ['相互包含', '公共框架仓库'],
    hint: '私人 Vault 不能与公共框架仓库互相包含，请另选一个完全独立的目录。',
  },
  {
    match: ['schema', '迁移'],
    hint: '这个 Vault 的版本与当前程序不一致，需要先迁移后才能使用。',
  },
  {
    match: ['符号链接', '重解析点'],
    hint: '该目录包含符号链接，出于安全考虑不被接受。请选择一个普通文件夹。',
  },
  {
    match: ['不存在', '找不到', '未找到'],
    hint: '找不到该目录，请检查路径是否正确。',
  },
]

export function vaultHint(message: string): string {
  const text = message.trim()
  if (!text) return ''
  for (const rule of RULES) {
    if (rule.match.some((needle) => text.includes(needle))) return rule.hint
  }
  return text
}
