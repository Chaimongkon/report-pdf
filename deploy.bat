@echo off
chcp 65001 >nul
echo ============================================
echo   Deploy report-pdf to Server
echo ============================================
echo.

set SOURCE=D:\3\Project\report-pdf
set TARGET=C:\inetpub\report-pdf
set APP_NAME=report-pdf

echo [1/5] Stopping PM2 app: %APP_NAME% ...
cd /d %TARGET%
pm2 stop %APP_NAME% 2>nul
echo.

echo [2/5] Copying files to %TARGET% ...

:: Copy source folders
robocopy "%SOURCE%\src" "%TARGET%\src" /MIR /NFL /NDL /NJH /NJS
robocopy "%SOURCE%\templates" "%TARGET%\templates" /MIR /NFL /NDL /NJH /NJS
robocopy "%SOURCE%\public" "%TARGET%\public" /MIR /NFL /NDL /NJH /NJS

:: Copy root files
copy /Y "%SOURCE%\server.js" "%TARGET%\server.js" >nul
copy /Y "%SOURCE%\package.json" "%TARGET%\package.json" >nul
copy /Y "%SOURCE%\package-lock.json" "%TARGET%\package-lock.json" >nul
copy /Y "%SOURCE%\ecosystem.config.js" "%TARGET%\ecosystem.config.js" >nul

:: Do NOT overwrite .env on server (it may have different config)
if not exist "%TARGET%\.env" (
    copy /Y "%SOURCE%\.env" "%TARGET%\.env" >nul
    echo   .env copied (first time)
) else (
    echo   .env skipped (already exists on server)
)
echo   Files copied successfully.
echo.

echo [3/5] Installing dependencies ...
cd /d %TARGET%
call npm install --production
echo.

echo [4/5] Starting PM2 app ...
cd /d %TARGET%
pm2 delete %APP_NAME% 2>nul
pm2 start ecosystem.config.js
echo.

echo [5/5] Saving PM2 process list ...
pm2 save
echo.

echo ============================================
echo   Deploy completed!
echo   App: %APP_NAME%
echo   Path: %TARGET%
echo ============================================
echo.
pm2 status
pause
