# Personal AI Profile

> 一个以自然对话为入口、以用户确认作为记忆边界、通过 MCP 在不同 AI 之间共享的开源个人档案框架。

## 为什么做这个项目

很多人同时使用 ChatGPT、Codex、Claude、Cursor 等 AI，但每个 AI 都彼此隔离：

- 更换 AI 后，需要重新介绍自己的背景、偏好和项目；
- 项目进度、重要决定和长期目标无法自然延续；
- 平台内置记忆不透明，用户很难知道 AI 保存了什么；
- 个人数据容易被锁在某个平台，无法迁移和审计；
- 传统表单和手工维护 Markdown 又像在完成任务，体验不够自然。

Personal AI Profile 希望提供另一种方式：

> 用户只需要正常交流；AI 在对话中发现可能有长期价值的信息，先提出候选记忆，经用户确认后写入由用户掌控的私人档案。其他 AI 再通过统一接口按需读取同一份已确认资料。

## 它是什么

这个项目首先是一套**个人档案系统**，Agent 是交互入口，模型是可替换的分析工具。

```text
自然对话负责体验
私人档案负责记忆
Obsidian负责组织与查看
MCP负责跨AI共享
Human 3.0负责周期性反思
边界系统负责信任
```

它不是一个新的大模型，也不是自动收集所有聊天内容的监控工具。

## 核心原则

1. **用户拥有档案**：资料使用普通 Markdown 保存，不绑定任何 AI 厂商。
2. **本地优先**：本地 Obsidian Vault 是主要工作副本，GitHub Private Repository 只负责私有同步和版本历史。
3. **默认不保存完整聊天**：普通对话只作为临时上下文。
4. **AI 只能提出候选记忆**：未经用户确认，不得进入正式长期档案。
5. **最小上下文**：每次只向 AI 提供当前任务需要的信息。
6. **跨 AI 共享的是事实，不是完整会话**：不同 AI 读取同一份已确认档案。
7. **敏感信息不进入 Git**：密码、Token、验证码、私钥、证件和银行卡资料禁止保存。
8. **用户可以追溯和撤回**：每条记忆应当可以查看来源、修改、替代、拒绝和删除。

## 产品体验

用户不需要先填写一张很长的个人资料表，而是在日常交流中逐渐建立档案。

```text
用户：我更喜欢回答先给结论，再解释原因。

AI：这看起来是一项长期沟通偏好，需要我把它作为候选记忆保存吗？

用户：记住。
```

后台流程：

```text
自然对话
   ↓
识别可能有长期价值的信息
   ↓
生成候选记忆
   ↓
用户确认 / 修改 / 拒绝
   ↓
写入私人档案
   ↓
其他AI按需检索
```

用户还可以直接说：

```text
记住这件事
这只是临时讨论，不要保存
把它加入当前项目
你现在对我了解多少
这条信息是怎么得到的
忘掉关于某件事的记录
开始本月复盘
```

## 信息从哪里来

系统支持三类信息来源，但它们不能被混为一谈：

1. **自然对话**：获取目标、偏好、想法、感受以及决定背后的原因；
2. **用户主动记录**：Obsidian 笔记、语音、图片、网页、文件和快速灵感；
3. **用户授权的数据源**：未来可以接入 GitHub、日历、任务清单和项目文件，用于观察客观活动。

数据状态必须区分：

```text
Observed Activity    系统观察到的活动
Candidate Memory     AI提出、等待确认的记忆
Confirmed Memory     用户确认的正式长期记忆
```

没有对话时，系统可以整理已授权的客观活动并准备问题；涉及感受、动机、价值观和身份判断时，必须询问用户。

## 整体架构

```text
                         用户
                          ↓
                Codex / Claude / Cursor
                          ↓ MCP
               Personal Profile Gateway
          检索 / 隐私过滤 / 候选记忆 / 审计
                          ↓
                 Private Obsidian Vault
                          ↕
              GitHub Private Repository
                          ↓
          Dashboard / 项目 / 记忆 / Human 3.0
```

公开仓库只保存程序、模板、Schema、Prompt 和文档。真实档案必须位于用户自己的私人仓库中。

## 公开框架与私人档案

### 公开框架仓库

包含档案标准、Obsidian空白模板、本地MCP Gateway、隐私规则、复盘模板、初始化与验证工具、虚构示例和测试。

### 私人档案仓库

