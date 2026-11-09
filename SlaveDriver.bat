@echo off
rem Double-click to start SlaveDriver. The console window closes right away.
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo First run: installing dependencies...
  call npm install || (pause & exit /b 1)
)
set ELECTRON_RUN_AS_NODE=
start "" "node_modules\electron\dist\electron.exe" . %*
