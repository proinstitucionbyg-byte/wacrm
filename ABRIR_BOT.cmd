@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -File "%~dp0scripts\multichannel\whatsapp-session\start.ps1" -PreferredSupport -OpenPanel
if errorlevel 1 pause
