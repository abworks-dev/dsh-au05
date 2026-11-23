@echo off
setlocal
where pwsh.exe >nul 2>nul
if errorlevel 1 (
  echo PowerShell 7 is required. Install PowerShell 7 and try again.
  pause
  exit /b 1
)
pwsh.exe -NoLogo -NoProfile -STA -File "%~dp0scripts\observer-gui.ps1"
exit /b %errorlevel%
