<#
.SYNOPSIS
  Toggle OYUNS ALL-IN-ONE dev mode ON or OFF.
.DESCRIPTION
  Flips DEV_MODE in backend\.env and VITE_DEV_MODE in frontend\.env simultaneously.
  Run without arguments to toggle, or pass -On / -Off explicitly.
.EXAMPLE
  .\dev-toggle.ps1          # toggle current state
  .\dev-toggle.ps1 -On      # force dev mode ON
  .\dev-toggle.ps1 -Off     # force dev mode OFF (production-safe)
#>
param(
    [switch]$On,
    [switch]$Off
)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendEnv  = Join-Path $root "backend\.env"
$frontendEnv = Join-Path $root "frontend\.env"

# --- Helpers ---
function Set-EnvValue {
    param([string]$File, [string]$Key, [string]$Value)
    if (Test-Path $File) {
        $content = Get-Content $File -Raw
        if ($content -match "(?m)^$Key=.*$") {
            $content = $content -replace "(?m)^$Key=.*$", "$Key=$Value"
        } else {
            $content = $content.TrimEnd() + "`n$Key=$Value`n"
        }
        Set-Content $File -Value $content -NoNewline
    } else {
        Set-Content $File -Value "$Key=$Value`n" -NoNewline
    }
}

function Get-EnvValue {
    param([string]$File, [string]$Key)
    if (Test-Path $File) {
        $match = Select-String -Path $File -Pattern "^$Key=(.+)$" | Select-Object -First 1
        if ($match) { return $match.Matches.Groups[1].Value.Trim() }
    }
    return $null
}

# --- Determine target state ---
$current = Get-EnvValue -File $backendEnv -Key "DEV_MODE"
if ($On)       { $target = "true"  }
elseif ($Off)  { $target = "false" }
elseif ($current -eq "true") { $target = "false" }
else           { $target = "true"  }

# --- Apply ---
Set-EnvValue -File $backendEnv  -Key "DEV_MODE"      -Value $target
Set-EnvValue -File $frontendEnv -Key "VITE_DEV_MODE"  -Value $target

# --- Report ---
$icon = if ($target -eq "true") { "[ON]" } else { "[OFF]" }
Write-Host ""
Write-Host "  OYUNS ALL-IN-ONE  Dev Mode: $icon" -ForegroundColor $(if ($target -eq "true") { "Green" } else { "Yellow" })
Write-Host ""
Write-Host "  backend\.env   -> DEV_MODE=$target"
Write-Host "  frontend\.env  -> VITE_DEV_MODE=$target"
Write-Host ""
if ($target -eq "true") {
    Write-Host "  Auth bypass is ACTIVE. Mock users via DevToolbar." -ForegroundColor Cyan
} else {
    Write-Host "  Auth bypass is DISABLED. Real Telegram auth required." -ForegroundColor Yellow
}
Write-Host ""
Write-Host "  Restart both servers for changes to take effect." -ForegroundColor DarkGray
Write-Host ""
