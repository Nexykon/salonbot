@echo off
cd /d "C:\Users\nexon\Desktop\Podjetje\salonbot"
echo === Fixing git index ===
del /f ".git\index.lock" 2>nul
del /f ".git\HEAD.lock" 2>nul
del /f ".git\index" 2>nul
git reset HEAD
echo === Adding files ===
git add .env.example server.js package.json push_fix.ps1 public/settings.html public/index.html public/dashboard.html public/book.html src/handler.js src/whatsapp.js src/supabase.js src/scheduler.js src/ai.js src/calendar.js src/auth.js src/email.js src/presets.js src/session.js
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "fix: inquiry flow adds date+time steps, fix owner_email suppression"
) else (
  echo Nothing to commit - pushing anyway
)
git push
echo.
echo DONE! Railway redeployira v ~1 min.
pause
