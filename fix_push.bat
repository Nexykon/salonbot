@echo off
cd /d "C:\Users\nexon\Desktop\Podjetje\salonbot"
del /f ".git\index.lock" 2>nul
del /f ".git\HEAD.lock" 2>nul
git add server.js
git commit -m "fix: add auto_confirm to owner PATCH settings allowed fields"
git push
echo.
echo DONE! Railway redeployira v ~1 min.
pause
