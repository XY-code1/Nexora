param(
    [string]$Version = "0.0.0-ci"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$Installer = Join-Path $Root "artifacts\personal-ai-profile-setup-$Version.exe"
if (-not (Test-Path $Installer)) {
    throw "Windows installer not found: $Installer"
}

if (-not $env:RUNNER_TEMP) {
    $env:RUNNER_TEMP = [System.IO.Path]::GetTempPath()
}
$WorkRoot = Join-Path $env:RUNNER_TEMP ("personal-ai-profile-smoke-" + [guid]::NewGuid().ToString("N"))
$InstallDir = Join-Path $WorkRoot "installed"
$VaultDir = Join-Path $WorkRoot "vault"
$RuntimeDir = Join-Path $WorkRoot "runtime"
$AppExe = Join-Path $InstallDir "personal-ai-profile.exe"
$RuntimeFile = Join-Path $RuntimeDir "runtime.json"
$LauncherError = Join-Path $RuntimeDir "launcher-error.log"
$AppProcess = $null
$Runtime = $null
$InstallSucceeded = $false
$TestSucceeded = $false

New-Item -ItemType Directory -Force -Path $WorkRoot, $VaultDir, $RuntimeDir | Out-Null

try {
    $InstallArgs = @(
        "/VERYSILENT",
        "/SUPPRESSMSGBOXES",
        "/NORESTART",
        "/DIR=`"$InstallDir`""
    )
    $InstallProcess = Start-Process -FilePath $Installer -ArgumentList $InstallArgs -Wait -PassThru
    if ($InstallProcess.ExitCode -ne 0) {
        throw "Installer exited with code $($InstallProcess.ExitCode)."
    }
    if (-not (Test-Path $AppExe)) {
        throw "Installed application was not found: $AppExe"
    }
    $InstallSucceeded = $true

    $AppArgs = @(
        "--vault", "`"$VaultDir`"",
        "--runtime-dir", "`"$RuntimeDir`"",
        "--no-browser"
    )
    $AppProcess = Start-Process -FilePath $AppExe -ArgumentList $AppArgs -PassThru -WindowStyle Hidden

    $Healthy = $false
    $Deadline = [DateTime]::UtcNow.AddSeconds(45)
    while ([DateTime]::UtcNow -lt $Deadline) {
        if ($AppProcess.HasExited) {
            throw "Packaged application exited early with code $($AppProcess.ExitCode)."
        }
        if (Test-Path $LauncherError) {
            throw "Packaged application failed to start: $(Get-Content -Raw $LauncherError)"
        }
        if (Test-Path $RuntimeFile) {
            try {
                $Runtime = Get-Content -Raw $RuntimeFile | ConvertFrom-Json
                if ($Runtime.port -and $Runtime.token) {
                    $Health = Invoke-RestMethod -Uri "http://127.0.0.1:$($Runtime.port)/api/v1/health" -TimeoutSec 3
                    if ($Health.data.status -eq "ok") {
                        $Healthy = $true
                        break
                    }
                }
            } catch {
                Start-Sleep -Seconds 1
            }
        } else {
            Start-Sleep -Seconds 1
        }
    }
    if (-not $Healthy) {
        throw "Packaged application did not report a healthy API within 45 seconds."
    }

    $Headers = @{ Authorization = "Bearer $($Runtime.token)" }
    $Clients = Invoke-RestMethod -Uri "http://127.0.0.1:$($Runtime.port)/api/v1/security/clients" -Headers $Headers -TimeoutSec 5
    if ($null -eq $Clients.data) {
        throw "The packaged app did not accept its runtime management token."
    }
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$($Runtime.port)/api/v1/shutdown" -Headers $Headers -TimeoutSec 5 | Out-Null
    if (-not $AppProcess.WaitForExit(15000)) {
        throw "Packaged application did not stop after the authenticated shutdown request."
    }
    $TestSucceeded = $true
    Write-Host "Windows installer smoke test passed: install, start, health check, authenticated shutdown."
} catch {
    Write-Host "Windows installer smoke test failed. Temporary diagnostics: $WorkRoot"
    if (Test-Path $LauncherError) {
        Write-Host (Get-Content -Raw $LauncherError)
    }
    throw
} finally {
    if ($AppProcess -and -not $AppProcess.HasExited) {
        if ($Runtime -and $Runtime.port -and $Runtime.token) {
            try {
                $Headers = @{ Authorization = "Bearer $($Runtime.token)" }
                Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$($Runtime.port)/api/v1/shutdown" -Headers $Headers -TimeoutSec 3 | Out-Null
                [void]$AppProcess.WaitForExit(5000)
            } catch {
                # Fall through to forceful cleanup below.
            }
        }
        if (-not $AppProcess.HasExited) {
            Stop-Process -Id $AppProcess.Id -Force -ErrorAction SilentlyContinue
            [void]$AppProcess.WaitForExit(5000)
        }
    }

    $Uninstaller = Join-Path $InstallDir "unins000.exe"
    if (Test-Path $Uninstaller) {
        $UninstallArgs = @("/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART")
        $UninstallProcess = Start-Process -FilePath $Uninstaller -ArgumentList $UninstallArgs -Wait -PassThru
        if ($UninstallProcess.ExitCode -ne 0) {
            throw "Uninstaller exited with code $($UninstallProcess.ExitCode)."
        }
    }
    if ($InstallSucceeded -and (Test-Path $InstallDir)) {
        throw "Uninstaller left the installation directory behind: $InstallDir"
    }
    if ($TestSucceeded) {
        Remove-Item -Path $WorkRoot -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "Windows installer smoke test passed: uninstall removed $InstallDir."
    }
}
