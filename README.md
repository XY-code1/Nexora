# Personal AI Profile

一个以自然对话为入口、以Obsidian和Private GitHub为记忆底座、通过MCP跨AI共享的个人档案框架。

## 边界

- 本仓库只保存公开的程序、空白模板和文档。
- 真实个人资料必须存放在用户自己的 Private 仓库。
- 模型只生成建议；未经确认，不写入正式档案。
- 密码、Token、验证码、私钥和证件资料不得进入 Git。

## 架构

```text
Codex / Claude / Cursor / 其他AI
                 ↓ MCP
         本地Profile Gateway
                 ↓
     Obsidian Vault + GitHub Private
```

Agent只能读取允许的最小上下文和创建候选记忆，不能直接确认、删除或公开资料。

## 快速开始

```powershell
python profile.py init ../my-ai-profile
python profile.py validate ../my-ai-profile
python profile.py remember ../my-ai-profile "一条待确认的记忆"
python profile.py build-context ../my-ai-profile
pip install -r requirements.txt
$env:PROFILE_VAULT="C:\absolute\path\my-ai-profile"
python mcp_server.py
```

生成的私人仓库结构：

```text
00 Dashboard/         Obsidian首页、当前上下文和待确认入口
10 Profile/           稳定背景与偏好
20 Projects/          项目
30 Memory/            候选、确认和决策记忆
40 Reviews/Human3/    对话式月度复盘
90 System/Indexes/    最小化模型上下文
```

## 命令

```text
init PATH                         初始化私人档案
validate PATH                     检查结构、元数据和疑似秘密
remember PATH TEXT                创建候选记忆
confirm PATH FILE                 确认 inbox 中的一条记忆
build-context PATH                生成最小 AI 上下文
human3 PATH                       创建 Human 3.0 问卷草稿
```

CLI仅使用Python标准库；跨AI接入使用官方MCP Python SDK。框架不自动调用模型。

## MCP工具

```text
get_profile             读取稳定档案
get_current_context     读取当前目标
search_memory           搜索允许访问的确认记忆
list_projects           读取活跃项目
propose_memory          创建候选记忆
list_pending            查看待确认内容
get_human3_summary      读取最近复盘
```

将`mcp.example.json`中的两个路径改成绝对路径，再添加到支持MCP的AI客户端。不同AI由此共享同一份档案，而不是共享完整聊天记录。

