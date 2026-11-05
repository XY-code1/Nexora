@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Personal AI Profile 启动诊断

echo ============================================================
echo   Personal AI Profile - 启动诊断
echo   目录: %CD%
echo ============================================================
echo.

echo [1/8] 检查 Python ...
where python >nul 2>nul
if errorlevel 1 (
  echo   [FAIL] 找不到 python 命令。
  echo          请安装 Python 3.10+ 并勾选 "Add Python to PATH"。
  goto :summary
)
for /f "delims=" %%v in ('python --version 2^>^&1') do echo   OK: %%v
where pythonw >nul 2>nul
if errorlevel 1 (echo   [WARN] 找不到 pythonw，start-review.vbs 无法静默启动，请改用 start-review.cmd) else (echo   OK: pythonw 存在)

echo.
echo [2/8] 检查 Python 依赖 ...
python -c "import fastapi, uvicorn, filelock" 2>nul
if errorlevel 1 (
  echo   [FAIL] 缺少 fastapi/uvicorn/filelock，正在安装 ...
  python -m pip install -r requirements.txt
  if errorlevel 1 (
    echo   [FAIL] 安装失败，请检查网络或 pip 源。
    goto :summary
  )
  echo   OK: 依赖安装完成
) else (
  echo   OK: fastapi / uvicorn / filelock 已安装
)
python -c "import mcp" 2>nul
if errorlevel 1 (echo   [WARN] 缺少 mcp（只影响 MCP Gateway，不影响网页界面）) else (echo   OK: mcp 已安装)
python -c "import tkinter" 2>nul
if errorlevel 1 (echo   [WARN] 缺少 tkinter，未选 Vault 时无法弹目录选择框） else (echo   OK: tkinter 可用)

echo.
echo [3/8] 检查前端构建 ...
if exist "apps\web\dist\index.html" (
  echo   OK: apps\web\dist\index.html 存在
) else (
  echo   [WARN] 没有前端构建。launcher.py 会自动跑 npm install / npm run build，
  echo          需要本机装有 Node.js；或改用 npm run dev 开发模式。
)

echo.
echo [4/8] 查找私人 Vault ...
if defined PROFILE_VAULT (
  if exist "%PROFILE_VAULT%" (
    echo   OK: 环境变量 PROFILE_VAULT=%PROFILE_VAULT%
  ) else (
    echo   [WARN] PROFILE_VAULT 指向的目录不存在: %PROFILE_VAULT%
  )
) else (
  echo   [INFO] 未设置 PROFILE_VAULT
)
if exist "%~dp0..\my-ai-profile" (
  echo   OK: %~dp0..\my-ai-profile
) else (
  echo   [INFO] 仓库同级没有 my-ai-profile，启动时会弹出目录选择框（需 tkinter）
)

echo.
echo [5/8] 检查上次的启动错误日志 ...
set LOG=%LOCALAPPDATA%\PersonalAIProfile\launcher-error.log
if exist "%LOG%" (
  echo   [发现错误日志] %LOG%
  echo   ----------------------------------------
  type "%LOG%"
  echo   ----------------------------------------
) else (
  echo   OK: 没有 launcher-error.log
)

echo.
echo [6/8] 检查残留运行时文件 ...
if exist "%LOCALAPPDATA%\PersonalAIProfile\launcher.lock" (
  echo   [INFO] 存在 launcher.lock（进程退出时会自动释放，属正常现象）
) else (
  echo   OK: 无 launcher.lock
)

echo.
echo [7/8] 实测启动 ...
echo   正在执行: python launcher.py --no-browser
start "PAP-diag" /min cmd /c "python launcher.py --no-browser > "%TEMP%\pap-diag.log" 2>&1"
set READY=
set /a TRIES=0
:waitloop
set /a TRIES+=1
if !TRIES! gtr 25 goto :testfail
timeout /t 1 /nobreak >nul
for /f "delims=" %%h in ('python scripts\probe_health.py 2^>^&1') do set HEALTH=%%h
if defined HEALTH (
  echo   %%HEALTH%%
  echo   %%HEALTH%% | findstr /b "HEALTH_OK" >nul && set READY=1 && goto :testdone
)

:testfail
echo   [FAIL] 25 秒内服务未就绪。启动日志：
echo   ----------------------------------------
if exist "%TEMP%\pap-diag.log" type "%TEMP%\pap-diag.log"
echo   ----------------------------------------
goto :final

:testdone
if defined READY (
  echo.
  echo   测试实例仍在后台运行。
  echo   正式使用：双击 start-review.vbs（会自动复用此实例并打开浏览器）。
  echo   若浏览器没有自动打开，手动打开上面显示的地址即可（令牌已在 URL 中）。
)

:final
echo.
echo [8/8] 收尾 ...
echo   如需停止测试实例，双击 start-review.vbs 打开页面后点"关闭服务"，
echo   或直接结束名为 "PAP-diag" 的窗口。

echo.
echo ============================================================
echo   诊断结束
echo ============================================================
pause
exit /b 0

:summary
echo.
echo ============================================================
echo   诊断中断于早期检查，请先解决上面的 [FAIL]
echo ============================================================
pause
exit /b 0
