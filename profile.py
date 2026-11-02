#!/usr/bin/env python3
"""Local-first personal profile CLI; standard library only."""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import shutil
import tempfile
import uuid
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent
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


def vault(path: str) -> Path:
    return Path(path).expanduser().resolve()


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def init(path: str) -> None:
    target = vault(path)
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


def atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        handle.write(text)
        temporary = Path(handle.name)
    os.replace(temporary, path)


def safe_record(root: Path, folder: str, filename: str) -> Path:
    if Path(filename).name != filename or not filename.endswith(".md"):
        raise SystemExit("文件名无效；只能使用记忆目录中的Markdown文件名。")
    base = (root / MEMORY_ROOT / folder).resolve()
    path = (base / filename).resolve()
    try:
        path.relative_to(base)
    except ValueError as exc:
        raise SystemExit("文件路径逃逸出记忆目录。") from exc
    if not path.is_file() or path.is_symlink():
        raise SystemExit(f"记忆文件不存在或不安全：{filename}")
    return path


def read_record(path: Path) -> tuple[dict[str, str], str]:
    metadata, body = parse_record(path.read_text(encoding="utf-8"))
    if not metadata.get("id") or metadata.get("status") not in VALID_STATUSES:
        raise SystemExit(f"记忆元数据无效：{path.name}")
    return metadata, body


def validate(path: str) -> None:
    root = vault(path)
    errors: list[str] = []
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
    atomic_write(destination, serialize_record(metadata, summary_body(content, "候选记忆")))
    print(f"候选记忆已创建：{destination}")
    return destination


def list_pending(path: str) -> None:
    root = vault(path)
    files = sorted((root / MEMORY_ROOT / "Inbox").glob("*.md"))
    if not files:
        print("暂无待确认记忆。")
        return
    for file in files:
        metadata, body = read_record(file)
        summary = re.search(r"(?ims)^##\s*摘要\s*\n(.+?)(?=\n##\s|\Z)", body)
        value = summary.group(1).strip() if summary else "（无摘要）"
        print(f"{file.name}\n  状态：{metadata['status']}  来源：{metadata.get('source_agent', 'unknown')}\n  {value[:200]}")


def preview(path: str, file: str) -> None:
    source = safe_record(vault(path), "Inbox", file)
    print(source.read_text(encoding="utf-8"))


def edit_candidate(path: str, file: str, text: str) -> None:
    content = text.strip()
    if not content:
        raise SystemExit("修改后的记忆不能为空。")
    if len(content) > 4000:
        raise SystemExit("修改后的记忆过长（>4000字符）。")
    assert_no_secret(content)
    source = safe_record(vault(path), "Inbox", file)
    metadata, _ = read_record(source)
    if metadata["status"] not in {"candidate", "disputed"}:
        raise SystemExit("只能修改候选或冲突记忆。")
    metadata.update({"status": "candidate", "updated": now(), "fingerprint": fingerprint(content)})
    metadata.pop("conflicts_with", None)
    atomic_write(source, serialize_record(metadata, summary_body(content, "候选记忆")))
    print(f"候选记忆已修改：{source.name}")


def find_conflict(root: Path, metadata: dict[str, str]) -> tuple[str, str] | None:
    for file in sorted((root / MEMORY_ROOT / "Confirmed").glob("*.md")):
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


def confirm(path: str, file: str) -> None:
    root = vault(path)
    source = safe_record(root, "Inbox", file)
    metadata, body = read_record(source)
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
    atomic_write(destination, serialize_record(metadata, body.replace("# 候选记忆", "# 已确认记忆", 1)))
    source.unlink()
    print(f"已确认：{destination}")


def reject(path: str, file: str, reason: str = "user-rejected") -> None:
    root = vault(path)
    source = safe_record(root, "Inbox", file)
    metadata, body = read_record(source)
    metadata.update({"status": "rejected", "updated": now(), "rejected_at": now(), "reason": clean_meta(reason)})
    destination = root / MEMORY_ROOT / "Rejected" / source.name
    destination.parent.mkdir(parents=True, exist_ok=True)
    atomic_write(destination, serialize_record(metadata, body))
    source.unlink()
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


def forget(path: str, file: str, reason: str = "user-forgot") -> None:
    root = vault(path)
    source = safe_record(root, "Confirmed", file)
    metadata, body = read_record(source)
    metadata.update({"status": "forgotten", "updated": now(), "forgotten_at": now(), "reason": clean_meta(reason)})
    destination = root / MEMORY_ROOT / "Archived" / source.name
    destination.parent.mkdir(parents=True, exist_ok=True)
    atomic_write(destination, serialize_record(metadata, body))
    source.unlink()
    print(f"已从有效记忆中移除并归档：{destination}")


def supersede(path: str, file: str, text: str) -> None:
    content = text.strip()
    if not content:
        raise SystemExit("替代记忆不能为空。")
    if len(content) > 4000:
        raise SystemExit("替代记忆过长（>4000字符）。")
    assert_no_secret(content)
    root = vault(path)
    source = safe_record(root, "Confirmed", file)
    old, old_body = read_record(source)
    day = date.today().isoformat()
    new_id = f"mem-{day.replace('-', '')}-{uuid.uuid4().hex[:8]}"
    new_name = f"{day}-{new_id}.md"
    old.update({"status": "superseded", "updated": now(), "superseded_by": new_id})
    archive = root / MEMORY_ROOT / "Archived" / source.name
    archive.parent.mkdir(parents=True, exist_ok=True)
    atomic_write(source, serialize_record(old, old_body))
    source.replace(archive)
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
    atomic_write(destination, serialize_record(new, summary_body(content, "已确认记忆")))
    print(f"旧记忆已归档：{archive.name}\n新记忆已确认：{destination.name}")


def section(file: Path, limit: int = 3000) -> str:
    if not file.is_file():
        return "（暂无）"
    return file.read_text(encoding="utf-8").strip()[:limit]


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


def main() -> None:
    parser = argparse.ArgumentParser(prog="profile")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("init", "validate", "build-context", "human3", "list-pending"):
        cmd = commands.add_parser(name)
        cmd.add_argument("path")

    cmd = commands.add_parser("remember")
    cmd.add_argument("path")
    cmd.add_argument("text")
    cmd.add_argument("--type", dest="memory_type", default="note")
    cmd.add_argument("--subject", default="")

    for name in ("preview", "confirm", "show-source"):
        cmd = commands.add_parser(name)
        cmd.add_argument("path")
        cmd.add_argument("file")

    cmd = commands.add_parser("edit")
    cmd.add_argument("path")
    cmd.add_argument("file")
    cmd.add_argument("text")

    for name in ("reject", "forget"):
        cmd = commands.add_parser(name)
        cmd.add_argument("path")
        cmd.add_argument("file")
        cmd.add_argument("--reason", default="user-request")

    cmd = commands.add_parser("supersede")
    cmd.add_argument("path")
    cmd.add_argument("file")
    cmd.add_argument("text")

    actions = {
        "init": init, "validate": validate, "remember": remember,
        "list-pending": list_pending, "preview": preview, "edit": edit_candidate,
        "confirm": confirm, "reject": reject, "show-source": show_source,
        "forget": forget, "supersede": supersede,
        "build-context": build_context, "human3": human3,
    }
    args = vars(parser.parse_args())
    command = args.pop("command")
    actions[command](**args)


if __name__ == "__main__":
    main()
