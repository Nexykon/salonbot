@echo off
cd /d "C:\Users\nexon\Desktop\Podjetje\salonbot_fresh"
echo Starting preview on http://localhost:3333 ...
start "" "http://localhost:3333"
node preview_server.js
pause
