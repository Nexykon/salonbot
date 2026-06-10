@echo off
cd /d "%~dp0"
if exist ".git\index.lock" del /f ".git\index.lock"
git add .
git commit -m "update"
git push
echo.
echo DONE! Railway redeploya v ~1 min
pause
