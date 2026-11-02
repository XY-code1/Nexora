"""Cross-device Git sync for the private Vault.

The public framework repository must never be touched by sync: all Git
operations target the private Vault's own repository.  Sync is deliberately
conservative — it refuses to overwrite uncommitted work and never auto-resolves
merge conflicts.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

from .vault_management import assert_vault_isolated, vault_operation_lock

_UNMERGED_CODES = {"DD", "AU", "UD", "UA", "DU", "AA", "UU"}


def _git(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True)


def _require_git_repo(root: Path) -> None:
    if not (root / ".git").exists():
        raise RuntimeError("私人Vault不是Git仓库；请先在Vault目录执行 git init 并配置私有远程。")


def _porcelain(root: Path) -> list[str]:
    result = _git(root, "status", "--porcelain")
    return [line for line in result.stdout.splitlines() if line.strip()]


def _unmerged(root: Path) -> list[str]:
    paths: list[str] = []
    for line in _porcelain(root):
        if line[:2] in _UNMERGED_CODES:
            paths.append(line[3:].strip())
    return paths


def _upstream_name(root: Path) -> str | None:
    result = _git(root, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")
    name = result.stdout.strip()
    return name if result.returncode == 0 and name else None


def _commit(root: Path, ref: str) -> str:
    result = _git(root, "rev-parse", ref)
    if result.returncode != 0:
        return ""
    return result.stdout.strip()


def _count(root: Path, rev_range: str) -> int:
    result = _git(root, "rev-list", "--count", rev_range)
    try:
        return int(result.stdout.strip() or 0)
    except ValueError:
        return 0


def _require_clean(root: Path) -> None:
    dirty = _porcelain(root)
    if dirty:
        raise RuntimeError(f"Vault有 {len(dirty)} 处未提交改动；请先执行 sync-commit 提交后再同步。")


def sync_status(vault: str) -> dict[str, object]:
    """Read-only diagnosis of the Vault's Git sync state."""
    root = Path(vault).expanduser().resolve()
    assert_vault_isolated(root)
    _require_git_repo(root)
    with vault_operation_lock(root):
        branch = _git(root, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
        head = _commit(root, "HEAD")
        upstream = _upstream_name(root)
        ahead = behind = 0
        if upstream:
            ahead = _count(root, "@{upstream}..HEAD")
            behind = _count(root, "HEAD..@{upstream}")
        return {
            "branch": branch,
            "head": head,
            "upstream": upstream,
            "ahead": ahead,
            "behind": behind,
            "dirty": _porcelain(root),
            "unmerged": _unmerged(root),
        }


def sync_commit(vault: str, message: str = "chore: local memory update") -> str:
    """Stage and commit every Vault change (respecting the Vault .gitignore)."""
    root = Path(vault).expanduser().resolve()
    assert_vault_isolated(root)
    _require_git_repo(root)
    with vault_operation_lock(root):
        _git(root, "add", "-A")
        result = _git(root, "commit", "-m", message)
        if result.returncode != 0:
            output = (result.stdout + result.stderr).strip()
            if "nothing to commit" in output or "nothing added to commit" in output:
                raise RuntimeError("没有可提交的改动。")
            raise RuntimeError(f"提交失败：{output}")
        return _commit(root, "HEAD")


def sync_pull(vault: str) -> dict[str, object]:
    """Fast-forward the Vault from its private remote; refuse on divergence."""
    root = Path(vault).expanduser().resolve()
    assert_vault_isolated(root)
    _require_git_repo(root)
    with vault_operation_lock(root):
        _require_clean(root)
        if not _upstream_name(root):
            raise RuntimeError("未配置远程跟踪分支；请先 git push -u origin 分支 或手动配置。")
        _git(root, "fetch", "--quiet")
        head = _commit(root, "HEAD")
        remote_head = _commit(root, "@{upstream}")
        if head == remote_head:
            return {"status": "up-to-date", "head": head}
        ancestor = _git(root, "merge-base", "--is-ancestor", "HEAD", "@{upstream}")
        if ancestor.returncode == 0:
            merged = _git(root, "merge", "--ff-only", "@{upstream}")
            if merged.returncode != 0:
                raise RuntimeError(f"拉取失败：{(merged.stdout + merged.stderr).strip()}")
            return {"status": "pulled", "head": _commit(root, "HEAD")}
        raise RuntimeError("本地与远端已分叉，自动合并有风险；请手动执行 git pull 并解决冲突后再继续。")


def sync_push(vault: str) -> dict[str, object]:
    """Push committed Vault changes to the private remote."""
    root = Path(vault).expanduser().resolve()
    assert_vault_isolated(root)
    _require_git_repo(root)
    with vault_operation_lock(root):
        _require_clean(root)
        if not _upstream_name(root):
            raise RuntimeError("未配置远程跟踪分支；请先 git push -u origin 分支 或手动配置。")
        _git(root, "fetch", "--quiet")
        if _count(root, "HEAD..@{upstream}"):
            raise RuntimeError("远端有新提交；请先执行 sync-pull 拉取后再推送。")
        result = _git(root, "push")
        if result.returncode != 0:
            raise RuntimeError(f"推送失败：{(result.stdout + result.stderr).strip()}")
        return {"status": "pushed", "head": _commit(root, "HEAD")}
