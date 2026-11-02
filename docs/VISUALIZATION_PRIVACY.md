# 本地可视化与隐私裁剪

Phase 7提供四个只读视图：个人档案、记忆时间线、隐私审计和Human 3.0趋势。它们只读取当前私人Vault，不调用外部服务，也不改变MCP权限。

## 默认披露规则

- Profile仅在`ai_access: allowed`时解析结构化章节；`summary-only`只显示显式摘要；`denied`和`local-only`不显示内容。
- Timeline对所有记录显示最小生命周期元数据；只有`confirmed`且`ai_access`为`allowed`或`summary-only`时才提供显式摘要。
- 摘要默认折叠，必须由用户点击“查看确认摘要”。
- candidate、rejected、denied和local-only的正文不会进入Timeline响应。
- Privacy只统计状态、访问级别、来源和MCP事件类型，不返回记忆正文或审计详情。
- Human 3.0只读取`History`中`status: confirmed`的记录，并再次执行`ai_access`裁剪。

## Human 3.0趋势格式

已确认的历史文件可在frontmatter中使用0–10分：

```yaml
---
status: confirmed
date: 2026-11-01
ai_access: summary-only
mind: 7
body: 6.5
spirit: 8
vocation: 7.5
---
```

正文需要包含显式`## 摘要`。该功能是自我反思，不是医学或心理诊断。
