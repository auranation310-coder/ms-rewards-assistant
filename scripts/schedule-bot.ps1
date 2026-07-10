# schedule-bot.ps1
# Registers the Telegram Bot command listener to run 24/7 in the background on Windows.

$ScriptDir = "C:\Users\Renukaradya\.gemini\antigravity\scratch\ms-rewards-assistant"
$BatPath = Join-Path $ScriptDir "run-bot.bat"
$TaskName = "MicrosoftRewardsTelegramBot"

Write-Host "Configuring 24/7 Telegram Bot Task via schtasks targeting run-bot.bat..."
Write-Host "Batch path: $BatPath"

# Create a task that repeats every 1 minute indefinitely
# This does not require admin privileges and runs in the background
$Command = "schtasks /create /tn `"$TaskName`" /tr `"$BatPath`" /sc daily /st 00:00 /ri 1 /du 24:00 /f"
Write-Host "Executing command: $Command"
Invoke-Expression $Command

# Start the task immediately
Write-Host "Starting task immediately..."
schtasks /run /tn $TaskName
Write-Host "Bot registered and active 24/7 in the background!"
