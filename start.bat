@echo off
chcp 65001 >nul
cd /d %~dp0
where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js，请先安装 Node 18 以上版本（本机应已装 v24）。
  pause
  exit /b 1
)
echo [灵山掌门] 本地代理启动中：http://127.0.0.1:8787  （停止：关闭本窗口或 Ctrl+C）
node server.js
echo.
echo [灵山掌门] 代理已退出。
pause
