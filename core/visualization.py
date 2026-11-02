"""Privacy-trimmed, read-only views for the local visualization UI."""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

from . import profile
from .access import extract_summary, get_access_level


def _safe_text(root: Path, path: Path) -> str:
    return profile.safe_vault_file(root, path).read_text(encoding="utf-8")


def _audit_tail(root: Path, path: Path, max_bytes: int = 262_144) -> list[str]:
    path = profile.safe_vault_file(root, path)
    with path.open("rb") as handle:
        handle.seek(0, 2)
        size = handle.tell()
        handle.seek(max(0, size - max_bytes))
        data = handle.read()
    return data.decode("utf-8", errors="replace").splitlines()[-500:]


def _sections(body: str) -> list[dict[str, Any]]:
    parts = re.split(r"(?m)^##\s+", body)
    result = []
    for part in parts[1:]:
        title, _, text = part.partition("\n")
        items = [line[2:].strip() for line in text.splitlines() if line.startswith("- ") and line[2:].strip()]
        result.append({"title": title.strip()[:80], "items": items[:12]})
    return result


def profile_overview(root: Path) -> dict[str, Any]:
    text = _safe_text(root, root / "10 Profile" / "Profile.md")
    metadata, body = profile.parse_record(text)
    access = get_access_level(text)
    if access in {"denied", "local-only"}:
        return {"access": access, "sections": [], "protected": True}
    if access == "summary-only":
        return {"access": access, "sections": [{"title": "摘要", "items": [extract_summary(body)]}], "protected": False}
    return {"access": access, "sections": _sections(body), "protected": False, "visibility": metadata.get("visibility", "private")}


def _memory_files(root: Path):
    for folder in profile.MEMORY_FOLDERS.values():
        for path in (root / profile.MEMORY_ROOT / folder).glob("*.md"):
            yield folder, path


def timeline(root: Path, limit: int = 100) -> list[dict[str, Any]]:
    rows = []
    for folder, path in _memory_files(root):
        path = profile.safe_vault_file(root, path)
        metadata, body = profile.read_record(path)
        access = get_access_level(path.read_text(encoding="utf-8"))
        status = metadata["status"]
        can_preview = folder == "Confirmed" and status == "confirmed" and access in {"allowed", "summary-only"}
        rows.append({
            "id": metadata["id"], "status": status, "type": metadata.get("type", "note") if can_preview else "protected",
            "subject": metadata.get("subject", "") if can_preview else "",
            "sourceAgent": metadata.get("source_agent", "unknown") if can_preview else "protected",
            "created": metadata.get("created", ""), "updated": metadata.get("updated", ""),
            "access": access, "previewAvailable": can_preview,
            "preview": extract_summary(body) if can_preview else "",
        })
    return sorted(rows, key=lambda row: row["updated"] or row["created"], reverse=True)[:limit]


def privacy_audit(root: Path) -> dict[str, Any]:
    status: Counter[str] = Counter()
    access: Counter[str] = Counter()
    sources: Counter[str] = Counter()
    issues = []
    for _, path in _memory_files(root):
        text = _safe_text(root, path)
        metadata, _ = profile.parse_record(text)
        status[metadata.get("status", "invalid")] += 1
        level = get_access_level(text)
        access[level] += 1
        sources[metadata.get("source_agent", "unknown")] += 1
        if "ai_access" not in metadata or metadata.get("ai_access") not in {"allowed", "summary-only", "local-only", "denied"}:
            issues.append({"id": metadata.get("id", path.name), "issue": "ai_access 缺失或无效，已按 denied 处理"})
    audit_events: Counter[str] = Counter()
    audit_file = root / "90 System" / "Audit" / "mcp.jsonl"
    if audit_file.is_file():
        for line in _audit_tail(root, audit_file):
            try:
                value = json.loads(line)
                audit_events[str(value.get("event", "unknown"))] += 1
            except json.JSONDecodeError:
                audit_events["invalid_record"] += 1
    return {
        "totalMemories": sum(status.values()), "byStatus": dict(status), "byAccess": dict(access),
        "bySource": dict(sources.most_common(10)), "mcpEvents": dict(audit_events), "issues": issues[:50],
        "rules": ["未确认记忆不会出现在可视化预览中", "denied 与 local-only 不返回预览", "所有统计仅在本机生成"],
    }


def human3_trend(root: Path) -> dict[str, Any]:
    points = []
    history = root / "40 Reviews" / "Human3" / "History"
    for path in sorted(history.glob("*.md"))[-24:]:
        text = _safe_text(root, path)
        metadata, body = profile.parse_record(text)
        access = get_access_level(text)
        if metadata.get("status") != "confirmed" or access in {"denied", "local-only"}:
            continue
        scores = {}
        for key in ("mind", "body", "spirit", "vocation"):
            value = metadata.get(key, "")
            if re.fullmatch(r"(?:10|[0-9])(?:\.\d+)?", value):
                scores[key] = float(value)
        points.append({"date": metadata.get("date", path.stem), "scores": scores, "summary": extract_summary(body)})
    return {"disclaimer": "Human 3.0 仅用于自我反思，不是医学或心理诊断。", "dimensions": ["mind", "body", "spirit", "vocation"], "points": points}
