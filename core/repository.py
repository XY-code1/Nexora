"""Single safe read boundary for adapters that inspect Vault files."""

from __future__ import annotations

from pathlib import Path

from .profile import safe_vault_file


def list_markdown(root: Path, relative: str, *, recursive: bool = False, limit: int = 100, reverse: bool = False) -> list[Path]:
    base = safe_vault_file(root, root / relative)
    iterator = base.rglob("*.md") if recursive else base.glob("*.md")
    return [safe_vault_file(root, path) for path in sorted(iterator, reverse=reverse)[:max(0, min(limit, 1000))]]


def read_text(root: Path, path: Path, *, limit: int = 20_000) -> str:
    safe = safe_vault_file(root, path)
    with safe.open("r", encoding="utf-8") as handle:
        text = handle.read(limit + 1)
    if len(text) > limit:
        raise ValueError(f"档案文件超过单文件读取上限（{limit}字符）。")
    return text