包含个人背景、偏好、目标、项目、已确认记忆、重要决定和周期复盘。

两个仓库完全分离，不能用公开仓库的分支保存私人资料，也不能共享 Git 历史。

## Obsidian Vault结构

```text
my-ai-profile/
├─ 00 Dashboard/
│  ├─ Home.md
│  ├─ Current Context.md
│  └─ Pending Memories.md
├─ 10 Profile/
│  └─ Profile.md
├─ 20 Projects/
│  ├─ Active/
│  └─ Archived/
├─ 30 Memory/
│  ├─ Inbox/
│  ├─ Confirmed/
│  └─ Decisions/
├─ 40 Reviews/
│  └─ Human3/
├─ 90 System/
│  └─ Indexes/
├─ AGENTS.md
└─ profile.config.yml
```

Obsidian 是查看、编辑、双向链接和可视化的界面；Markdown 才是可迁移的数据格式。

## 跨AI共享

本地 MCP Gateway 为不同 AI 提供统一工具：

```text
get_profile             读取稳定个人档案
get_current_context     读取当前目标与项目
search_memory           搜索允许访问的确认记忆
list_projects           读取活跃项目
propose_memory          创建候选记忆
list_pending            查看待确认内容
get_human3_summary      读取最近一次确认的复盘
```

MCP 不向 Agent 提供任意文件写入、确认、删除或公开能力。高风险操作应保留给可信的本地界面。

```json
{
  "mcpServers": {
    "personal-profile": {
      "command": "python",
      "args": ["ABSOLUTE_PATH_TO_FRAMEWORK/mcp_server.py"],
      "env": {
        "PROFILE_VAULT": "ABSOLUTE_PATH_TO_PRIVATE_VAULT",
        "PROFILE_AGENT_ID": "my-agent",
        "PROFILE_SCOPES": "profile:read,context:read,memory:search,memory:propose"
      }
    }
  }
}
```

第一阶段使用本地 `stdio`，不把档案服务暴露到公网。远程访问以后再考虑 HTTPS、OAuth、权限 Scope、撤销机制和审计日志。

每个AI客户端必须配置独立的`PROFILE_AGENT_ID`和最小`PROFILE_SCOPES`；缺失身份或权限时，Gateway默认拒绝访问。

## 记忆模型

```yaml
---
id: mem-20261101-001
type: preference
status: confirmed
created: 2026-11-01
source: conversation
visibility: private
ai_access: summary-only
confidence: explicit
related:
  - project-personal-ai-profile
---
```

推荐状态：

```text
candidate      AI提出，尚未确认
confirmed      用户已经确认
disputed       与现有信息冲突
superseded     已被新信息替代
archived       不再活跃但保留历史
```

访问等级：

```text
allowed        可以按任务发送给配置的模型
summary-only   只允许发送确认后的摘要
local-only     只允许本地模型处理
denied         禁止任何模型读取
```

## Human 3.0复盘

Human 3.0在这里是一个**可选的对话式自我反思模块**，不是医学或心理诊断。

它从四个维度帮助用户复盘：

```text
Mind       心智与认知
Body       身体与精力
Spirit     意义、关系与价值观
Vocation   工作、技能与创造
```

理想体验不是填写十二道固定表单，而是一段自然访谈：

```text
近期状态
→ Agent根据回答追问
→ 覆盖四个维度
→ 生成评估草稿和判断依据
→ 用户修改或确认
→ 生成未来30天行动计划
```

被动活动数据只能作为观察材料，不能直接推断用户的情绪、动机或发展等级。

## 隐私边界

### 可以自动完成

- 读取允许访问的个人摘要；
- 搜索已确认记忆；
- 整理授权来源中的客观活动；
- 检测重复和冲突；
- 创建候选记忆；
- 生成复盘草稿；
- 构建最小AI上下文。

### 必须等待用户

- 确认长期记忆；
- 修改稳定个人资料；
- 判断感受、动机和价值观；
- 确认Human 3.0正式评估；
- 删除重要记录；
- 连接新的数据源；
- 将敏感内容发送给云端模型；
- 对外公开任何档案内容。

### 永远不应保存

- 密码、Token、验证码、API Key、私钥和Cookie；
- 身份证件和银行卡资料；
- 未经脱敏的第三方隐私；
- 用户没有意愿长期保留的原始聊天。

