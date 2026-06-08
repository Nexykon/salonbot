@echo off
cd /d "C:\Users\nexon\Desktop\Podjetje\salonbot"
del /f ".git\index.lock" 2>nul
del /f ".git\HEAD.lock" 2>nul
git add -u
git add public/terms.html public/privacy.html public/cookies.html 2>nul
git commit -m "feat: legal pages (terms, privacy, cookies) + cookie banner + footer links"
git push
echo.
echo DONE! Railway redeployira v ~1 min.
pause
