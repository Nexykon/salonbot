@echo off
cd /d "%~dp0"
echo Brisem git lock...
if exist ".git\index.lock" (
    del /f /q ".git\index.lock"
    echo Lock odstranjen.
)
if exist ".git\COMMIT_EDITMSG.lock" del /f /q ".git\COMMIT_EDITMSG.lock"
echo Commitam spremembe...
git add .
git commit -m "fix: delivery redirect + logo sizes"
echo Pushanje na Railway...
git push
echo.
echo DONE! Railway redeploya v ~1 min
pause
