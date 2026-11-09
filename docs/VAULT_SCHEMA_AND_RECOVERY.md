# Vault Schema、备份与恢复

当前Vault schema版本为`1`，权威版本位于`profile.config.yml`的`schema_version`。

## 启动规则

1. Launcher拒绝与公共框架仓库任一方向目录重叠的私人Vault。
2. API、MCP和Launcher不会暗中修改schema；旧版必须由用户显式执行`migrate`。
3. 旧schema升级前，先在用户数据目录创建完整快照。
4. migration失败时立即从快照恢复，不保留部分升级状态。
5. 高于程序支持版本的Vault直接拒绝打开，不尝试降级。

Windows默认备份目录：

```text
%LOCALAPPDATA%\PersonalAIProfile\backups
```

备份不会写入私人Vault或公共框架仓库；`.git`、`.env`、`*.key`、`*.pem`、运行锁和事务日志不会复制到快照，但MCP审计记录会保留。恢复会保留当前Vault中明确排除的`.git`、`.env`、`*.key`和`*.pem`；快照外的普通文件会被移除，`Locks`和`Transactions`运行目录不会从旧Vault带回。备份包含文件清单与SHA-256校验；恢复会先在临时目录完整验证，再切换Vault。持久化journal会在异常中断后恢复上一版本。符号链接和Windows重解析点会被拒绝。

手动管理命令：

```powershell
python profile.py migrate C:\path\private-vault
python profile.py backup C:\path\private-vault
python profile.py restore C:\path\private-vault C:\path\backup-folder
```

## 公开导出边界

公开导出不是复制整个Vault。`stage_public_export`只处理调用方显式列出的Markdown文件，并要求每个文件包含：

```yaml
---
visibility: public
---
```

导出前执行路径约束和敏感信息检查。任一文件不满足条件时，整批导出失败，不生成部分公开结果。staging目录也不得位于Vault或公共框架仓库内。已存在的目录只有包含Personal AI Profile ownership marker时才能被下一次导出替换，不会删除误填的普通目录。

```powershell
python profile.py export-public C:\path\private-vault C:\path\public-staging "10 Profile/Public.md"
```

## 开发新migration

- migration只负责从相邻版本升级，例如`1 -> 2`。
- 在`MIGRATIONS`中按源版本注册。
- 更新模板中的`schema_version`与`CURRENT_SCHEMA_VERSION`。
- 必须增加正常升级、故障注入回滚和旧版本恢复测试。
- 不编写自动降级，不在迁移中上传数据。