Private Repository 不等于密码保险箱。秘密一旦进入Git历史，删除当前文件并不能自动清除历史。

## 当前状态

- [x] 公开框架与私人档案分离
- [x] Obsidian兼容Vault模板
- [x] 本地MCP Gateway
- [x] Codex、Claude Code和Cursor配置示例
- [x] 读取个人摘要和当前上下文
- [x] 搜索确认记忆
- [x] 创建候选记忆
- [x] 查看待确认记忆
- [x] Human 3.0基础目录和问题模板
- [x] 基础秘密扫描
- [x] GitHub Actions冒烟测试

当前实现仍然面向开发者，距离普通用户产品还缺少完整的确认界面和一键安装体验。

## MVP成功标准

第一阶段只证明一条完整链路：

```text
用户与AI A对话
→ AI A创建候选记忆
→ 用户在本地界面确认
→ 记忆进入Confirmed
→ AI B可以搜索到
→ 禁止访问的内容不会返回
```

只要这条链路稳定、透明、可撤回，项目的核心价值就成立。

## 路线图

### V0.1 档案标准

- [x] Markdown目录结构、候选与确认状态、隐私等级、Private同步模式

### V0.2 跨AI读取

- [x] 本地MCP stdio、基础工具、Codex/Claude Code/Cursor接入

### V0.3 记忆闭环

- [x] 候选记忆预览
- [x] 本地确认、修改和拒绝
- [x] 记忆来源查看与冲突处理
- [x] 遗忘和替代记录

### V0.4 对话式引导

- [ ] 空档案首次引导
- [ ] 渐进式了解用户
- [ ] 严格、平衡、主动三种记忆模式
- [ ] 无对话时的低频复盘提示

### V0.5 Obsidian控制中心

- [ ] 待确认记忆面板
- [ ] 项目状态卡片和记忆时间线
- [ ] Human 3.0趋势
- [ ] 隐私审计视图

### V0.6 普通用户安装

- [ ] Windows安装程序
- [ ] 自动创建私人Vault
- [ ] 自动检测AI客户端并配置MCP
- [ ] 连接诊断和修复

### V0.7 Human 3.0

- [ ] 对话式月度访谈
- [ ] 证据与信息不足标记
- [ ] 用户确认后的正式报告
- [ ] 30天行动计划

### V1.0

- [ ] 稳定Schema与迁移工具
- [ ] 完整测试和故障恢复
- [ ] 模型无关适配
- [ ] 数据导入、导出和公开内容脱敏管道

## 快速开始（当前开发者版本）

```powershell
git clone https://github.com/XY-code1/personal-ai-profile.git
cd personal-ai-profile
pip install -r requirements.txt

# 创建新的私人Vault
python profile.py init ../my-ai-profile

# 验证结构和疑似秘密
python profile.py validate ../my-ai-profile

# 启动本地MCP Gateway
$env:PROFILE_VAULT="C:\absolute\path\my-ai-profile"
python mcp_server.py
```

其他命令：

```text
remember PATH TEXT      创建候选记忆
list-pending PATH       列出待确认记忆
preview PATH FILE       预览候选记忆和元数据
edit PATH FILE TEXT     修改候选记忆
confirm PATH FILE       确认候选记忆
reject PATH FILE        拒绝并保留审计记录
show-source PATH FILE   查看记忆来源
forget PATH FILE        从有效记忆移除并归档
supersede PATH FILE TEXT 用新事实替代旧记忆
build-context PATH      生成最小AI上下文
human3 PATH             创建Human 3.0复盘草稿
```

> 当前CLI是底层能力，不是最终普通用户入口。最终用户应通过对话、Obsidian控制中心和安装向导使用系统。

## 暂时不做

- 自动保存所有聊天；
- 屏幕、键盘、麦克风或完整浏览历史监控；
- 复杂3D知识图谱；
- 云端账户系统；
- 常驻自主Agent；
- 无确认自动写入；
- 自动心理判断；
- 公网裸露的MCP服务。

## 开源与私人数据

本项目的程序、模板和文档可以开源；使用者填写的私人档案始终属于使用者本人。

```text
Public Framework Repository   开源程序和模板
Private Personal Vault        真实私人档案
Optional Public Export        经选择、脱敏和人工确认的公开内容
```

私人仓库不能直接合并到公开仓库。公开内容必须经过独立导出、敏感扫描和人工预览。

## License

[MIT](LICENSE)

