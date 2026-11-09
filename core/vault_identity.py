"""Stable Vault identity, local registry, and external-change detection."""

from __future__ import annotations

import json
import os
import secrets
import threading
from datetime import datetime, timezone
from pathlib import Path

from filelock import FileLock

from .profile import atomic_write
from .vault_management import _content_revision, assert_vault_isolated, require_current_schema

IDENTITY_FILE = Path("90 System") / "vault.json"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def app_data_root() -> Path:
    if os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return base / "PersonalAIProfile"


def ensure_identity(vault: Path) -> dict[str, str]:
    root = vault.expanduser().resolve()
    assert_vault_isolated(root)
    require_current_schema(root)
    path = root / IDENTITY_FILE
    if path.is_file():
        value = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(value, dict) and isinstance(value.get("vault_id"), str) and value["vault_id"].startswith("vault_"):
            return {key: str(value.get(key, "")) for key in ("vault_id", "display_name", "created_at")}
        raise RuntimeError("Vault identity 文件损坏。")
    value = {"vault_id": f"vault_{secrets.token_hex(16)}", "display_name": root.name, "created_at": _now()}
    atomic_write(path, json.dumps(value, ensure_ascii=False, indent=2))
    return value


def register_vault(vault: Path) -> dict[str, str]:
    root = vault.expanduser().resolve()
    identity = ensure_identity(root)
    registry = app_data_root() / "vaults.json"
    registry.parent.mkdir(parents=True, exist_ok=True)
    entry = {**identity, "path": str(root), "last_opened_at": _now()}
    with FileLock(str(registry) + ".lock", timeout=10):
        try:
            entries = json.loads(registry.read_text(encoding="utf-8")) if registry.is_file() else []
        except (OSError, ValueError):
            entries = []
        if not isinstance(entries, list):
            entries = []
        entries = [item for item in entries if isinstance(item, dict) and item.get("vault_id") != identity["vault_id"]]
        entries.insert(0, entry)
        atomic_write(registry, json.dumps(entries[:20], ensure_ascii=False, indent=2))
    return entry


def list_registered() -> list[dict[str, object]]:
    registry = app_data_root() / "vaults.json"
    try:
        entries = json.loads(registry.read_text(encoding="utf-8")) if registry.is_file() else []
    except (OSError, ValueError):
        return []
    return [{"vaultId": item.get("vault_id", ""), "displayName": item.get("display_name", ""), "available": Path(str(item.get("path", ""))).is_dir(), "lastOpenedAt": item.get("last_opened_at", "")} for item in entries if isinstance(item, dict)]


def default_vault_directory() -> str:
    """A safe, user-writable default location for a new Vault."""
    base = Path(os.environ.get("USERPROFILE") or os.environ.get("HOME") or Path.home())
    return str(base / "Nexora" / "vault")


def forget_vault(vault_id: str) -> dict[str, object]:
    """Remove a Vault from the local registry. Never touches files on disk."""
    registry = app_data_root() / "vaults.json"
    try:
        entries = json.loads(registry.read_text(encoding="utf-8")) if registry.is_file() else []
    except (OSError, ValueError):
        entries = []
    if not isinstance(entries, list):
        entries = []
    kept = [item for item in entries if not (isinstance(item, dict) and item.get("vault_id") == vault_id)]
    if len(kept) == len(entries):
        raise RuntimeError(f"未找到已登记的 Vault：{vault_id}")
    with FileLock(str(registry) + ".lock", timeout=10):
        registry.parent.mkdir(parents=True, exist_ok=True)
        registry.write_text(json.dumps(kept, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"vaultId": vault_id, "forgotten": True}


_WATCHER_BLOCKED = {".git", ".env", "Locks", "Transactions"}


def _fast_signature(root: Path) -> tuple[float, int]:
    """Cheap change signal: newest mtime and file count, ignoring runtime files."""
    newest = 0.0
    count = 0
    for directory, folders, files in os.walk(root, followlinks=False):
        folders[:] = [name for name in folders if name not in _WATCHER_BLOCKED]
        for name in files:
            if name.endswith((".key", ".pem")):
                continue
            try:
                info = (Path(directory) / name).stat()
            except OSError:
                continue
            newest = max(newest, info.st_mtime)
            count += 1
    return newest, count

def find_registered(vault_id: str) -> dict[str, str] | None:
    """Return the raw registry entry (including its local path) for server-side use.

    The path never leaves the local service; the Web only ever sees a vault id.
    """
    registry = app_data_root() / "vaults.json"
    try:
        entries = json.loads(registry.read_text(encoding="utf-8")) if registry.is_file() else []
    except (OSError, ValueError):
        return None
    for item in entries:
        if isinstance(item, dict) and item.get("vault_id") == vault_id:
            return item
    return None


class VaultMonitor:
    """Tracks Vault identity, external edits, and a resident change watcher.

    The watcher polls a cheap filesystem signature (newest mtime + file count)
    and only hashes the whole Vault when that signature moves, so it stays
    affordable without pulling in a filesystem-event dependency.
    """

    def __init__(self, vault: Path, poll_interval: float = 5.0):
        self.root = vault.resolve()
        self.poll_interval = poll_interval
        self.accepted_revision = _content_revision(self.root)
        self.last_seen_revision = self.accepted_revision
        self.events: list[dict[str, str]] = []
        self._signature = _fast_signature(self.root)
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._run, name="vault-watcher", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        thread = self._thread
        if thread is not None:
            thread.join(timeout=self.poll_interval * 2)

    def _run(self) -> None:
        while not self._stop.wait(self.poll_interval):
            try:
                signature = _fast_signature(self.root)
            except OSError:
                continue
            if signature == self._signature:
                continue
            self._signature = signature
            current = _content_revision(self.root)
            self.last_seen_revision = current
            if current != self.accepted_revision:
                self.events.append({"revision": current, "detectedAt": _now()})
                self.events = self.events[-50:]

    def view(self) -> dict[str, object]:
        identity = ensure_identity(self.root)
        current = _content_revision(self.root)
        self.last_seen_revision = current
        return {"vaultId": identity["vault_id"], "displayName": identity["display_name"], "schemaVersion": 1, "revision": current, "externalChange": current != self.accepted_revision, "lastSeenRevision": self.last_seen_revision, "watched": self._thread is not None}

    def events_view(self) -> dict[str, object]:
        return {**self.view(), "events": list(self.events)}

    def accept(self) -> None:
        self.accepted_revision = _content_revision(self.root)
        self.last_seen_revision = self.accepted_revision
        self._signature = _fast_signature(self.root)
