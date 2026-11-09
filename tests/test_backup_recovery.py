"""Managed backup/recovery API and boundary acceptance tests."""

import json
import sys
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parents[1]))

from apps.api import create_app
from core import profile, vault_management as vm


def test_interrupted_swap_recovery() -> None:
    with tempfile.TemporaryDirectory() as temporary:
        base = Path(temporary)
        vault = base / "vault"
        workspace = base / ".vault-restore-work"
        journal = base / ".vault-restore.json"
        vault.mkdir()
        (vault / "state.txt").write_text("before interruption", encoding="utf-8")
        workspace.mkdir()
        vault.replace(workspace / "previous")
        (workspace / "candidate").mkdir()
        journal.write_text(json.dumps({"format": 1, "target": str(vault)}), encoding="utf-8")

        vm.recover_vault_swap(vault)

        assert (vault / "state.txt").read_text(encoding="utf-8") == "before interruption"
        assert not workspace.exists() and not journal.exists()

        workspace.mkdir()
        (workspace / "previous").mkdir()
        (workspace / "previous" / "state.txt").write_text("previous state", encoding="utf-8")
        (vault / "state.txt").write_text("restored candidate", encoding="utf-8")
        journal.write_text(json.dumps({"format": 1, "target": str(vault)}), encoding="utf-8")

        vm.recover_vault_swap(vault)

        assert (vault / "state.txt").read_text(encoding="utf-8") == "restored candidate"
        assert not workspace.exists() and not journal.exists()


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        vault = base / "vault"
        backups = base / "managed-backups"
        profile.init(str(vault))
        original_backup_root = vm.backup_root
        vm.backup_root = lambda: backups
        try:
            api = TestClient(create_app(vault, token="backup-token"), base_url="http://localhost")
            headers = {"Authorization": "Bearer backup-token"}
            for method, url, body in [
                ("GET", "/api/v1/backups", None),
                ("POST", "/api/v1/backups", None),
                ("GET", "/api/v1/backups/example/verify", None),
                ("POST", "/api/v1/backups/example/restore", {"confirmation": "x", "expected_vault_revision": "0" * 64}),
            ]:
                assert api.request(method, url, json=body).status_code == 401

            profile_file = vault / "10 Profile" / "Profile.md"
            profile_file.write_text("original snapshot\n", encoding="utf-8")
            initial = api.get("/api/v1/backups", headers=headers).json()["data"]
            assert initial["backups"] == [] and len(initial["currentRevision"]) == 64

            created_response = api.post("/api/v1/backups", headers=headers)
            assert created_response.status_code == 201
            created = created_response.json()["data"]["backup"]
            assert created["integrity"] == "verified" and created["managed"] is True and created["fileCount"] > 0
            assert "path" not in str(created).lower() and str(vault) not in str(created)

            verified = api.get(f"/api/v1/backups/{created['id']}/verify", headers=headers)
            assert verified.status_code == 200 and verified.json()["data"]["id"] == created["id"]

            profile_file.write_text("changed after backup\n", encoding="utf-8")
            stale = api.post(
                f"/api/v1/backups/{created['id']}/restore",
                headers=headers,
                json={"confirmation": f"RESTORE {created['id']}", "expected_vault_revision": initial["currentRevision"]},
            )
            assert stale.status_code == 409 and profile_file.read_text(encoding="utf-8") == "changed after backup\n"

            preserved_files = {
                ".env": "local environment\n",
                ".git/config": "local repository metadata\n",
                "private/client.key": "private key\n",
                "private/client.pem": "certificate\n",
            }
            for relative, contents in preserved_files.items():
                local_file = vault / relative
                local_file.parent.mkdir(parents=True, exist_ok=True)
                local_file.write_text(contents, encoding="utf-8")
            local_only = vault / "created-after-backup.txt"
            local_only.write_text("remove on restore\n", encoding="utf-8")
            for runtime_name in ("Locks", "Transactions"):
                runtime = vault / "90 System" / runtime_name
                runtime.mkdir(parents=True, exist_ok=True)
                (runtime / "runtime.tmp").write_text("do not resurrect\n", encoding="utf-8")

            current = api.get("/api/v1/backups", headers=headers).json()["data"]
            wrong_phrase = api.post(
                f"/api/v1/backups/{created['id']}/restore",
                headers=headers,
                json={"confirmation": "RESTORE WRONG", "expected_vault_revision": current["currentRevision"]},
            )
            assert wrong_phrase.status_code == 400
            restored = api.post(
                f"/api/v1/backups/{created['id']}/restore",
                headers=headers,
                json={"confirmation": f"RESTORE {created['id']}", "expected_vault_revision": current["currentRevision"]},
            )
            assert restored.status_code == 200
            result = restored.json()["data"]
            assert profile_file.read_text(encoding="utf-8") == "original snapshot\n"
            assert result["safetyBackup"]["id"] != created["id"] and result["safetyBackup"]["integrity"] == "verified"
            assert str(vault) not in str(result)
            for relative, contents in preserved_files.items():
                assert (vault / relative).read_text(encoding="utf-8") == contents
                assert not (backups / result["safetyBackup"]["id"] / "vault" / relative).exists()
            assert not local_only.exists()
            assert not (vault / "90 System" / "Locks").exists()
            assert not (vault / "90 System" / "Transactions").exists()
            post_restore = api.get("/api/v1/backups", headers=headers).json()["data"]
            assert result["currentRevision"] == post_restore["currentRevision"]

            # A backup is bound to one Vault and cannot be selected by another.
            other = base / "other-vault"
            profile.init(str(other))
            try:
                vm.verify_managed_backup(other, created["id"])
                raise AssertionError("cross-vault backup was accepted")
            except RuntimeError as exc:
                assert "不属于当前Vault" in str(exc)

            # Tampering is detected before restore.
            (backups / created["id"] / "vault" / "10 Profile" / "Profile.md").write_text("tampered", encoding="utf-8")
            invalid = api.get(f"/api/v1/backups/{created['id']}/verify", headers=headers)
            assert invalid.status_code == 400 and invalid.json()["error"]["code"] == "BACKUP_INVALID"
            listed_invalid = api.get("/api/v1/backups", headers=headers).json()["data"]["backups"]
            assert next(item for item in listed_invalid if item["id"] == created["id"])["integrity"] == "invalid"
        finally:
            vm.backup_root = original_backup_root

    test_interrupted_swap_recovery()
    print("managed backup, verification, safety snapshot, restore, and isolation tests passed")


if __name__ == "__main__":
    main()
