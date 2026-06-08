@echo off
cd /d "C:\Users\nexon\Desktop\Podjetje\salonbot"
del /f ".git\index.lock" 2>nul
del /f ".git\HEAD.lock" 2>nul
git add -u
git commit -m "fix: auto_confirm flow, calendar hides cancelled, email/WA confirm buttons"
git push
echo.
echo DONE! Railway redeployira v ~1 min.
pause
