@echo off
cd /d "C:\Users\Renukaradya\.gemini\antigravity\scratch\ms-rewards-assistant"
"C:\Program Files\nodejs\node.exe" src/index.js %* > run.log 2>&1
exit /b 0
