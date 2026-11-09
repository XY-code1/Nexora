# Product Phase 9 — Visual Backup & Recovery Wizard

> 状态：2026-11-04 实施并通过专项验收。

## 产品边界

- 仅管理 Personal AI Profile 默认本地备份目录中的快照。
- API 只接受备份 ID，不接受任意文件系统路径。
- 页面不返回或显示 Vault、备份目录的绝对路径。
- 快照保存在本机，不发送到外部服务；快照不是加密保险库。
- 每个快照使用本机密钥和 Vault 位置生成 HMAC binding，其他 Vault 不能恢复该快照。

## 创建与校验

1. 创建前恢复未完成事务。
2. 拒绝 Vault 中的符号链接和 Windows 重解析点。
3. 排除 `.git`、`.env`、运行锁、事务目录、私钥和 PEM。
4. 复制到独立备份目录。
5. 为每个文件记录 SHA-256，并保存 Schema、创建时间和 Vault binding。
6. UI 显示真实文件数、大小、Schema 和完整性。
7. 损坏的已绑定快照显示为 `invalid`，不会被静默隐藏，也不能恢复。

## 恢复保护

- 用户必须输入完整的 `RESTORE {backupId}`。
- 请求必须携带页面读取的 `expected_vault_revision`；Vault 有并发变化时返回 `409 REVISION_CONFLICT`。
- 恢复前自动创建当前 Vault 的安全备份。
- 候选副本先完成全量哈希校验，再通过目录交换替换 Vault。恢复时保留当前 Vault 中快照明确排除的 `.git`、`.env`、`*.key` 和 `*.pem`；快照外的普通文件会被移除。
- 本机 `Locks` 与 `Transactions` 目录不从旧 Vault 带回，避免恢复过期的运行锁或事务日志。
- 交换过程有 journal；失败会回滚上一版本，启动时也会恢复中断交换。
- 只允许恢复当前 Vault 在本机创建并绑定的 Format 2 managed backup。

## 本地 API

```text
GET  /api/v1/backups
POST /api/v1/backups
GET  /api/v1/backups/{backupId}/verify
POST /api/v1/backups/{backupId}/restore
```

所有接口要求启动器 Bearer 会话。Restore body：

```json
{
  "confirmation": "RESTORE vault-...",
  "expected_vault_revision": "64-character SHA-256"
}
```

## 验收证据

- Core/API：创建、列表、校验、篡改检测、跨 Vault 拒绝、并发冲突、安全备份、事务恢复均通过。
- Frontend：空状态、真实备份、重复校验、确认门、恢复成功和错误反馈均为真实 API 交互。
- Python：20/20 测试脚本通过。
- Frontend：13/13 Vitest、lint、production build 通过。
- Playwright：9/9 通过。
- Desktop：`artifacts/backup-recovery-qa/backup-recovery-1440.png`
- 390px：`artifacts/backup-recovery-qa/backup-recovery-390.png`
- 390px 无页面级横向溢出；浏览器控制台无错误。

## 结论

- P0：无。
- P1：无。
- Blocking Issues：无。
- Known Limitation：备份为本机明文快照，保护依赖操作系统账户与磁盘安全；binding key 丢失后旧 managed backup 不能通过 UI 恢复。
- Future Roadmap：加密备份、可移动离线介质和密钥恢复需要独立威胁模型，不在本阶段实现。
