@echo off
cd /d "%~dp0"
git add .
git commit -m "update"
git push
echo.
echo DONE! Railway redeploya v ~1 min
pause
