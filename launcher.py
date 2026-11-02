#!/usr/bin/env python3
"""Single-instance Windows-friendly launcher for the local React review app."""

from __future__ import annotations

import argparse
import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

import uvicorn
from filelock import FileLock, Timeout

from apps.api import create_app

ROOT = Path(__file__).parent
HOST = "127.0.0.1"


def runtime_directory(override: Path | None = None) -> Path:
    if override:
        return override.expanduser().resolve()
    base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    return base / "PersonalAIProfile"


def choose_vault(value: Path | None) -> Path:
    candidates = [value, Path(os.environ["PROFILE_VAULT"]) if os.environ.get("PROFILE_VAULT") else None, ROOT.parent / "my-ai-profile"]
    for candidate in candidates:
        if candidate and candidate.expanduser().is_dir():
            return candidate.expanduser().resolve()
    try:
        from tkinter import Tk, filedialog
        root = Tk()
        root.withdraw()
        selected = filedialog.askdirectory(title="选择 Personal AI Profile 私人 Vault")
        root.destroy()
    except Exception:
        selected = ""
    if not selected:
        raise RuntimeError("未选择私人 Vault。")
    return Path(selected).resolve()


def ensure_web_build() -> Path:
    web = ROOT / "apps" / "web"
    index = web / "dist" / "index.html"
    if index.is_file():
        return index.parent
    npm = shutil.which("npm.cmd") or shutil.which("npm")
    if not npm:
        raise RuntimeError("缺少前端构建且未找到 npm；请先安装 Node.js 或使用后续打包版本。")
    subprocess.run([npm, "install"], cwd=web, check=True)
    subprocess.run([npm, "run", "build"], cwd=web, check=True)
    if not index.is_file():
        raise RuntimeError("React审核界面构建失败。")
    return index.parent


def read_runtime(path: Path) -> dict[str, object] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def healthy(port: int, timeout: float = 0.5) -> bool:
    try:
        with urllib.request.urlopen(f"http://{HOST}:{port}/api/v1/health", timeout=timeout) as response:
            return response.status == 200
    except (OSError, urllib.error.URLError, ValueError):
        return False


def browser_url(port: int, token: str) -> str:
    return f"http://{HOST}:{port}/#" + urllib.parse.urlencode({"token": token})


def write_runtime(path: Path, *, port: int, token: str, vault: Path) -> None:
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps({
        "pid": os.getpid(), "port": port, "token": token,
        "vault": str(vault), "started": time.time(),
    }, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary, path)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass


def wait_and_open(port: int, token: str, no_browser: bool) -> None:
    for _ in range(100):
        if healthy(port):
            if not no_browser:
                webbrowser.open(browser_url(port, token))
            return
        time.sleep(0.1)


def launch(args: argparse.Namespace) -> int:
    state_dir = runtime_directory(args.runtime_dir)
    state_dir.mkdir(parents=True, exist_ok=True)
    runtime_file = state_dir / "runtime.json"
    lock_file = state_dir / "launcher.lock"
    lock = FileLock(lock_file)

    try:
        lock.acquire(timeout=0)
    except Timeout:
        for _ in range(50):
            current = read_runtime(runtime_file)
            if current and healthy(int(current.get("port", 0))):
                if not args.no_browser:
                    webbrowser.open(browser_url(int(current["port"]), str(current["token"])))
                return 0
            time.sleep(0.1)
        raise RuntimeError("已有启动进程占用单实例锁，但本地服务尚未就绪。")

    sock: socket.socket | None = None
    try:
        vault = choose_vault(args.vault)
        web_dist = ensure_web_build()
        token = secrets.token_urlsafe(32)
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((HOST, args.port))
        sock.listen(128)
        port = int(sock.getsockname()[1])

        app = create_app(vault, token=token, web_dist=web_dist)
        server = uvicorn.Server(uvicorn.Config(app, host=HOST, port=port, log_level="warning"))
        app.state.request_shutdown = lambda: setattr(server, "should_exit", True)
        write_runtime(runtime_file, port=port, token=token, vault=vault)
        threading.Thread(target=wait_and_open, args=(port, token, args.no_browser), daemon=True).start()
        server.run(sockets=[sock])
        return 0
    finally:
        runtime_file.unlink(missing_ok=True)
        if sock:
            sock.close()
        lock.release()
        lock_file.unlink(missing_ok=True)


def show_error(message: str, state_dir: Path) -> None:
    state_dir.mkdir(parents=True, exist_ok=True)
    (state_dir / "launcher-error.log").write_text(message, encoding="utf-8")
    try:
        from tkinter import Tk, messagebox
        root = Tk()
        root.withdraw()
        messagebox.showerror("Personal AI Profile", message)
        root.destroy()
    except Exception:
        print(message, file=sys.stderr)


def main() -> int:
    parser = argparse.ArgumentParser(description="启动Personal AI Profile本地审核界面")
    parser.add_argument("--vault", type=Path)
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--runtime-dir", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--no-browser", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    try:
        return launch(args)
    except Exception as exc:
        show_error(str(exc), runtime_directory(args.runtime_dir))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
