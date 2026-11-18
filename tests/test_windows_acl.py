"""Real NTFS ACL regression coverage for sensitive local state."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT))

from core.windows_security import ensure_private_directory, ensure_private_tree, protect_private_path

if os.name != "nt":
    print("Windows ACL test skipped on non-Windows")
    raise SystemExit(0)


def powershell_json(script: str, path: Path) -> object:
    environment = os.environ.copy()
    environment["NEXORA_ACL_TEST_PATH"] = str(path)
    result = subprocess.run(
        ["pwsh", "-NoProfile", "-Command", script],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=environment,
    )
    return json.loads(result.stdout.lstrip("\ufeff"))


def allowed_sids(path: Path) -> set[str]:
    value = powershell_json(
        "$acl = Get-Acl -LiteralPath $env:NEXORA_ACL_TEST_PATH; "
        "@($acl.Access | Where-Object AccessControlType -eq Allow | "
        "ForEach-Object { $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value }) | "
        "ConvertTo-Json -Compress",
        path,
    )
    return {value} if isinstance(value, str) else set(value)


def acl_summary(path: Path) -> dict[str, object]:
    return dict(powershell_json(
        "$acl = Get-Acl -LiteralPath $env:NEXORA_ACL_TEST_PATH; "
        "[pscustomobject]@{ Protected=$acl.AreAccessRulesProtected; "
        "Owner=([System.Security.Principal.NTAccount]::new($acl.Owner)).Translate("
        "[System.Security.Principal.SecurityIdentifier]).Value } | "
        "ConvertTo-Json -Compress",
        path,
    ))


current_sid = str(powershell_json("[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value | ConvertTo-Json", Path(".")))
expected = {current_sid, "S-1-5-18", "S-1-5-32-544"}

with tempfile.TemporaryDirectory(prefix="nexora-acl-") as temporary:
    root = Path(temporary) / "private"
    root.mkdir()
    subprocess.run(["icacls", str(root), "/grant", "*S-1-1-0:(OI)(CI)(RX)"], check=True, capture_output=True)
    ensure_private_directory(root)
    assert allowed_sids(root) == expected
    assert acl_summary(root) == {"Protected": True, "Owner": current_sid}

    secret = root / "runtime.json"
    secret.write_text('{"token":"synthetic"}', encoding="utf-8")
    protect_private_path(secret)
    assert allowed_sids(secret) == expected
    assert acl_summary(secret) == {"Protected": True, "Owner": current_sid}

    legacy = Path(temporary) / "legacy-app-data"
    nested = legacy / "backups" / "snapshot"
    nested.mkdir(parents=True)
    old_secret = nested / "Profile.md"
    old_secret.write_text("synthetic legacy backup", encoding="utf-8")
    subprocess.run(
        ["icacls", str(legacy), "/grant", "*S-1-1-0:(OI)(CI)(RX)"],
        check=True,
        capture_output=True,
    )
    ensure_private_tree(legacy)
    for existing in (legacy, legacy / "backups", nested, old_secret):
        assert allowed_sids(existing) == expected
        assert acl_summary(existing) == {"Protected": True, "Owner": current_sid}

print("Windows private directory and file ACL tests passed")
