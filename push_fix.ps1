# FlowTiq - Full push: multi-tenant platform + owner OTP + presets
# Pozeni z: Right-click -> Run with PowerShell

Set-Location "C:\Users\nexon\Desktop\Podjetje\salonbot"

Write-Host "=== Checking FlowTiq before push ===" -ForegroundColor Cyan

node --check server.js
if ($LASTEXITCODE -ne 0) { Write-Host "server.js check failed" -ForegroundColor Red; pause; exit 1 }

node --check src/supabase.js
if ($LASTEXITCODE -ne 0) { Write-Host "supabase.js check failed" -ForegroundColor Red; pause; exit 1 }

node --check src/handler.js
if ($LASTEXITCODE -ne 0) { Write-Host "handler.js check failed" -ForegroundColor Red; pause; exit 1 }

node --check src/ai.js
if ($LASTEXITCODE -ne 0) { Write-Host "ai.js check failed" -ForegroundColor Red; pause; exit 1 }

node --check src/auth.js
if ($LASTEXITCODE -ne 0) { Write-Host "auth.js check failed" -ForegroundColor Red; pause; exit 1 }

node --check src/email.js
if ($LASTEXITCODE -ne 0) { Write-Host "email.js check failed" -ForegroundColor Red; pause; exit 1 }

node --check src/whatsapp.js
if ($LASTEXITCODE -ne 0) { Write-Host "whatsapp.js check failed" -ForegroundColor Red; pause; exit 1 }

Write-Host "=== Removing git lock files ===" -ForegroundColor Cyan
Remove-Item -Force ".git\index.lock" -ErrorAction SilentlyContinue
Remove-Item -Force ".git\HEAD.lock" -ErrorAction SilentlyContinue
Remove-Item -Force ".git\objects\maintenance.lock" -ErrorAction SilentlyContinue

Write-Host "=== Committing FlowTiq changes ===" -ForegroundColor Cyan

git add .env.example server.js package.json package-lock.json push_fix.ps1 FLOWTIQ_TATTOO_ONBOARDING_RUNBOOK.md public/index.html public/dashboard.html public/book.html public/settings.html src/handler.js src/whatsapp.js src/supabase.js src/scheduler.js src/ai.js src/calendar.js src/auth.js src/email.js src/presets.js src/session.js

git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Write-Host "No changes to commit. Pushing current branch anyway..." -ForegroundColor Yellow
} else {
  git commit -m "feat: inquiry flow for tattoo salons - form fields, no date picker, admin email/WA notify"
  if ($LASTEXITCODE -ne 0) { Write-Host "git commit failed" -ForegroundColor Red; pause; exit 1 }
}

Write-Host "=== Pushing to GitHub ===" -ForegroundColor Cyan
git push
if ($LASTEXITCODE -ne 0) { Write-Host "git push failed" -ForegroundColor Red; pause; exit 1 }

Write-Host ""
Write-Host "DONE! Railway bo redeployiral v ~1 min." -ForegroundColor Green
pause
