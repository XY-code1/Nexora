param(
    [string]$Version = "0.0.0-dev"
)
$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent

Set-Location $Root

Write-Host "==> Building React frontend"
Push-Location "$Root\apps\web"
npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE" }
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed with exit code $LASTEXITCODE" }
Pop-Location

Write-Host "==> Building backend with PyInstaller"
python -m PyInstaller --clean --noconfirm packaging\windows\personal-ai-profile.spec
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed with exit code $LASTEXITCODE" }
$AppExe = "$Root\dist\personal-ai-profile\personal-ai-profile.exe"
if (-not (Test-Path $AppExe)) { throw "PyInstaller did not produce $AppExe" }

function Get-Signtool {
    $cmd = Get-Command signtool -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $kits = "C:\Program Files (x86)\Windows Kits\10\bin"
    if (Test-Path $kits) {
        $dir = Get-ChildItem $kits -Directory | Sort-Object Name -Descending | Select-Object -First 1
        $candidate = Join-Path $dir.FullName "x64\signtool.exe"
        if (Test-Path $candidate) { return $candidate }
    }
    return $null
}

function Sign-File([string]$Path) {
    if (-not $env:SIGN_CERT_BASE64 -or -not $env:SIGN_CERT_PASSWORD) {
        Write-Host "==> No signing certificate configured; leaving $Path unsigned"
        return
    }
    $signtool = Get-Signtool
    if (-not $signtool) { throw "signtool not found and signing was requested" }
    $cert = Join-Path $env:RUNNER_TEMP "signing-cert.pfx"
    [IO.File]::WriteAllBytes($cert, [Convert]::FromBase64String($env:SIGN_CERT_BASE64))
    & $signtool sign /f $cert /p $env:SIGN_CERT_PASSWORD /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 $Path
    if ($LASTEXITCODE -ne 0) { throw "signtool failed for $Path" }
    Write-Host "==> Signed $Path"
}

Sign-File $AppExe

Write-Host "==> Compiling installer with Inno Setup"
$iscc = Get-Command iscc -ErrorAction SilentlyContinue
if ($iscc) {
    $iscc = $iscc.Source
} else {
    $candidates = @(
        "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        "C:\Program Files\Inno Setup 6\ISCC.exe",
        "C:\Program Files (x86)\Inno Setup 5\ISCC.exe"
    )
    $iscc = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $iscc) { throw "Inno Setup (iscc) not found. Install with: choco install innosetup" }
}
Write-Host "==> Using iscc: $iscc"
& $iscc "/DMyAppVersion=$Version" "packaging\windows\installer.iss"
if ($LASTEXITCODE -ne 0) { throw "Inno Setup compilation failed with exit code $LASTEXITCODE" }

$SetupExe = "$Root\artifacts\personal-ai-profile-setup-$Version.exe"
if (-not (Test-Path $SetupExe)) { throw "Inno Setup did not produce $SetupExe" }

Sign-File $SetupExe

Write-Host "==> Running release privacy gate"
python scripts\check_release.py
if ($LASTEXITCODE -ne 0) { throw "release privacy gate failed" }

Write-Host "==> Generating checksums"
python scripts\release_checksums.py $SetupExe --output artifacts\SHA256SUMS.txt
if ($LASTEXITCODE -ne 0) { throw "checksums failed with exit code $LASTEXITCODE" }

Write-Host "==> Done: $SetupExe"
