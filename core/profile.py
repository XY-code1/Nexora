#!/usr/bin/env python3
"""Core profile, vault, and memory lifecycle operations."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import stat
import tempfile
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timezone
from functools import wraps
from pathlib import Path

from filelock import FileLock

ROOT = Path(__file__).parents[1]
REQUIRED = ["10 Profile/Profile.md", "00 Dashboard/Current Context.md", "AGENTS.md", "profile.config.yml"]
SECRET_PATTERNS = {
    "private key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "GitHub token": re.compile(r"\b(?:gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b"),
    "generic secret": re.compile(r"(?i)\b(api[_ -]?key|token|password|secret)\s*[:=]\s*[^\s<>{}]{8,}"),
}
MEMORY_ROOT = Path("30 Memory")
MEMORY_FOLDERS = {
    "candidate": "Inbox",
    "confirmed": "Confirmed",
    "rejected": "Rejected",
    "archived": "Archived",
}
VALID_STATUSES = {"candidate", "confirmed", "disputed", "rejected", "forgotten", "superseded"}
FOLDER_STATUSES = {
    "Inbox": {"candidate", "disputed"},
    "Confirmed": {"confirmed"},
    "Rejected": {"rejected"},
    "Archived": {"forgotten", "superseded"},
}


@contextmanager
def vault_lock(root: Path):
    """Serialize readers and writers across local processes for one Vault."""
    lock_path = root / "90 System" / "Locks" / "vault.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    from .vault_management import recover_vault_swap, vault_operation_lock
    with vault_operation_lock(root):
        recover_vault_swap(root)
        with FileLock(lock_path, timeout=10):
            recover_transactions(root)
            yield


def locked_write(function):
    @wraps(function)
    def wrapper(path: str, *args, **kwargs):
        root = vault(path)
        with vault_lock(root):
            return function(path, *args, **kwargs)
    return wrapper


def vault(path: str) -> Path:
    root = Path(path).expanduser().resolve()
    from .vault_management import CURRENT_SCHEMA_VERSION, assert_vault_isolated, recover_vault_swap, schema_version, vault_operation_lock
    with vault_operation_lock(root):
        recover_vault_swap(root)
    assert_vault_isolated(root)
    version = schema_version(root)
    if version != CURRENT_SCHEMA_VERSION:
        raise SystemExit(f"Vault schema当前为 {version}，需要先执行 migrate 升级到 {CURRENT_SCHEMA_VERSION}。")
    return root


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def init(path: str) -> None:
    target = Path(path).expanduser().resolve()
    from .vault_management import assert_vault_isolated
    assert_vault_isolated(target)
    if target.exists() and any(target.iterdir()):
        raise SystemExit(f"目标目录非空：{target}")
    shutil.copytree(ROOT / "template", target, dirs_exist_ok=True)
    print(f"已初始化：{target}")


def markdown_files(root: Path):
    yield from root.rglob("*.md")


def parse_record(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---\n"):
        return {}, text
    end = text.find("\n---", 4)
    if end == -1:
        return {}, text
    metadata: dict[str, str] = {}
    for line in text[4:end].splitlines():
        if not line.strip() or line.lstrip().startswith("#") or ":" not in line:
            continue
        key, value = line.split(":", 1)
        metadata[key.strip()] = value.strip()
    return metadata, text[end + 4 :].lstrip("\n")


def serialize_record(metadata: dict[str, str], body: str) -> str:
    fields = "\n".join(f"{key}: {value}" for key, value in metadata.items() if value != "")
    return f"---\n{fields}\n---\n\n{body.rstrip()}\n"


def summary_body(content: str, title: str = "记忆") -> str:
    return f"# {title}\n\n## 摘要\n\n{content.strip()}\n"


def fingerprint(content: str) -> str:
    normalized = re.sub(r"\s+", " ", content.strip().lower())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def clean_meta(value: str, limit: int = 200) -> str:
    return re.sub(r"[\r\n:]+", " ", value).strip()[:limit]


def assert_no_secret(content: str) -> None:
    for label, pattern in SECRET_PATTERNS.items():
        if pattern.search(content):
            raise SystemExit(f"内容疑似包含敏感信息（{label}），请脱敏后重试。")


def _audit_lifecycle(root: Path, event_type: str, record_id: str, *, client_id: str = "local-user") -> None:
    from .security import append_event, verify_audit
    if verify_audit(root)["status"] == "invalid":
        raise RuntimeError("安全审计链完整性失败；已停止记忆生命周期操作。")
    append_event(root, client_id=client_id, event_type=event_type, resource_type="memory", scope="memory:lifecycle", result="allowed", reason_code="LIFECYCLE_COMPLETED", details={"resourceId": record_id})


def atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        handle.write(text)
        temporary = Path(handle.name)
    os.replace(temporary, path)


def revision(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require_revision(path: Path, expected: str | None) -> None:
    if expected is not None and revision(path) != expected:
        raise SystemExit("记录已被其他进程修改，请刷新后重试。")


def record_by_id(root: Path, folder: str, record_id: str) -> Path:
    if not re.fullmatch(r"mem-[A-Za-z0-9-]{1,80}", record_id):
        raise SystemExit("记忆ID无效。")
    base = root / MEMORY_ROOT / folder
    for path in base.glob("*.md"):
        path = safe_vault_file(root, path)
        metadata, _ = read_record(path)
        if metadata.get("id") == record_id:
            return path
    raise SystemExit(f"未找到记忆：{record_id}")


def _transaction_target(root: Path, relative: str) -> Path:
    candidate = (root / relative).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError as exc:
        raise RuntimeError("事务日志包含非法路径。") from exc
    return candidate


def begin_transaction(root: Path, rollback: dict[Path, str | None]) -> tuple[Path, dict[str, object]]:
    folder = root / "90 System" / "Transactions"
    folder.mkdir(parents=True, exist_ok=True)
    journal = folder / f"{uuid.uuid4().hex}.json"
    data: dict[str, object] = {
        "state": "pending",
        "rollback": {str(path.relative_to(root)): content for path, content in rollback.items()},
    }
    atomic_write(journal, json.dumps(data, ensure_ascii=False))
    return journal, data


def commit_transaction(journal: Path, data: dict[str, object]) -> None:
    data["state"] = "committed"
    atomic_write(journal, json.dumps(data, ensure_ascii=False))
    journal.unlink()


def recover_transactions(root: Path) -> None:
    folder = root / "90 System" / "Transactions"
    if not folder.is_dir():
        return
    for journal in folder.glob("*.json"):
        data = json.loads(journal.read_text(encoding="utf-8"))
        if data.get("state") == "committed":
            journal.unlink(missing_ok=True)
            continue
        rollback = data.get("rollback")
        if not isinstance(rollback, dict):
            raise RuntimeError(f"事务日志无效：{journal.name}")
        for relative, content in rollback.items():
            target = _transaction_target(root, relative)
            if content is None:
                target.unlink(missing_ok=True)
            elif isinstance(content, str):
                atomic_write(target, content)
            else:
                raise RuntimeError(f"事务回滚内容无效：{journal.name}")
        journal.unlink(missing_ok=True)


def safe_record(root: Path, folder: str, filename: str) -> Path:
    if Path(filename).name != filename or not filename.endswith(".md"):
        raise SystemExit("文件名无效；只能使用记忆目录中的Markdown文件名。")
    base = (root / MEMORY_ROOT / folder).resolve()
    path = (base / filename).resolve()
    try:
        path.relative_to(base)
    except ValueError as exc:
        raise SystemExit("文件路径逃逸出记忆目录。") from exc
    if not path.is_file():
        raise SystemExit(f"记忆文件不存在或不安全：{filename}")
    return safe_vault_file(root, path)


def safe_vault_file(root: Path, path: Path) -> Path:
    resolved_root = root.resolve(strict=True)
    resolved = path.resolve(strict=True)
    try:
        resolved.relative_to(resolved_root)
    except ValueError as exc:
        raise SystemExit("文件路径逃逸出私人Vault。") from exc
    current = path
    reparse = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
    while True:
        info = current.lstat()
        if current.is_symlink() or getattr(info, "st_file_attributes", 0) & reparse:
            raise SystemExit("不允许通过符号链接或重解析点读取档案。")
        if current.resolve() == resolved_root:
            return resolved
        current = current.parent


def read_record(path: Path) -> tuple[dict[str, str], str]:
    metadata, body = parse_record(path.read_text(encoding="utf-8"))
    if not metadata.get("id") or metadata.get("status") not in VALID_STATUSES:
        raise SystemExit(f"记忆元数据无效：{path.name}")
    return metadata, body


def validate(path: str) -> None:
    root = Path(path).expanduser().resolve()
    errors: list[str] = []
    from .vault_management import CURRENT_SCHEMA_VERSION, assert_vault_isolated, schema_version
    try:
        assert_vault_isolated(root)
    except RuntimeError as exc:
        errors.append(str(exc))
    version = schema_version(root)
    if version != CURRENT_SCHEMA_VERSION:
        errors.append(f"schema_version 应为 {CURRENT_SCHEMA_VERSION}，当前为 {version}")
    ids: dict[str, Path] = {}
    for name in REQUIRED:
        if not (root / name).is_file():
            errors.append(f"缺少 {name}")
    for file in markdown_files(root):
        text = file.read_text(encoding="utf-8")
        for label, pattern in SECRET_PATTERNS.items():
            if pattern.search(text):
                errors.append(f"{file.relative_to(root)}：疑似 {label}")
        if MEMORY_ROOT in file.relative_to(root).parents:
            metadata, _ = parse_record(text)
            record_id = metadata.get("id")
            if record_id:
                if record_id in ids:
                    errors.append(f"重复记忆ID：{record_id}")
                ids[record_id] = file
            folder = file.parent.name
            if folder in FOLDER_STATUSES and metadata.get("status") not in FOLDER_STATUSES[folder]:
                errors.append(f"{file.relative_to(root)}：状态与目录不匹配")
    if errors:
        print("验证失败：")
        print("\n".join(f"- {item}" for item in errors))
        raise SystemExit(1)
    print("验证通过：结构完整，未发现已知秘密模式或重复记忆ID。")


@locked_write
def remember(
    path: str,
    text: str,
    source_agent: str = "local-cli",
    memory_type: str = "note",
    subject: str = "",
) -> Path:
    content = text.strip()
    if not content:
        raise SystemExit("候选记忆不能为空。")
    if len(content) > 4000:
        raise SystemExit("候选记忆过长（>4000字符）。")
    assert_no_secret(content)
    root = vault(path)
    day = date.today().isoformat()
    record_id = f"mem-{day.replace('-', '')}-{uuid.uuid4().hex[:8]}"
    destination = root / MEMORY_ROOT / "Inbox" / f"{day}-{record_id}.md"
    metadata = {
        "id": record_id,
        "type": clean_meta(memory_type, 64) or "note",
        "subject": clean_meta(subject),
        "status": "candidate",
        "created": now(),
        "updated": now(),
        "visibility": "private",
        "ai_access": "summary-only",
        "source_agent": clean_meta(source_agent, 64) or "unknown",
        "fingerprint": fingerprint(content),
    }
    from .security import verify_audit
    if verify_audit(root)["status"] == "invalid":
        raise RuntimeError("安全审计链完整性失败；已停止候选记忆创建。")
    atomic_write(destination, serialize_record(metadata, summary_body(content, "候选记忆")))
    _audit_lifecycle(root, "memory.candidate_created", record_id, client_id=metadata["source_agent"])
    print(f"候选记忆已创建：{destination}")
    return destination


def list_pending(path: str) -> None:
    root = vault(path)
    files = sorted((root / MEMORY_ROOT / "Inbox").glob("*.md"))
    if not files:
        print("暂无待确认记忆。")
        return
    for file in files:
        file = safe_vault_file(root, file)
        metadata, body = read_record(file)
        summary = re.search(r"(?ims)^##\s*摘要\s*\n(.+?)(?=\n##\s|\Z)", body)
        value = summary.group(1).strip() if summary else "（无摘要）"
        print(f"{file.name}\n  状态：{metadata['status']}  来源：{metadata.get('source_agent', 'unknown')}\n  {value[:200]}")


def preview(path: str, file: str) -> None:
    source = safe_record(vault(path), "Inbox", file)
    print(source.read_text(encoding="utf-8"))


@locked_write
def edit_candidate(path: str, file: str, text: str, expected_revision: str | None = None) -> None:
    content = text.strip()
    if not content:
        raise SystemExit("修改后的记忆不能为空。")
    if len(content) > 4000:
        raise SystemExit("修改后的记忆过长（>4000字符）。")
    assert_no_secret(content)
    source = safe_record(vault(path), "Inbox", file)
    require_revision(source, expected_revision)
    metadata, _ = read_record(source)
    if metadata["status"] not in {"candidate", "disputed"}:
        raise SystemExit("只能修改候选或冲突记忆。")
    metadata.update({"status": "candidate", "updated": now(), "fingerprint": fingerprint(content)})
    metadata.pop("conflicts_with", None)
    atomic_write(source, serialize_record(metadata, summary_body(content, "候选记忆")))
    print(f"候选记忆已修改：{source.name}")


def find_conflict(root: Path, metadata: dict[str, str]) -> tuple[str, str] | None:
    for file in sorted((root / MEMORY_ROOT / "Confirmed").glob("*.md")):
        file = safe_vault_file(root, file)
        existing, _ = read_record(file)
        if existing.get("fingerprint") == metadata.get("fingerprint"):
            return "duplicate", file.name
        if (
            metadata.get("subject")
            and existing.get("subject") == metadata.get("subject")
            and existing.get("type") == metadata.get("type")
        ):
            return "conflict", file.name
    return None


@locked_write
def confirm(path: str, file: str, expected_revision: str | None = None) -> None:
    root = vault(path)
    source = safe_record(root, "Inbox", file)
    require_revision(source, expected_revision)
    metadata, body = read_record(source)
    from .security import verify_audit
    if verify_audit(root)["status"] == "invalid":
        raise RuntimeError("安全审计链完整性失败；已停止记忆确认。")
    issue = find_conflict(root, metadata)
    if issue:
        kind, other = issue
        if kind == "duplicate":
            raise SystemExit(f"已存在相同的确认记忆：{other}")
        metadata.update({"status": "disputed", "updated": now(), "conflicts_with": other})
        atomic_write(source, serialize_record(metadata, body))
        raise SystemExit(f"发现同主题冲突：{other}。请修改候选记忆或使用supersede替代旧记忆。")
    metadata.update({"status": "confirmed", "updated": now(), "confirmed_at": now()})
    destination = root / MEMORY_ROOT / "Confirmed" / source.name
    if destination.exists():
        raise SystemExit(f"目标文件已存在：{destination.name}")
    journal, transaction = begin_transaction(root, {
        source: source.read_text(encoding="utf-8"), destination: None,
    })
    try:
        atomic_write(destination, serialize_record(metadata, body.replace("# 候选记忆", "# 已确认记忆", 1)))
        source.unlink()
        commit_transaction(journal, transaction)
    except BaseException:
        recover_transactions(root)
        raise
    _audit_lifecycle(root, "memory.confirmed", metadata["id"])
    print(f"已确认：{destination}")


@locked_write
def reject(path: str, file: str, reason: str = "user-rejected", expected_revision: str | None = None) -> None:
    root = vault(path)
    source = safe_record(root, "Inbox", file)
    require_revision(source, expected_revision)
    metadata, body = read_record(source)
    from .security import verify_audit
    if verify_audit(root)["status"] == "invalid":
        raise RuntimeError("安全审计链完整性失败；已停止记忆拒绝。")
    metadata.update({"status": "rejected", "updated": now(), "rejected_at": now(), "reason": clean_meta(reason)})
    destination = root / MEMORY_ROOT / "Rejected" / source.name
    destination.parent.mkdir(parents=True, exist_ok=True)
    journal, transaction = begin_transaction(root, {
        source: source.read_text(encoding="utf-8"), destination: None,
    })
    try:
        atomic_write(destination, serialize_record(metadata, body))
        source.unlink()
        commit_transaction(journal, transaction)
    except BaseException:
        recover_transactions(root)
        raise
    _audit_lifecycle(root, "memory.rejected", metadata["id"])
    print(f"已拒绝并保留审计记录：{destination}")


def show_source(path: str, file: str) -> None:
    root = vault(path)
    for folder in ("Inbox", "Confirmed", "Rejected", "Archived"):
        try:
            record = safe_record(root, folder, file)
        except SystemExit:
            continue
        metadata, _ = read_record(record)
        for key in ("id", "status", "source_agent", "created", "updated", "confirmed_at", "reason"):
            if metadata.get(key):
                print(f"{key}: {metadata[key]}")
        return
    raise SystemExit(f"未找到记忆：{file}")


@locked_write
def forget(path: str, file: str, reason: str = "user-forgot", expected_revision: str | None = None) -> None:
    root = vault(path)
    source = safe_record(root, "Confirmed", file)
    require_revision(source, expected_revision)
    metadata, body = read_record(source)
    from .security import verify_audit
    if verify_audit(root)["status"] == "invalid":
        raise RuntimeError("安全审计链完整性失败；已停止记忆归档。")
    metadata.update({"status": "forgotten", "updated": now(), "forgotten_at": now(), "reason": clean_meta(reason)})
    destination = root / MEMORY_ROOT / "Archived" / source.name
    destination.parent.mkdir(parents=True, exist_ok=True)
    journal, transaction = begin_transaction(root, {
        source: source.read_text(encoding="utf-8"), destination: None,
    })
    try:
        atomic_write(destination, serialize_record(metadata, body))
        source.unlink()
        commit_transaction(journal, transaction)
    except BaseException:
        recover_transactions(root)
        raise
    _audit_lifecycle(root, "memory.archived", metadata["id"])
    print(f"已从有效记忆中移除并归档：{destination}")


@locked_write
def supersede(path: str, file: str, text: str, expected_revision: str | None = None) -> None:
    content = text.strip()
    if not content:
        raise SystemExit("替代记忆不能为空。")
    if len(content) > 4000:
        raise SystemExit("替代记忆过长（>4000字符）。")
    assert_no_secret(content)
    root = vault(path)
    source = safe_record(root, "Confirmed", file)
    require_revision(source, expected_revision)
    old, old_body = read_record(source)
    from .security import verify_audit
    if verify_audit(root)["status"] == "invalid":
        raise RuntimeError("安全审计链完整性失败；已停止记忆替代。")
    original = source.read_text(encoding="utf-8")
    day = date.today().isoformat()
    new_id = f"mem-{day.replace('-', '')}-{uuid.uuid4().hex[:8]}"
    new_name = f"{day}-{new_id}.md"
    old.update({"status": "superseded", "updated": now(), "superseded_by": new_id})
    archive = root / MEMORY_ROOT / "Archived" / source.name
    archive.parent.mkdir(parents=True, exist_ok=True)
    new = {
        "id": new_id,
        "type": old.get("type", "note"),
        "subject": old.get("subject", ""),
        "status": "confirmed",
        "created": now(),
        "updated": now(),
        "confirmed_at": now(),
        "visibility": old.get("visibility", "private"),
        "ai_access": old.get("ai_access", "summary-only"),
        "source_agent": "local-cli",
        "supersedes": old["id"],
        "fingerprint": fingerprint(content),
    }
    destination = root / MEMORY_ROOT / "Confirmed" / new_name
    journal, transaction = begin_transaction(root, {
        source: original, archive: None, destination: None,
    })
    try:
        atomic_write(source, serialize_record(old, old_body))
        source.replace(archive)
        atomic_write(destination, serialize_record(new, summary_body(content, "已确认记忆")))
        commit_transaction(journal, transaction)
    except BaseException:
        recover_transactions(root)
        raise
    _audit_lifecycle(root, "memory.superseded", old["id"])
    _audit_lifecycle(root, "memory.confirmed", new_id)
    print(f"旧记忆已归档：{archive.name}\n新记忆已确认：{destination.name}")


def section(file: Path, limit: int = 3000) -> str:
    if not file.is_file():
        return "（暂无）"
    return file.read_text(encoding="utf-8").strip()[:limit]


@locked_write
def build_context(path: str) -> None:
    root = vault(path)
    destination = root / "90 System" / "Indexes" / "ai-context.md"
    destination.parent.mkdir(parents=True, exist_ok=True)
    atomic_write(
        destination,
        "# AI Context\n\n> 自动生成；只包含任务所需的最小上下文。\n\n"
        f"## Profile\n\n{section(root / '10 Profile' / 'Profile.md')}\n\n"
        f"## Current Context\n\n{section(root / '00 Dashboard' / 'Current Context.md')}\n",
    )
    print(f"上下文已生成：{destination}")


@locked_write
def human3(path: str) -> None:
    root = vault(path)
    day = date.today().isoformat()
    destination = root / "40 Reviews" / "Human3" / "Answers" / f"{day}.md"
    if destination.exists():
        raise SystemExit(f"今日问卷已存在：{destination}")
    questions = (ROOT / "prompts" / "human3-questions.md").read_text(encoding="utf-8")
    atomic_write(
        destination,
        f"---\nassessment: human3\ndate: {day}\nstatus: draft\nai_access: summary-only\n---\n\n{questions}",
    )
    print(f"问卷已创建：{destination}")

