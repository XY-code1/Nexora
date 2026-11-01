# Personal AI Profile

一个本地优先、模型无关、用户确认后写入的个人 AI 档案框架。

## 边界

- 本仓库只保存公开的程序、空白模板和文档。
- 真实个人资料必须存放在用户自己的 Private 仓库。
- 模型只生成建议；未经确认，不写入正式档案。
- 密码、Token、验证码、私钥和证件资料不得进入 Git。

## 快速开始

```powershell
python profile.py init ../my-ai-profile
python profile.py validate ../my-ai-profile
python profile.py remember ../my-ai-profile "一条待确认的记忆"
python profile.py build-context ../my-ai-profile
```

生成的私人仓库结构：

```text
PROFILE.md            稳定背景与偏好
CONTEXT.md            当前目标和项目
memory/inbox/         待确认记忆
memory/confirmed/     已确认记忆
projects/active/      活跃项目
assessments/human3/   可选自我评估
indexes/ai-context.md 最小化模型上下文
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

仅使用 Python 标准库，不自动调用任何模型。

