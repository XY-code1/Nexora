# Memory Lifecycle

## 状态流转

```text
对话或主动记录
  → candidate（Inbox）
  → confirmed（Confirmed）
  → forgotten / superseded（Archived）

candidate
  → rejected（Rejected）

candidate
  → disputed（Inbox，等待处理冲突）
```

## 信任边界

- MCP Agent只能调用`propose_memory`创建候选记忆。
- 确认、修改、拒绝、遗忘和替代只能通过本地可信CLI或未来的本地审核界面完成。
- 所有状态变化保留原文件、来源Agent、时间和原因；拒绝与遗忘不是物理删除。
- `Confirmed`是跨AI检索的唯一长期记忆来源。

## 本地审核命令

```powershell
python profile.py list-pending VAULT
python profile.py preview VAULT FILE
python profile.py edit VAULT FILE "修改后的内容"
python profile.py confirm VAULT FILE
python profile.py reject VAULT FILE --reason "原因"
python profile.py show-source VAULT FILE
python profile.py forget VAULT FILE --reason "原因"
python profile.py supersede VAULT CONFIRMED_FILE "新的事实"
```

## 冲突处理

- 内容指纹相同：视为重复，拒绝再次确认。
- `type`与`subject`相同但内容不同：标记为`disputed`。
- 用户可以修改或拒绝冲突候选，也可以使用`supersede`明确用新事实替代旧事实。

