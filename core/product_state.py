"""Minimal product-state storage inside the private Vault.

只保存「用户已经完成过初始化流程」这类一次性标记，不保存任何偏好或内容。
文件位于 90 System/state.json，随 Vault 一起同步到其它设备。
"""

from __future__ import annotations

import json
from pathlib import Path

STATE_FILE = Path("90 System") / "state.json"


def read_state(vault: Path) -> dict[str, object]:
    path = vault / STATE_FILE
    if not path.is_file():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def write_state(vault: Path, value: dict[str, object]) -> None:
    path = vault / STATE_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def is_initialized(vault: Path) -> bool:
    return bool(read_state(vault).get("initialized"))


def mark_initialized(vault: Path) -> None:
    state = read_state(vault)
    state["initialized"] = True
    write_state(vault, state)
