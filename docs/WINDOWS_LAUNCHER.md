# Phase 4 — Windows本地启动闭环

## 用户入口

双击`start-review.vbs`静默启动；出现问题时运行`start-review.cmd`查看错误。也可以直接运行：

```powershell
python launcher.py --vault C:\absolute\path\my-ai-profile
```

若未传入Vault，Launcher依次检查`PROFILE_VAULT`、框架同级的`my-ai-profile`，最后显示本地目录选择器。

## 启动流程

1. 在`%LOCALAPPDATA%\PersonalAIProfile`获取单实例锁。
2. 缺少前端构建时自动执行`npm install`和`npm run build`。
3. 在`127.0.0.1`自动选择空闲端口。
4. 生成本次运行专用Bearer token，启动FastAPI并等待health ready。
5. token通过URL fragment交给React；React读取后立即清除地址栏，只在页面内存中保存。
6. runtime文件保存PID、端口、token和Vault路径，仅位于当前用户的Local AppData，正常退出时删除。
7. 第二次启动复用已有实例并重新打开浏览器，不启动第二个服务。
8. React中的“关闭服务”调用认证后的`/api/v1/shutdown`，Uvicorn优雅退出后清理runtime和锁文件。

异常退出留下的runtime文件会在下一次成功获取单实例锁后被覆盖；Vault内部的pending事务仍由Core在下一次加锁时恢复。

## 当前边界

- 仅监听loopback，不接受LAN或公网连接。
- Launcher仍依赖系统Python；缺少已构建前端时还需要Node.js。将Python和前端打包为无需开发环境的安装程序属于后续发布阶段。
- `review_app.py`和旧审核界面继续保留一个兼容周期。

## 验证

```powershell
cd apps/web
npm run build
cd ../..
python tests/test_launcher.py
```

集成测试使用临时合成Vault，验证自动端口、health、重复启动复用、认证关闭和runtime清理。
