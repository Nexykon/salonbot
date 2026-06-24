@echo off
cd /d "%~dp0"

echo === Cleaning git locks ===
del /f /q ".git\index.lock" 2>nul
del /f /q ".git\HEAD.lock" 2>nul

echo === Syncing with remote ===
git fetch origin
git reset --mixed origin/main

echo === Committing changes ===
git add push.bat server.js public\index.html public\dashboard.html public\settings.html public\book.html src\handler.js src\whatsapp.js src\supabase.js src\email.js src\scheduler.js src\ai.js src\calendar.js src\auth.js src\session.js src\presets.js package.json .env.example

git diff --cached --quiet
if %ERRORLEVEL% == 0 (
  echo No changes to commit.
) else (
  git commit -m "update"
)

echo === Pushing ===
git push
if %ERRORLEVEL% neq 0 (
  echo.
  echo PUSH FAILED - preveri napake zgoraj
  pause
  exit /b 1
)

echo.
echo DONE! Railway redeploya v ~1 min
pause
