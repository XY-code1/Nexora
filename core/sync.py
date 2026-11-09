"""Cross-device Git sync for the private Vault.

The public framework repository must never be touched by sync: all Git
operations target the private Vault's own repository.  Sync is deliberately
conservative — it refuses to overwrite uncommitted work and never auto-resolves
merge conflicts.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

from .vault_management import assert_vault_isolated, vault_operation_lock

_UNMERGED_CODES = {"DD", "AU", "UD", "UA", "DU", "AA", "UU"}

# Fail-closed guard for Git commits: these names, suffixes and content patterns
# indicate likely credentials. The scan never returns file content.
_SENSITIVE_NAMES = {".env", ".npmrc", ".netrc", ".pypirc", "id_rsa", "id_ed25519", "id_ecdsa", "id_dsa"}
_SENSITIVE_SUFFIXES = (".key", ".pem", ".p12", ".pfx", ".pkcs12", ".keystore", ".jks")
_SENSITIVE_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----"), "private key"),
    (re.compile(r"\bghp_[A-Za-z0-9]{36}\b"), "GitHub token"),
    (re.compile(r"\bgithub_pat_[A-Za-z0-9_]{22,}\b"), "GitHub fine-grained token"),
    (re.compile(r"\bghs_[A-Za-z0-9]{36}\b"), "GitHub Actions token"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "AWS access key"),
    (re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"), "Slack token"),
    (re.compile(r"\bnpm_[A-Za-z0-9]{36}\b"), "npm token"),
    (re.compile(r"\bsk-[A-Za-z0-9]{20,}\b"), "API key"),
)
_STATUS_LABELS = {"A": "added", "M": "modified", "D": "deleted", "R": "renamed", "C": "copied", "U": "unmerged"}


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


def _status_label(code: str) -> str:
    if code == "??":
        return "untracked"
    for char in code:
        if char != " ":
            return _STATUS_LABELS.get(char, char.lower())
    return "unknown"


def _parse_porcelain(root: Path) -> list[dict[str, str]]:
    changes: list[dict[str, str]] = []
    for line in _porcelain(root):
        if len(line) < 4:
            continue
        code = line[:2]
        path = line[3:].strip().strip('"')
        if " -> " in path:
            path = path.split(" -> ", 1)[1].strip().strip('"')
        changes.append({"path": path, "status": _status_label(code), "code": code})
    return changes


def _sensitive_hits(root: Path, changes: list[dict[str, str]]) -> list[dict[str, str]]:
    """Report likely credentials among pending changes without echoing content."""
    hits: list[dict[str, str]] = []
    for change in changes:
        path = change["path"]
        name = Path(path).name.lower()
        if name in _SENSITIVE_NAMES or name.endswith(_SENSITIVE_SUFFIXES):
            hits.append({"path": path, "reason": "sensitive file name"})
            continue
        if change["status"] == "deleted":
            continue
        candidate = root / path
        try:
            if not candidate.is_file() or candidate.stat().st_size > 1_000_000:
                continue
            text = candidate.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for pattern, reason in _SENSITIVE_PATTERNS:
            if pattern.search(text):
                hits.append({"path": path, "reason": reason})
                break
    return hits


def git_changes(vault: str) -> dict[str, object]:
    """Read-only preview of pending Vault changes and likely secrets."""
    root = Path(vault).expanduser().resolve()
    assert_vault_isolated(root)
    _require_git_repo(root)
    with vault_operation_lock(root):
        changes = _parse_porcelain(root)
        sensitive = _sensitive_hits(root, changes)
        unmerged = [item["path"] for item in changes if item["status"] == "unmerged"]
        return {
            "changes": changes,
            "sensitive": sensitive,
            "unmerged": unmerged,
            "can_commit": not sensitive and not unmerged,
        }


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
        hits = _sensitive_hits(root, _parse_porcelain(root))
        if hits:
            raise RuntimeError("检测到疑似敏感文件，已拒绝提交：" + "、".join(item["path"] for item in hits))
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
