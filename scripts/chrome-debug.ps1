# Start Google Chrome with a remote-debugging port so demo-capture can list and record its tabs.
# Uses a dedicated profile (Chrome refuses remote debugging on the default one since v136).
# Usage: powershell -ExecutionPolicy Bypass -File scripts\chrome-debug.ps1 [url ...]
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Urls)

$Port = if ($env:PORT) { $env:PORT } else { 9222 }
$Profile = if ($env:DEMO_AGENT_CHROME_PROFILE) { $env:DEMO_AGENT_CHROME_PROFILE } else { Join-Path $HOME ".demo-agent\chrome-profile" }
New-Item -ItemType Directory -Force -Path $Profile | Out-Null

try { Invoke-RestMethod "http://127.0.0.1:$Port/json/version" -TimeoutSec 1 | Out-Null; "Chrome écoute déjà sur le port $Port."; exit 0 } catch {}

$Chrome = $env:DEMO_AGENT_CHROME
if (-not $Chrome) {
  $Chrome = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LocalAppData\Google\Chrome\Application\chrome.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $Chrome) { Write-Error "Chrome introuvable. Définis DEMO_AGENT_CHROME."; exit 1 }

$ArgsList = @("--remote-debugging-port=$Port", "--user-data-dir=`"$Profile`"", "--no-first-run", "--no-default-browser-check") + $Urls
Start-Process -FilePath $Chrome -ArgumentList $ArgsList

for ($i = 0; $i -lt 50; $i++) {
  try { Invoke-RestMethod "http://127.0.0.1:$Port/json/version" -TimeoutSec 1 | Out-Null; "Chrome prêt sur http://127.0.0.1:$Port (profil : $Profile)."; exit 0 } catch { Start-Sleep -Milliseconds 200 }
}
Write-Error "Chrome n'a pas ouvert le port $Port."; exit 1
