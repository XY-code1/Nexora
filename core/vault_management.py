"""Vault isolation, schema migration, backup, restore, and public export."""

from __future__ import annotations

import json
import hashlib
import hmac
import os
import re
import shutil
import stat
import tempfile
import threading
import secrets
from datetime import datetime, timezone
from pathlib import Path

from filelock import FileLock

from .profile import FOLDER_STATUSES, MEMORY_ROOT, REQUIRED, ROOT, SECRET_PATTERNS, VALID_STATUSES, atomic_write, parse_record

CURRENT_SCHEMA_VERSION = 1
CONFIG = "profile.config.yml"
_LOCKS: dict[str, FileLock] = {}
_LOCKS_GUARD = threading.Lock()


def _inside(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def assert_vault_isolated(vault: Path, framework_root: Path = ROOT) -> None:
    """Reject a private Vault located inside the public framework checkout."""
    root = vault.expanduser().resolve()
    framework = framework_root.resolve()
    if _inside(root, framework) or _inside(framework, root):
        raise RuntimeError("私人Vault与公共框架仓库不能相互包含；请选择完全分离的目录。")


def schema_version(vault: Path) -> int:
    config = vault / CONFIG
    if not config.is_file():
        return 0
    match = re.search(r"(?m)^schema_version:\s*(\d+)\s*$", config.read_text(encoding="utf-8"))
    return int(match.group(1)) if match else 0


def backup_root() -> Path:
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return base / "PersonalAIProfile" / "backups"


def vault_operation_lock(vault: Path) -> FileLock:
    return _path_lock(vault, "vault")


def _path_lock(path: Path, namespace: str) -> FileLock:
    digest = hashlib.sha256(f"{namespace}:{path.resolve()}".encode("utf-8")).hexdigest()[:24]
    folder = backup_root().parent / "locks"
    folder.mkdir(parents=True, exist_ok=True)
    filename = str(folder / f"{digest}.lock")
    with _LOCKS_GUARD:
        return _LOCKS.setdefault(filename, FileLock(filename, timeout=30))


def _local_binding(namespace: str, *values: Path) -> str:
    key_file = backup_root().parent / "binding.key"
    key_file.parent.mkdir(parents=True, exist_ok=True)
    if not key_file.is_file():
        try:
            descriptor = os.open(key_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            descriptor = None
        if descriptor is not None:
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(secrets.token_bytes(32))
    payload = "\0".join([namespace, *(str(value.resolve()) for value in values)]).encode("utf-8")
    return hmac.new(key_file.read_bytes(), payload, hashlib.sha256).hexdigest()


def require_current_schema(vault: Path) -> None:
    version = schema_version(vault)
    if version != CURRENT_SCHEMA_VERSION:
        raise RuntimeError(f"Vault schema当前为 {version}，请显式执行 migrate 升级到 {CURRENT_SCHEMA_VERSION}。")


def _reject_links(root: Path) -> None:
    reparse = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    for directory, folders, files in os.walk(root, followlinks=False):
        for name in folders + files:
            path = Path(directory) / name
            info = path.lstat()
            if path.is_symlink() or getattr(info, "st_file_attributes", 0) & reparse:
                raise RuntimeError(f"Vault包含符号链接或重解析点，已拒绝：{path.relative_to(root)}")


def _file_hashes(root: Path) -> dict[str, str]:
    return {
        path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(root.rglob("*")) if path.is_file()
    }


def _ignore_runtime(_directory: str, names: list[str]) -> set[str]:
    blocked = {".git", ".env", "Locks", "Transactions"}
    return {name for name in names if name in blocked or name.endswith((".key", ".pem"))}


def _create_backup(vault: Path, destination_root: Path | None = None) -> Path:
    root = vault.resolve()
    assert_vault_isolated(root)
    base = (destination_root or backup_root()).expanduser().resolve()
    if _inside(base, ROOT) or _inside(ROOT, base) or _inside(base, root) or _inside(root, base):
        raise RuntimeError("备份目录不能位于公共仓库或私人Vault内。")
    _reject_links(root)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
    target = base / f"{root.name}-{stamp}"
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(root, target / "vault", ignore=_ignore_runtime)
    hashes = _file_hashes(target / "vault")
    (target / "backup.json").write_text(json.dumps({
        "format": 1, "schema_version": schema_version(root), "created": stamp, "files": hashes,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    return target


def create_backup(vault: Path, destination_root: Path | None = None) -> Path:
    root = vault.resolve()
    with vault_operation_lock(root):
        from .profile import recover_transactions
        recover_transactions(root)
        return _create_backup(root, destination_root)


def _validate_backup(source: Path) -> tuple[Path, dict[str, object]]:
    manifest = source / "backup.json"
    snapshot = source / "vault"
    if not manifest.is_file() or not snapshot.is_dir():
        raise RuntimeError("备份结构无效。")
    _reject_links(snapshot)
    data = json.loads(manifest.read_text(encoding="utf-8"))
    if data.get("format") != 1 or not isinstance(data.get("files"), dict):
        raise RuntimeError("不支持或不完整的备份格式。")
    if any(not (snapshot / name).is_file() for name in REQUIRED):
        raise RuntimeError("备份缺少Vault必需文件。")
    if schema_version(snapshot) != data.get("schema_version"):
        raise RuntimeError("备份schema与清单不一致。")
    if int(data["schema_version"]) > CURRENT_SCHEMA_VERSION:
        raise RuntimeError("备份schema高于当前程序支持版本。")
    if _file_hashes(snapshot) != data["files"]:
        raise RuntimeError("备份文件清单或哈希校验失败。")
    return snapshot, data


def _restore_backup(vault: Path, backup: Path) -> None:
    root = vault.resolve()
    assert_vault_isolated(root)
    source = backup.resolve()
    snapshot, _data = _validate_backup(source)
    parent = root.parent
    workspace = parent / f".{root.name}-restore-work"
    journal = parent / f".{root.name}-restore.json"
    _recover_swap(root, workspace, journal)
    previous = workspace / "previous"
    candidate = workspace / "candidate"
    swapped = False
    owned_workspace = False
    try:
        if workspace.exists():
            raise RuntimeError(f"恢复工作目录已存在且无有效journal：{workspace}")
        atomic_write(journal, json.dumps({"format": 1, "target": str(root)}, ensure_ascii=False))
        workspace.mkdir()
        owned_workspace = True
        shutil.copytree(snapshot, candidate)
        if _file_hashes(candidate) != _file_hashes(snapshot):
            raise RuntimeError("恢复候选副本校验失败。")
        if root.exists():
            os.replace(root, previous)
            swapped = True
        os.replace(candidate, root)
        journal.unlink(missing_ok=True)
    except Exception:
        if swapped:
            shutil.rmtree(root, ignore_errors=True)
            if previous.exists():
                os.replace(previous, root)
        journal.unlink(missing_ok=True)
        raise
    finally:
        if owned_workspace:
            shutil.rmtree(workspace, ignore_errors=True)


def _recover_swap(target: Path, workspace: Path, journal: Path) -> None:
    if not journal.is_file():
        return
    try:
        data = json.loads(journal.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise RuntimeError(f"交换journal损坏：{journal}") from exc
    if data != {"format": 1, "target": str(target.resolve())}:
        raise RuntimeError(f"交换journal与目标不匹配：{journal}")
    previous = workspace / "previous"
    if not target.exists() and previous.exists():
        os.replace(previous, target)
    if target.exists():
        journal.unlink(missing_ok=True)
        shutil.rmtree(workspace, ignore_errors=True)
    elif not previous.exists():
        journal.unlink(missing_ok=True)
        shutil.rmtree(workspace, ignore_errors=True)


def recover_vault_swap(vault: Path) -> None:
    root = vault.resolve()
    _recover_swap(root, root.parent / f".{root.name}-restore-work", root.parent / f".{root.name}-restore.json")


def restore_backup(vault: Path, backup: Path) -> None:
    root = vault.resolve()
    with vault_operation_lock(root):
        recover_vault_swap(root)
        _restore_backup(root, backup)


def _migrate_0_to_1(vault: Path) -> None:
    config = vault / CONFIG
    if not config.is_file():
        raise RuntimeError(f"缺少 {CONFIG}，无法迁移。")
    text = config.read_text(encoding="utf-8")
    if re.search(r"(?m)^schema_version:", text):
        text = re.sub(r"(?m)^schema_version:\s*.*$", "schema_version: 1", text)
    else:
        text = "schema_version: 1\n" + text
    atomic_write(config, text)


MIGRATIONS = {0: _migrate_0_to_1}


def _validate_current_vault(root: Path) -> None:
    missing = [name for name in REQUIRED if not (root / name).is_file()]
    if missing:
        raise RuntimeError(f"迁移后Vault缺少必需文件：{', '.join(missing)}")
    require_current_schema(root)
    _reject_links(root)
    ids: set[str] = set()
    for path in (root / MEMORY_ROOT).rglob("*.md"):
        metadata, _body = parse_record(path.read_text(encoding="utf-8"))
        folder = path.parent.name
        if folder not in FOLDER_STATUSES:
            continue
        record_id = metadata.get("id", "")
        status = metadata.get("status", "")
        if not re.fullmatch(r"mem-[A-Za-z0-9-]{1,80}", record_id) or status not in VALID_STATUSES:
            raise RuntimeError(f"迁移后记忆必需字段无效：{path.name}")
        if status not in FOLDER_STATUSES[folder]:
            raise RuntimeError(f"迁移后记忆状态与目录不一致：{path.name}")
        if record_id in ids:
            raise RuntimeError(f"迁移后存在重复记忆ID：{record_id}")
        ids.add(record_id)


def migrate_vault(vault: Path, destination_root: Path | None = None) -> Path | None:
    root = vault.resolve()
    assert_vault_isolated(root)
    with vault_operation_lock(root):
        recover_vault_swap(root)
        from .profile import recover_transactions
        recover_transactions(root)
        version = schema_version(root)
        if version > CURRENT_SCHEMA_VERSION:
            raise RuntimeError(f"Vault schema {version} 高于当前支持版本 {CURRENT_SCHEMA_VERSION}。")
        if version == CURRENT_SCHEMA_VERSION:
            return None
        missing = [name for name in REQUIRED if not (root / name).is_file()]
        if missing:
            raise RuntimeError(f"待迁移Vault缺少必需文件：{', '.join(missing)}")
        backup = _create_backup(root, destination_root)
        try:
            while version < CURRENT_SCHEMA_VERSION:
                migration = MIGRATIONS.get(version)
                if migration is None:
                    raise RuntimeError(f"缺少 schema {version} 的迁移程序。")
                migration(root)
                version = schema_version(root)
            _validate_current_vault(root)
            return backup
        except Exception:
            _restore_backup(root, backup)
            raise


def stage_public_export(vault: Path, relative_files: list[str], staging: Path) -> list[Path]:
    """Copy only explicitly allowlisted, explicitly public Markdown files."""
    root = vault.resolve()
    assert_vault_isolated(root)
    output = staging.resolve()
    if _inside(output, root) or _inside(root, output) or _inside(output, ROOT) or _inside(ROOT, output):
        raise RuntimeError("公开导出staging不能位于Vault或公共框架仓库内。")
    with vault_operation_lock(root), _path_lock(output, "public-export"):
        marker_name = ".personal-ai-profile-export.json"
        marker = {"format": 1, "binding": _local_binding("public-export", root, output)}
        if output.exists():
            try:
                existing_marker = json.loads((output / marker_name).read_text(encoding="utf-8"))
            except (OSError, ValueError) as exc:
                raise RuntimeError("公开导出目标已存在且不属于Personal AI Profile。") from exc
            if existing_marker != marker:
                raise RuntimeError("公开导出ownership marker与当前Vault或目标不匹配。")
        prepared: list[tuple[Path, str]] = []
        for relative in relative_files:
            source = (root / relative).resolve()
            if not _inside(source, root) or source.suffix.lower() != ".md" or not source.is_file() or source.is_symlink():
                raise RuntimeError(f"公开导出路径无效：{relative}")
            text = source.read_text(encoding="utf-8")
            metadata, _ = parse_record(text)
            if metadata.get("visibility") != "public":
                raise RuntimeError(f"文件未显式标记 visibility: public：{relative}")
            for label, pattern in SECRET_PATTERNS.items():
                if pattern.search(text):
                    raise RuntimeError(f"公开导出包含疑似敏感信息（{label}）：{relative}")
            prepared.append((source.relative_to(root), text))
        output.parent.mkdir(parents=True, exist_ok=True)
        workspace = output.parent / f".{output.name}-export-work"
        journal = output.parent / f".{output.name}-export.json"
        _recover_swap(output, workspace, journal)
        candidate = workspace / "candidate"
        previous = workspace / "previous"
        swapped = False
        owned_workspace = False
        try:
            if workspace.exists():
                raise RuntimeError(f"导出工作目录已存在且无有效journal：{workspace}")
            atomic_write(journal, json.dumps({"format": 1, "target": str(output)}, ensure_ascii=False))
            workspace.mkdir()
            owned_workspace = True
            for relative, text in prepared:
                target = candidate / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(text, encoding="utf-8")
            (candidate / marker_name).write_text(json.dumps(marker, ensure_ascii=False), encoding="utf-8")
            if output.exists():
                os.replace(output, previous)
                swapped = True
            os.replace(candidate, output)
            journal.unlink(missing_ok=True)
        except Exception:
            if swapped:
                shutil.rmtree(output, ignore_errors=True)
                if previous.exists():
                    os.replace(previous, output)
            journal.unlink(missing_ok=True)
            raise
        finally:
            if owned_workspace:
                shutil.rmtree(workspace, ignore_errors=True)
        return [output / relative for relative, _text in prepared]
