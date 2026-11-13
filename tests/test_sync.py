from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from core import sync as sync_mod


def git(cwd: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True)


def expect_failure(function, text: str) -> None:
    try:
        function()
    except RuntimeError as exc:
        assert text in str(exc), exc
    else:
        raise AssertionError(f"expected failure containing: {text}")


with tempfile.TemporaryDirectory() as temporary:
    base = Path(temporary)
    remote = base / "remote.git"
    subprocess.run(["git", "init", "--bare", "-b", "main", str(remote)], capture_output=True, text=True, check=True)

    template = Path(__file__).parents[1] / "template"
    vault = base / "vault"
    shutil.copytree(template, vault)
    git(vault, "init", "-b", "main")
    git(vault, "config", "user.email", "a@example.com")
    git(vault, "config", "user.name", "A")
    git(vault, "remote", "add", "origin", str(remote))
    git(vault, "add", "-A")
    git(vault, "commit", "-m", "init")
    git(vault, "push", "-u", "origin", "main")

    expect_failure(lambda: sync_mod.sync_status(str(base)), "不是Git仓库")

    info = sync_mod.sync_status(str(vault))
    assert info["upstream"] == "origin/main", info
    assert info["ahead"] == 0 and info["behind"] == 0, info
    assert info["dirty"] == [] and info["unmerged"] == [], info

    (vault / "10 Profile" / "Profile.md").write_text("changed\n", encoding="utf-8")
    head = sync_mod.sync_commit(str(vault), "test change")
    assert head
    info = sync_mod.sync_status(str(vault))
    assert info["ahead"] == 1 and info["dirty"] == [], info

    expect_failure(lambda: sync_mod.sync_commit(str(vault), "empty"), "没有可提交")
    assert sync_mod.sync_push(str(vault))["status"] == "pushed"

    (vault / "10 Profile" / "Profile.md").write_text("dirty\n", encoding="utf-8")
    expect_failure(lambda: sync_mod.sync_pull(str(vault)), "未提交改动")
    expect_failure(lambda: sync_mod.sync_push(str(vault)), "未提交改动")
    git(vault, "checkout", "--", ".")
    git(vault, "clean", "-fd")

    vault_b = base / "vault-b"
    subprocess.run(["git", "clone", str(remote), str(vault_b)], capture_output=True, text=True, check=True)
    git(vault_b, "config", "user.email", "b@example.com")
    git(vault_b, "config", "user.name", "B")
    (vault_b / "10 Profile" / "Profile.md").write_text("from-b\n", encoding="utf-8")
    git(vault_b, "add", "-A")
    git(vault_b, "commit", "-m", "b change")
    git(vault_b, "push")

    (vault / "10 Profile" / "Profile.md").write_text("from-a\n", encoding="utf-8")
    sync_mod.sync_commit(str(vault), "a change")
    expect_failure(lambda: sync_mod.sync_pull(str(vault)), "分叉")
    expect_failure(lambda: sync_mod.sync_push(str(vault)), "请先执行 sync-pull")

    vault_c = base / "vault-c"
    subprocess.run(["git", "clone", str(remote), str(vault_c)], capture_output=True, text=True, check=True)
    git(vault_c, "config", "user.email", "c@example.com")
    git(vault_c, "config", "user.name", "C")
    (vault_b / "10 Profile" / "Profile.md").write_text("from-b-2\n", encoding="utf-8")
    git(vault_b, "add", "-A")
    git(vault_b, "commit", "-m", "b change 2")
    git(vault_b, "push")
    result = sync_mod.sync_pull(str(vault_c))
    assert result["status"] == "pulled", result
    assert (vault_c / "10 Profile" / "Profile.md").read_text(encoding="utf-8") == "from-b-2\n"

    # Git 历史：只读提交列表，不改动工作区。
    history = sync_mod.git_history(str(vault))
    assert history["branch"] == "main", history
    assert len(history["commits"]) >= 1, history
    for item in history["commits"]:
        assert {"id", "created", "subject", "author"} <= set(item), item
    expect_failure(lambda: sync_mod.git_history(str(base)), "不是Git仓库")

    # 变更预览：干净 Vault 没有待提交内容
    preview = sync_mod.git_changes(str(vault))
    assert preview["changes"] == [] and preview["sensitive"] == [], preview
    assert preview["can_commit"] is True, preview

    # 未跟踪文件会出现在预览中，且不影响提交
    (vault / "30 Memory/Inbox" / "new-note.md").write_text("hello\n", encoding="utf-8")
    preview = sync_mod.git_changes(str(vault))
    assert [item["path"] for item in preview["changes"]] == ["30 Memory/Inbox/new-note.md"], preview
    assert preview["changes"][0]["status"] == "untracked", preview
    assert preview["can_commit"] is True, preview
    (vault / "30 Memory/Inbox" / "new-note.md").unlink()

    # 敏感文件名：预览告警并 fail closed
    (vault / "id_rsa").write_text("private\n", encoding="utf-8")
    preview = sync_mod.git_changes(str(vault))
    assert [item["path"] for item in preview["sensitive"]] == ["id_rsa"], preview
    assert preview["can_commit"] is False, preview
    expect_failure(lambda: sync_mod.sync_commit(str(vault), "with secret file"), "敏感")
    (vault / "id_rsa").unlink()

    # 敏感内容：预览告警并 fail closed
    key_file = vault / "30 Memory/Inbox" / "leaked.txt"
    # Assemble a synthetic PEM marker at runtime; no key material is checked in.
    key_type = "RSA PRIVATE KEY"
    key_file.write_text(f"-----BEGIN {key_type}-----\nsynthetic-test-data\n-----END {key_type}-----\n", encoding="utf-8")
    preview = sync_mod.git_changes(str(vault))
    assert [item["path"] for item in preview["sensitive"]] == ["30 Memory/Inbox/leaked.txt"], preview
    expect_failure(lambda: sync_mod.sync_commit(str(vault), "with secret content"), "敏感")
    key_file.unlink()

    # 清理后恢复可用
    preview = sync_mod.git_changes(str(vault))
    assert preview["changes"] == [] and preview["can_commit"] is True, preview

    # Git 历史：只读提交列表，不改动工作区。
    history = sync_mod.git_history(str(vault))
    assert history["branch"] == "main", history
    assert len(history["commits"]) >= 1, history
    for item in history["commits"]:
        assert {"id", "created", "subject", "author"} <= set(item), item
    expect_failure(lambda: sync_mod.git_history(str(base)), "不是Git仓库")

    # 从 Git 历史恢复：先创建安全备份，工作区回退，HEAD 不变。
    from core import vault_management
    oldest = history["commits"][-1]["id"]
    status = sync_mod.sync_status(str(vault))
    expected_revision = vault_management._content_revision(vault)
    # 未找到的提交会被拒绝（在干净状态下检查）。
    expect_failure(lambda: sync_mod.git_restore(str(vault), "deadbeef" * 8, expected_revision), "未找到该提交")
    result = sync_mod.git_restore(str(vault), oldest, expected_revision)
    assert result["restoredCommit"] == oldest, result
    assert result["safetyBackup"]["integrity"] == "verified", result
    assert sync_mod.sync_status(str(vault))["head"] == status["head"], "HEAD 不应移动"
    assert vault_management._content_revision(vault) != expected_revision, "工作区内容应已回退"

    # sync_commit 在提交前创建 managed 安全备份；无改动时不创建。
    backups_before = len(vault_management._managed_backup_dirs(vault))
    (vault / "10 Profile" / "Profile.md").write_text("after-restore\n", encoding="utf-8")
    sync_mod.sync_commit(str(vault), "backup check")
    assert len(vault_management._managed_backup_dirs(vault)) == backups_before + 1
    expect_failure(lambda: sync_mod.sync_commit(str(vault), "empty"), "没有可提交")
    assert len(vault_management._managed_backup_dirs(vault)) == backups_before + 1


def test_git_remote_retry() -> None:
    """_git_remote retries transient transport failures, not real Git errors."""
    from unittest.mock import patch

    attempts = {"count": 0}

    def flaky(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
        attempts["count"] += 1
        if attempts["count"] < 3:
            return subprocess.CompletedProcess(["git"], 1, "", "fatal: unable to access 'https://example.com': Could not resolve host: example.com")
        return subprocess.CompletedProcess(["git"], 0, "ok", "")

    with tempfile.TemporaryDirectory() as tmp, patch.object(sync_mod, "_git", flaky):
        result = sync_mod._git_remote(Path(tmp), "fetch", "--quiet")
    assert result.returncode == 0, result
    assert attempts["count"] == 3, attempts

    attempts["count"] = 0

    def real_failure(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
        attempts["count"] += 1
        return subprocess.CompletedProcess(["git"], 1, "", "fatal: not a git repository")

    with tempfile.TemporaryDirectory() as tmp, patch.object(sync_mod, "_git", real_failure):
        result = sync_mod._git_remote(Path(tmp), "fetch", "--quiet")
    assert result.returncode == 1, result
    assert attempts["count"] == 1, attempts


test_git_remote_retry()

print("cross-device sync tests passed")
