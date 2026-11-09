"""Cross-device Git sync for the private Vault.

The public framework repository must never be touched by sync: all Git
operations target the private Vault's own repository.  Sync is deliberately
conservative — it refuses to overwrite uncommitted work and never auto-resolves
merge conflicts.
"""

from __future__ import annotations

import re
import subprocess
import urllib.parse
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


def _redact(message: str) -> str:
    return re.sub(r"(https?://)[^/@\s]+@", r"\1[redacted]@", message)


def _describe_remote(url: str) -> dict[str, str]:
    """Return a credential-free description of a remote URL."""
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme in {"http", "https"}:
        host = parsed.netloc.split("@")[-1]
        return {"url": f"{parsed.scheme}://{host}{parsed.path}", "host": host, "path": parsed.path}
    if ":" in url:
        host, _, path = url.partition(":")
        return {"url": f"{host.split('@')[-1]}:{path}", "host": host.split("@")[-1], "path": path}
    return {"url": url, "host": "", "path": url}


def configure_remote(vault: str, url: str, remote_name: str = "origin") -> dict[str, object]:
    """Point a remote at a verified URL, without embedding credentials."""
    root = Path(vault).expanduser().resolve()
    assert_vault_isolated(root)
    _require_git_repo(root)
    clean = url.strip()
    if not clean or ("://" not in clean and ":" not in clean):
        raise RuntimeError("远程 URL 无效。")
    with vault_operation_lock(root):
        if remote_name in _git(root, "remote").stdout.split():
            result = _git(root, "remote", "set-url", remote_name, clean)
        else:
            result = _git(root, "remote", "add", remote_name, clean)
        if result.returncode != 0:
            raise RuntimeError(f"配置远程失败：{_redact((result.stdout + result.stderr).strip())}")
        described = _describe_remote(clean)
        return {"remote": described, "host": described["host"], "branch": _git(root, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip()}


def remove_remote(vault: str, remote_name: str = "origin") -> dict[str, object]:
    root = Path(vault).expanduser().resolve()
    assert_vault_isolated(root)
    _require_git_repo(root)
    with vault_operation_lock(root):
        result = _git(root, "remote", "remove", remote_name)
        if result.returncode != 0:
            raise RuntimeError(f"移除远程失败：{_redact((result.stdout + result.stderr).strip())}")
        return {"removed": remote_name}


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
