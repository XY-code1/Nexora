"""User-controlled import of Markdown/JSON into candidate memories.

The importer never confirms memories.  It parses user-supplied input, previews
each item against the existing Vault, and writes only validated items as
candidates in the Inbox.  Confirmation still goes through the normal review
flow, so an import can never silently promote content into the profile.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from . import profile

MAX_CONTENT = 4000
MAX_ITEMS = 100
MAX_TOTAL_CHARS = 200_000
VALID_FORMATS = {"markdown", "json"}


class ImportError(ValueError):
    """Raised when the supplied input cannot be parsed at all."""


def parse_input(fmt: str, content: str) -> list[dict[str, str]]:
    """Parse raw input into normalized items (type / subject / content)."""
    if fmt not in VALID_FORMATS:
        raise ImportError(f"不支持的导入格式：{fmt}")
    if len(content) > MAX_TOTAL_CHARS:
        raise ImportError(f"导入内容过长（>{MAX_TOTAL_CHARS} 字符）。")
    items = _parse_json(content) if fmt == "json" else _parse_markdown(content)
    if not items:
        raise ImportError("没有解析到任何条目。")
    if len(items) > MAX_ITEMS:
        raise ImportError(f"条目数量超过上限（{MAX_ITEMS}）。")
    return items


def _parse_json(content: str) -> list[dict[str, str]]:
    try:
        data = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ImportError(f"JSON 解析失败：{exc.msg}") from None
    if isinstance(data, dict):
        data = [data]
    if not isinstance(data, list):
        raise ImportError("JSON 顶层必须是数组或对象。")
    items: list[dict[str, str]] = []
    for entry in data:
        if not isinstance(entry, dict):
            raise ImportError("JSON 条目必须是对象。")
        body = entry.get("content", entry.get("text", entry.get("body", "")))
        items.append({
            "type": str(entry.get("type") or "note"),
            "subject": str(entry.get("subject") or entry.get("title") or ""),
            "content": str(body),
        })
    return items


def _parse_markdown(content: str) -> list[dict[str, str]]:
    """Parse `---` delimited records with optional leading `key: value` lines.

    A record is `---`, optional metadata lines, `---`, then the body.  Input
    without a leading `---` is treated as a single plain-text item.
    """
    text = content.strip("\n")
    if not text.strip():
        return []
    if not text.lstrip().startswith("---"):
        return [{"type": "note", "subject": "", "content": text.strip()}]

    items: list[dict[str, str]] = []
    metadata: dict[str, str] = {}
    body: list[str] = []
    state = "seeking"
    for line in text.split("\n"):
        if line.strip() == "---":
            if state == "seeking":
                metadata, body = {}, []
                state = "meta"
            elif state == "meta":
                state = "body"
            else:
                items.append({"type": metadata.get("type") or "note", "subject": metadata.get("subject") or "", "content": "\n".join(body).strip()})
                metadata, body = {}, []
                state = "meta"
            continue
        if state == "meta":
            match = re.match(r"^([A-Za-z_][\w -]*):\s*(.*)$", line)
            if match:
                metadata[match.group(1).strip().lower()] = match.group(2).strip()
            elif line.strip():
                body.append(line)
                state = "body"
            continue
        body.append(line)
    if state == "body":
        items.append({"type": metadata.get("type") or "note", "subject": metadata.get("subject") or "", "content": "\n".join(body).strip()})
    return [item for item in items if item["content"]]


def _existing_records(root: Path) -> tuple[set[str], set[tuple[str, str]]]:
    fingerprints: set[str] = set()
    subjects: set[tuple[str, str]] = set()
    base = root / profile.MEMORY_ROOT
    for folder in ("Inbox", "Confirmed"):
        for path in (base / folder).glob("*.md"):
            try:
                metadata, _ = profile.read_record(profile.safe_vault_file(root, path))
            except (SystemExit, OSError):
                continue
            if metadata.get("fingerprint"):
                fingerprints.add(metadata["fingerprint"])
            if metadata.get("subject") and metadata.get("type"):
                subjects.add((metadata["subject"], metadata["type"]))
    return fingerprints, subjects


def validate_item(
    content: str,
    type_: str,
    subject: str,
    fingerprints: set[str],
    subjects: set[tuple[str, str]],
) -> tuple[str, str]:
    body = content.strip()
    if not body:
        return "invalid", "内容为空"
    if len(body) > MAX_CONTENT:
        return "invalid", f"内容超过 {MAX_CONTENT} 字符"
    try:
        profile.assert_no_secret(body)
    except SystemExit as exc:
        return "invalid", str(exc)
    if profile.fingerprint(body) in fingerprints:
        return "duplicate", "与现有记忆内容重复"
    if subject and (subject, type_) in subjects:
        return "duplicate", "与现有记忆同主题"
    return "ready", ""


def preview_import(root: Path, fmt: str, content: str) -> dict[str, object]:
    """Parse and validate without writing anything."""
    items = parse_input(fmt, content)
    fingerprints, subjects = _existing_records(root)
    rows: list[dict[str, object]] = []
    summary = {"total": len(items), "ready": 0, "duplicate": 0, "invalid": 0}
    for index, item in enumerate(items):
        type_ = profile.clean_meta(item["type"], 64) or "note"
        subject = profile.clean_meta(item["subject"])
        status, reason = validate_item(item["content"], type_, subject, fingerprints, subjects)
        summary[status] += 1
        rows.append({
            "index": index,
            "type": type_,
            "subject": subject,
            "content": item["content"].strip(),
            "preview": item["content"].strip()[:200],
            "status": status,
            "reason": reason,
        })
    return {"items": rows, "summary": summary}


def commit_import(root: Path, items: list[dict[str, str]], source: str = "local-import") -> dict[str, object]:
    """Write validated items as candidates; never confirm them."""
    fingerprints, subjects = _existing_records(root)
    created: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []
    for item in items[:MAX_ITEMS]:
        type_ = profile.clean_meta(str(item.get("type") or "note"), 64) or "note"
        subject = profile.clean_meta(str(item.get("subject") or ""))
        content = str(item.get("content") or "")
        status, reason = validate_item(content, type_, subject, fingerprints, subjects)
        if status != "ready":
            skipped.append({"type": type_, "subject": subject, "reason": reason})
            continue
        try:
            path = profile.remember(str(root), content, source, type_, subject)
        except (SystemExit, RuntimeError) as exc:
            skipped.append({"type": type_, "subject": subject, "reason": str(exc)})
            continue
        metadata, _ = profile.read_record(path)
        created.append({"id": metadata["id"], "type": type_, "subject": subject})
        fingerprints.add(profile.fingerprint(content))
    return {"created": created, "skipped": skipped}
