# Phase 6 — MCP统一测试与发布门禁

## 依赖重现

- `requirements.txt`：人工维护的Python直接依赖范围。
- `requirements.lock.txt`：包含传递依赖和哈希的运行时锁文件。
- `requirements-ci.txt`：发布工具的直接版本。
- `requirements-ci.lock.txt`：发布工具及传递依赖的哈希锁文件。
- `apps/web/package-lock.json`：Node依赖锁文件。

安装运行时依赖：

```powershell
python -m pip install --require-hashes -r requirements.lock.txt
cd apps/web
npm ci
```

更新Python锁文件需要显式执行`pip-compile`，不能在CI中隐式升级。

## 版本号

发布前需要同步以下标识，避免文档、安装包和 API 元数据互相矛盾：

- `apps/api/main.py` 中 `FastAPI(version=...)`；
- `apps/web/package.json` 的 `version`；
- Git tag（`v<version>`），Windows 安装包版本由 tag 推导。

## 真实MCP协议测试

`tests/test_mcp_protocol.py`会启动真实的stdio MCP子进程，验证：

- initialize握手；
- tools/list；
- 候选记忆写入与读取；
- 敏感内容拒绝；
- 缺失scope时拒绝调用。

测试只使用临时合成Vault。

## 发布安全门禁

CI会执行：

```powershell
pip-audit -r requirements.lock.txt
npm audit --audit-level=high --registry=https://registry.npmjs.org
python scripts/check_release.py
```

`check_release.py`扫描Git跟踪文件和Vite生产构建，阻止高置信度凭据、私钥以及Windows/macOS/Linux用户绝对路径进入公共发布物。

## SBOM

每次CI生成并上传：

- `python-sbom.json`
- `node-sbom.json`

格式为CycloneDX JSON。SBOM作为CI artifact保存，不提交到源码仓库。

## 干净Windows验证

独立的`windows-clean`任务从空白GitHub Windows runner开始：

1. 从Python哈希锁文件安装；
2. 运行真实MCP协议测试；
3. 通过`npm ci`构建React；
4. 启动、复用并关闭本地Launcher；
5. 执行发布隐私扫描。

Windows安装程序和代码签名仍属于后续发布阶段。
