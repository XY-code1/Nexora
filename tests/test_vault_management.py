from __future__ import annotations

import json
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from core import vault_management as vm


def expect_failure(function, text: str) -> None:
    try:
        function()
    except RuntimeError as exc:
        assert text in str(exc), exc
    else:
        raise AssertionError(f"expected failure containing: {text}")


with tempfile.TemporaryDirectory() as temporary:
    base = Path(temporary)
    vault = base / "private-vault"
    shutil.copytree(Path(__file__).parents[1] / "template", vault)
    backups = base / "backups"

    assert vm.schema_version(vault) == 1
    assert vm.migrate_vault(vault, backups) is None

    config = vault / "profile.config.yml"
    config.write_text(config.read_text(encoding="utf-8").replace("schema_version: 1\n", ""), encoding="utf-8")
    backup = vm.migrate_vault(vault, backups)
    assert backup and backup.parent == backups
    assert vm.schema_version(vault) == 1
    assert not (backup / "vault" / ".git").exists()
    profile_file = vault / "10 Profile" / "Profile.md"
    original_profile = profile_file.read_text(encoding="utf-8")
    manual_backup = vm.create_backup(vault, backups)
    profile_file.write_text("changed", encoding="utf-8")
    vm.restore_backup(vault, manual_backup)
    assert profile_file.read_text(encoding="utf-8") == original_profile
    (manual_backup / "vault" / "10 Profile" / "Profile.md").write_text("tampered", encoding="utf-8")
    expect_failure(lambda: vm.restore_backup(vault, manual_backup), "哈希")
    assert profile_file.read_text(encoding="utf-8") == original_profile

    fake_backup = base / "fake-backup"
    (fake_backup / "vault").mkdir(parents=True)
    (fake_backup / "backup.json").write_text('{"format": 1, "schema_version": 1, "files": {}}', encoding="utf-8")
    expect_failure(lambda: vm.restore_backup(vault, fake_backup), "缺少Vault必需")
    assert profile_file.read_text(encoding="utf-8") == original_profile

    config.write_text(config.read_text(encoding="utf-8").replace("schema_version: 1", "schema_version: 9"), encoding="utf-8")
    expect_failure(lambda: vm.migrate_vault(vault, backups), "高于当前支持")
    config.write_text(config.read_text(encoding="utf-8").replace("schema_version: 9", "schema_version: 1"), encoding="utf-8")

    before = config.read_text(encoding="utf-8")
    config.write_text(before.replace("schema_version: 1\n", ""), encoding="utf-8")
    original = vm.MIGRATIONS[0]
    def broken_migration(root: Path) -> None:
        (root / "partial.txt").write_text("partial", encoding="utf-8")
        raise RuntimeError("injected migration failure")
    vm.MIGRATIONS[0] = broken_migration
    try:
        expect_failure(lambda: vm.migrate_vault(vault, backups), "injected")
    finally:
        vm.MIGRATIONS[0] = original
    assert not (vault / "partial.txt").exists()
    assert "schema_version:" not in config.read_text(encoding="utf-8")
    def silently_corrupting_migration(root: Path) -> None:
        original(root)
        (root / "AGENTS.md").unlink()
    vm.MIGRATIONS[0] = silently_corrupting_migration
    try:
        expect_failure(lambda: vm.migrate_vault(vault, backups), "迁移后Vault缺少")
    finally:
        vm.MIGRATIONS[0] = original
    assert (vault / "AGENTS.md").is_file()
    assert "schema_version:" not in config.read_text(encoding="utf-8")
    invalid_memory = vault / "30 Memory" / "Inbox" / "invalid.md"
    invalid_memory.write_text("---\nstatus: candidate\n---\n\nmissing id\n", encoding="utf-8")
    expect_failure(lambda: vm.migrate_vault(vault, backups), "记忆必需字段无效")
    assert "schema_version:" not in config.read_text(encoding="utf-8")
    invalid_memory.unlink()
    vm.migrate_vault(vault, backups)

    good_backup = vm.create_backup(vault, backups)
    rogue_workspace = base / ".private-vault-restore-work"
    rogue_workspace.mkdir()
    (rogue_workspace / "KEEP.txt").write_text("keep", encoding="utf-8")
    expect_failure(lambda: vm.restore_backup(vault, good_backup), "工作目录已存在")
    assert (rogue_workspace / "KEEP.txt").read_text(encoding="utf-8") == "keep"
    shutil.rmtree(rogue_workspace)

    public = vault / "10 Profile" / "Public.md"
    public.write_text("---\nvisibility: public\n---\n\n# Public\n\nHello\n", encoding="utf-8")
    private = vault / "10 Profile" / "Private.md"
    private.write_text("---\nvisibility: private\n---\n\nPrivate\n", encoding="utf-8")
    staging = base / "public-staging"
    exported = vm.stage_public_export(vault, ["10 Profile/Public.md"], staging)
    assert len(exported) == 1 and exported[0].is_file()
    marker_text = (staging / ".personal-ai-profile-export.json").read_text(encoding="utf-8")
    assert str(vault) not in marker_text and str(staging) not in marker_text and str(base) not in marker_text
    orphan_output = base / "orphan-export"
    orphan_workspace = base / ".orphan-export-export-work"
    (orphan_workspace / "candidate").mkdir(parents=True)
    orphan_journal = base / ".orphan-export-export.json"
    orphan_journal.write_text(json.dumps({"format": 1, "target": str(orphan_output)}), encoding="utf-8")
    vm.stage_public_export(vault, ["10 Profile/Public.md"], orphan_output)
    assert orphan_output.is_dir() and not orphan_workspace.exists() and not orphan_journal.exists()
    unrelated = base / "unrelated"
    unrelated.mkdir()
    (unrelated / "keep.txt").write_text("keep", encoding="utf-8")
    expect_failure(lambda: vm.stage_public_export(vault, ["10 Profile/Public.md"], unrelated), "不属于")
    assert (unrelated / "keep.txt").read_text(encoding="utf-8") == "keep"
    fake_owned = base / "fake-owned"
    fake_owned.mkdir()
    (fake_owned / ".personal-ai-profile-export.json").write_text("{}", encoding="utf-8")
    (fake_owned / "KEEP.txt").write_text("keep", encoding="utf-8")
    expect_failure(lambda: vm.stage_public_export(vault, ["10 Profile/Public.md"], fake_owned), "marker")
    assert (fake_owned / "KEEP.txt").read_text(encoding="utf-8") == "keep"
    expect_failure(lambda: vm.stage_public_export(vault, ["10 Profile/Private.md"], staging), "未显式标记")
    expect_failure(lambda: vm.stage_public_export(vault, ["10 Profile/Public.md"], base), "staging")
    assert vault.is_dir()
    expect_failure(lambda: vm.stage_public_export(vault, ["10 Profile/Public.md"], Path(__file__).parents[1] / "public-staging"), "staging")
    public.write_text("---\nvisibility: public\n---\n\napi_key: abcdefghijklmnop\n", encoding="utf-8")
    expect_failure(lambda: vm.stage_public_export(vault, ["10 Profile/Public.md"], staging), "敏感信息")

    report = vm.preview_public_export(vault, ["10 Profile/Public.md"])
    assert report["files"][0]["publishable"] is False
    assert report["files"][0]["secret_matches"]
    assert "已脱敏" in report["files"][0]["redacted_preview"]
    assert "abcdefghijklmnop" not in report["files"][0]["redacted_preview"]

    public.write_text("---\nvisibility: public\n---\n\n# Public\n\nHello world\n", encoding="utf-8")
    report = vm.preview_public_export(vault, ["10 Profile/Public.md"])
    assert report["files"][0]["publishable"] is True
    assert report["files"][0]["secret_matches"] == []
    assert "Hello world" in report["files"][0]["redacted_preview"]

    report = vm.preview_public_export(vault, ["10 Profile/Private.md"])
    assert report["files"][0]["publishable"] is False
    assert any("visibility" in reason for reason in report["files"][0]["reasons"])

    report = vm.preview_public_export(vault, ["../escape.md"])
    assert report["files"][0]["publishable"] is False

    fake_framework = base / "public-framework"
    embedded = fake_framework / "private-vault"
    embedded.mkdir(parents=True)
    expect_failure(lambda: vm.assert_vault_isolated(embedded, fake_framework), "不能相互包含")
    expect_failure(lambda: vm.assert_vault_isolated(fake_framework, embedded), "不能相互包含")
    expect_failure(lambda: vm.assert_vault_isolated(Path(__file__).parents[1] / "template"), "不能相互包含")

print("vault migration, backup, isolation, and public export tests passed")
