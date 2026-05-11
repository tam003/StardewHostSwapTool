@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
set "PS1_PATH=%SCRIPT_DIR%Swap-StardewHost.ps1"

if not exist "%PS1_PATH%" (
    echo Cannot find Swap-StardewHost.ps1 next to this batch file.
    echo Copy both files into save folder, then run this batch file again.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1_PATH%"
set "EXIT_CODE=%ERRORLEVEL%"

pause
exit /b %EXIT_CODE%
