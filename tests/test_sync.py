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

print("cross-device sync tests passed")
