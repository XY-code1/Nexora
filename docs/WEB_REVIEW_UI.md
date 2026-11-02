# Phase 3 — Web 审核界面

`apps/web/` 是 React + TypeScript + Vite 实现的本地审核界面。它取代产品主路径中的服务端字符串 HTML，但`review_app.py`继续作为兼容入口。

## 开发

先在一个终端启动本地 API：

```powershell
python -m apps.api.main --vault C:\absolute\path\my-ai-profile
```

将终端输出的启动令牌填入浏览器页面；令牌仅保存在当前页面内存中，不写入localStorage、构建产物或Vault。

另开一个终端：

```powershell
cd apps/web
npm install
npm run dev
```

Vite开发服务器将`/api`代理到`127.0.0.1:8765`。生产构建使用相对`/api`路径，由FastAPI直接托管`apps/web/dist`。

## 功能边界

- 候选列表、详情、编辑、确认、拒绝。
- 支持加载、空状态、请求错误和`409 REVISION_CONFLICT`提示。
- 不发送任何外部网络请求。
- 不读写Markdown文件；所有请求都经过`/api/v1`和Core的锁、revision与策略边界。
- Phase 4将以短期bootstrap会话替代手动输入启动令牌，并提供单实例启动器。

## 验证

```powershell
cd apps/web
npm run typecheck
npm test
npm run build
npm run e2e
```

`npm run e2e`启动一个临时、合成Vault的FastAPI服务，通过真实浏览器完成“编辑候选记忆→确认”的流程；它不读取私人Vault。
