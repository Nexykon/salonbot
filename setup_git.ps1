# SalonBot – Git setup & GitHub push
# Pozeni z: Right-click -> Run with PowerShell

$folder = "C:\Users\nexon\Desktop\Podjetje\salonbot"
Set-Location $folder

Write-Host "=== SalonBot Git Setup ===" -ForegroundColor Cyan

# Git config
git config --global user.email "nexon.crypto@gmail.com"
git config --global user.name "Tomaz Nexon"
git config --global init.defaultBranch main

# Init repo
git init
git add .
git commit -m "SalonBot v3 - Node.js brez n8n"

Write-Host ""
Write-Host "=== Zdaj pojdi na github.com/new ===" -ForegroundColor Yellow
Write-Host "1. Ustvari repo z imenom: salonbot" -ForegroundColor White
Write-Host "2. NE dodajaj README/gitignore" -ForegroundColor White
Write-Host "3. Ko je ustvarjen, kopiraj URL (npr. https://github.com/TVOJ_USER/salonbot.git)" -ForegroundColor White
Write-Host ""
$repoUrl = Read-Host "Prilepi GitHub URL tukaj"

git remote add origin $repoUrl
git branch -M main
git push -u origin main

Write-Host ""
Write-Host "DONE! Koda je na GitHubu." -ForegroundColor Green
Write-Host "Zdaj pojdi na railway.app in poveži ta repo." -ForegroundColor Cyan
pause
