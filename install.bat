@echo off
setlocal

echo.
echo  TwitchLurker installer
echo  ----------------------
echo.
echo  Fetching latest release from GitHub...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$ProgressPreference='SilentlyContinue';" ^
  "try {" ^
    "$r = Invoke-RestMethod 'https://api.github.com/repos/benefvctr/Twitch-Lurker/releases/latest';" ^
    "$asset = $r.assets | Where-Object { $_.name -like '*.exe' } | Select-Object -First 1;" ^
    "if (-not $asset) { Write-Host '  No .exe asset found in latest release.' -ForegroundColor Red; exit 1 }" ^
    "$out = Join-Path $env:TEMP $asset.name;" ^
    "Write-Host \"  Downloading $($asset.name) ($([math]::Round($asset.size/1MB,1)) MB)...\";" ^
    "Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $out -UseBasicParsing;" ^
    "Write-Host \"  Launching installer...\";" ^
    "Start-Process $out;" ^
  "} catch {" ^
    "Write-Host \"  Error: $($_.Exception.Message)\" -ForegroundColor Red;" ^
    "exit 1" ^
  "}"

if errorlevel 1 (
  echo.
  echo  Install failed. See message above.
  pause
  exit /b 1
)

echo.
echo  Installer launched. Follow the prompts to complete setup.
echo  Windows SmartScreen will warn — click "More info" then "Run anyway".
echo.
pause
