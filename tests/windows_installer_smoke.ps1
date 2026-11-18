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

function Assert-PrivateAcl([string]$Path) {
    $Acl = Get-Acl -LiteralPath $Path
    if (-not $Acl.AreAccessRulesProtected) {
        throw "Sensitive path still inherits its parent ACL: $Path"
    }
    $Allowed = @(
        [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value,
        "S-1-5-18",
        "S-1-5-32-544"
    )
    foreach ($Rule in $Acl.Access | Where-Object AccessControlType -eq Allow) {
        $Sid = $Rule.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value
        if ($Sid -notin $Allowed) { throw "Unexpected ACL principal $Sid on $Path" }
    }
}

function Wait-ForRuntime([System.Diagnostics.Process]$Process, [string]$Path) {
    $Deadline = [DateTime]::UtcNow.AddSeconds(45)
    while ([DateTime]::UtcNow -lt $Deadline) {
        if ($Process.HasExited) { throw "Packaged application exited early with code $($Process.ExitCode)." }
        if (Test-Path $LauncherError) { throw "Packaged application failed to start: $(Get-Content -Raw $LauncherError)" }
        if (Test-Path $Path) {
            try {
                $Value = Get-Content -Raw $Path | ConvertFrom-Json
                if ($Value.port -and $Value.token) {
                    $Health = Invoke-RestMethod -Uri "http://127.0.0.1:$($Value.port)/api/v1/health" -TimeoutSec 3
                    if ($Health.data.status -eq "ok") { return $Value }
                }
            } catch { Start-Sleep -Seconds 1 }
        } else { Start-Sleep -Seconds 1 }
    }
    throw "Packaged application did not report a healthy API within 45 seconds."
}

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

    $Runtime = Wait-ForRuntime $AppProcess $RuntimeFile
    $OldToken = $Runtime.token
    $VaultIdentity = (Get-Content -Raw (Join-Path $VaultDir "90 System\vault.json") | ConvertFrom-Json).vault_id
    Assert-PrivateAcl $RuntimeDir
    Assert-PrivateAcl $RuntimeFile
    Assert-PrivateAcl (Join-Path $env:LOCALAPPDATA "PersonalAIProfile")

    $Headers = @{ Authorization = "Bearer $($Runtime.token)" }
    $Clients = Invoke-RestMethod -Uri "http://127.0.0.1:$($Runtime.port)/api/v1/security/clients" -Headers $Headers -TimeoutSec 5
    if ($null -eq $Clients.data) {
        throw "The packaged app did not accept its runtime management token."
    }
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$($Runtime.port)/api/v1/shutdown" -Headers $Headers -TimeoutSec 5 | Out-Null
    if (-not $AppProcess.WaitForExit(15000)) {
        throw "Packaged application did not stop after the authenticated shutdown request."
    }

    $AppProcess = Start-Process -FilePath $AppExe -ArgumentList $AppArgs -PassThru -WindowStyle Hidden
    $Runtime = Wait-ForRuntime $AppProcess $RuntimeFile
    if ($Runtime.token -eq $OldToken) { throw "Restart reused the previous runtime token." }
    if ((Get-Content -Raw (Join-Path $VaultDir "90 System\vault.json") | ConvertFrom-Json).vault_id -ne $VaultIdentity) {
        throw "Restart changed the synthetic Vault identity."
    }
    try {
        Invoke-RestMethod -Uri "http://127.0.0.1:$($Runtime.port)/api/v1/vault" -Headers @{ Authorization = "Bearer $OldToken" } -TimeoutSec 5 | Out-Null
        throw "The previous runtime token remained valid after restart."
    } catch {
        if ($_.Exception.Response.StatusCode.value__ -ne 401) { throw }
    }
    $Headers = @{ Authorization = "Bearer $($Runtime.token)" }
    Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$($Runtime.port)/api/v1/shutdown" -Headers $Headers -TimeoutSec 5 | Out-Null
    if (-not $AppProcess.WaitForExit(15000)) { throw "Restarted application did not stop in time." }
    $TestSucceeded = $true
    Write-Host "Windows installer smoke passed: install, private ACL, restart, token rotation, and shutdown."
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
    if ($InstallSucceeded -and -not (Test-Path (Join-Path $VaultDir "90 System\vault.json"))) {
        throw "Uninstaller removed the external synthetic Vault."
    }
    if ($TestSucceeded) {
        Remove-Item -Path $WorkRoot -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "Windows installer smoke test passed: uninstall removed $InstallDir."
    }
}
