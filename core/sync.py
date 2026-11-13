"""Cross-device Git sync for the private Vault.

The public framework repository must never be touched by sync: all Git
operations target the private Vault's own repository.  Sync is deliberately
conservative — it refuses to overwrite uncommitted work and never auto-resolves
merge conflicts.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
import time
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

from . import vault_management
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


# Output fragments that indicate a transient transport failure rather than a
# real Git result. Only network-facing commands (fetch/push) are retried: a
# non-zero exit from a local operation is a result, not a hiccup.
_TRANSIENT_GIT_OUTPUT = (
    "could not resolve host",
    "connection refused",
    "connection reset",
    "could not read from remote repository",
    "network is unreachable",
    "remote end hung up",
    "rpc failed",
    "ssl connection",
    "temporary failure in name resolution",
    "timed out",
    "timeout",
    "unable to access",
)


def _git_remote(root: Path, *args: str, attempts: int = 3) -> subprocess.CompletedProcess[str]:
    """Run a network-facing git command, retrying transient transport failures."""
    result = _git(root, *args)
    for attempt in range(1, attempts):
        if result.returncode == 0:
            return result
        output = (result.stdout + result.stderr).lower()
        if not any(pattern in output for pattern in _TRANSIENT_GIT_OUTPUT):
            return result
        time.sleep(0.5 * (2 ** (attempt - 1)))
        result = _git(root, *args)
    return result


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
        result = _git(root, "remote", "set-url", remote_name, clean) if remote_name in _git(root, "remote").stdout.split() else _git(root, "remote", "add", remote_name, clean)
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


def git_history(vault: str, limit: int = 50) -> dict[str, object]:
    """Read-only commit history for the Vault's private Git repository."""
    root = Path(vault).expanduser().resolve()
    assert_vault_isolated(root)
    _require_git_repo(root)
    with vault_operation_lock(root):
        count = max(1, min(limit, 200))
        result = _git(root, "log", f"-n{count}", "--pretty=format:%H%x1f%cI%x1f%s%x1f%an")
        commits: list[dict[str, str]] = []
        for line in result.stdout.splitlines():
            if not line.strip():
                continue
            parts = line.split("\x1f")
            if len(parts) < 4:
                continue
            commits.append({
                "id": parts[0].strip(),
                "created": parts[1].strip(),
                "subject": parts[2].strip(),
                "author": parts[3].strip(),
            })
        branch = _git(root, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
        return {"branch": branch, "commits": commits}


def _export_tree(root: Path, commit: str, destination: Path) -> None:
    """Copy the tree at `commit` into `destination` using a scratch index."""
    index = destination.parent / "export.index"
    environment = {**os.environ, "GIT_INDEX_FILE": str(index)}
    read = subprocess.run(["git", "--git-dir", str(root / ".git"), "read-tree", commit], env=environment, capture_output=True, text=True)
    if read.returncode != 0:
        raise RuntimeError(f"读取提交树失败：{_redact((read.stdout + read.stderr).strip())}")
    try:
        write = subprocess.run(["git", "--git-dir", str(root / ".git"), "checkout-index", "-a", "-f", "--prefix", f"{destination}/"], env=environment, capture_output=True, text=True)
        if write.returncode != 0:
            raise RuntimeError(f"导出提交内容失败：{_redact((write.stdout + write.stderr).strip())}")
    finally:
        index.unlink(missing_ok=True)


def git_restore(vault: str, commit: str, expected_vault_revision: str) -> dict[str, object]:
    """Restore the Vault working tree from a Git commit.

    HEAD is not moved: the rollback shows up as uncommitted changes the user can
    review and commit. A managed safety backup is always taken first.
    """
    root = Path(vault).expanduser().resolve()
    assert_vault_isolated(root)
    _require_git_repo(root)
    with vault_operation_lock(root):
        _require_clean(root)
        if expected_vault_revision and vault_management._content_revision(root) != expected_vault_revision:
            raise RuntimeError("Vault已被其他入口修改，请刷新备份页面后重试。")
        resolved = _commit(root, commit)
        if not resolved:
            raise RuntimeError("未找到该提交。")
        safety = vault_management.create_managed_backup(root)
        with tempfile.TemporaryDirectory(prefix="git-restore-") as temporary:
            target = Path(temporary) / "snapshot"
            (target / "vault").mkdir(parents=True)
            _export_tree(root, resolved, target / "vault")
            files = vault_management._file_hashes(target / "vault")
            (target / "backup.json").write_text(json.dumps({
                "format": vault_management.BACKUP_FORMAT,
                "schema_version": vault_management.schema_version(root),
                "created": datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ"),
                "files": files,
                "vault_binding": vault_management._local_binding("managed-backup", root),
            }, ensure_ascii=False, indent=2), encoding="utf-8")
            vault_management.restore_backup(root, target)
        return {"restoredCommit": resolved, "safetyBackup": safety, "currentRevision": vault_management._content_revision(root)}


def sync_commit(vault: str, message: str = "chore: local memory update") -> str:
    """Stage and commit every Vault change (respecting the Vault .gitignore).

    A managed safety backup is taken first so the pre-commit state stays
    recoverable from the backup history.
    """
    root = Path(vault).expanduser().resolve()
    assert_vault_isolated(root)
    _require_git_repo(root)
    with vault_operation_lock(root):
        changes = _parse_porcelain(root)
        hits = _sensitive_hits(root, changes)
        if hits:
            raise RuntimeError("检测到疑似敏感文件，已拒绝提交：" + "、".join(item["path"] for item in hits))
        if not changes:
            raise RuntimeError("没有可提交的改动。")
        vault_management.create_managed_backup(root)
        _git(root, "add", "-A")
        result = _git(root, "commit", "-m", message)
        if result.returncode != 0:
            raise RuntimeError(f"提交失败：{(result.stdout + result.stderr).strip()}")
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
        _git_remote(root, "fetch", "--quiet")
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
        _git_remote(root, "fetch", "--quiet")
        if _count(root, "HEAD..@{upstream}"):
            raise RuntimeError("远端有新提交；请先执行 sync-pull 拉取后再推送。")
        result = _git_remote(root, "push")
        if result.returncode != 0:
            raise RuntimeError(f"推送失败：{(result.stdout + result.stderr).strip()}")
        return {"status": "pushed", "head": _commit(root, "HEAD")}
