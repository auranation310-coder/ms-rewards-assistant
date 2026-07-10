# PowerShell script to register Microsoft Rewards Assistant as a daily Windows Scheduled Task
$ErrorActionPreference = "Stop"

$TaskName = "MicrosoftRewardsAssistant"
$ScriptDir = "C:\Users\Renukaradya\.gemini\antigravity\scratch\ms-rewards-assistant"
$ScriptPath = "$ScriptDir\src\index.js"

Write-Host "Configuring task scheduler for: $ScriptPath"

# Find absolute path of node.exe
$NodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $NodePath) {
    # Try common where.exe fallback
    $NodePath = (where.exe node 2>$null | Select-Object -First 1)
}

if (-not $NodePath) {
    Write-Error "Could not find node.exe on your system path. Please ensure Node.js is installed and on your PATH."
    exit 1
}

Write-Host "Found Node path: $NodePath"

# Check if script exists
if (-not (Test-Path $ScriptPath)) {
    Write-Error "Script not found at: $ScriptPath"
    exit 1
}

# Create daily trigger at 9:00 AM
# You can customize the time here
$Trigger = New-ScheduledTaskTrigger -Daily -At "03:00PM"

# Create action to execute node with index.js as argument in the working directory
$Action = New-ScheduledTaskAction -Execute $NodePath -Argument $ScriptPath -WorkingDirectory $ScriptDir

# Create settings (allow run if on battery, catch up if missed)
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

# Register task under current user
Write-Host "Registering task '$TaskName'..."
Register-ScheduledTask -TaskName $TaskName -Trigger $Trigger -Action $Action -Settings $Settings -Description "Runs Microsoft Rewards Assistant daily in background" -Force

Write-Host "Task registered successfully! It is scheduled to run daily at 3:00 PM."
Write-Host "To test it manually in the background, run:"
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
