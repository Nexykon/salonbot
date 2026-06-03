# FlowTiq - Lokalni preview strežnik
# Pozeni z: Right-click -> Run with PowerShell

Set-Location "C:\Users\nexon\Desktop\Podjetje\salonbot\public"

Write-Host "=== FlowTiq lokalni preview ===" -ForegroundColor Cyan
Write-Host "Odpira http://localhost:3333" -ForegroundColor Green

# Odpri Chrome z lokalnim strežnikom
Start-Process "chrome.exe" "http://localhost:3333"

# Zaženi Python HTTP strežnik
python -m http.server 3333
