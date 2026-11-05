"""启动健康探测：读取 runtime.json 并请求 /api/v1/health。

被 diagnose.cmd 调用。输出 HEALTH_OK <url> 或 HEALTH_FAIL <reason>。
退出码 0 表示服务已就绪。
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path


def runtime_file() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
    return Path(base) / "PersonalAIProfile" / "runtime.json"


def main() -> int:
    path = runtime_file()
    if not path.is_file():
        print(f"HEALTH_FAIL 没有 runtime.json（{path}）")
        return 1
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        port = int(data["port"])
        token = str(data["token"])
    except (OSError, ValueError, KeyError) as exc:
        print(f"HEALTH_FAIL runtime.json 无法解析: {exc}")
        return 1

    url = f"http://127.0.0.1:{port}"
    try:
        with urllib.request.urlopen(f"{url}/api/v1/health", timeout=2) as response:
            if response.status != 200:
                print(f"HEALTH_FAIL health 返回 HTTP {response.status}")
                return 1
    except (OSError, urllib.error.URLError) as exc:
        print(f"HEALTH_FAIL 无法连接 {url}: {exc}")
        return 1

    try:
        request = urllib.request.Request(
            f"{url}/api/v1/security/clients", headers={"Authorization": f"Bearer {token}"}
        )
        with urllib.request.urlopen(request, timeout=2) as response:
            if response.status != 200:
                print(f"HEALTH_OK {url} (但带令牌的接口返回 HTTP {response.status})")
                return 0
    except (OSError, urllib.error.URLError) as exc:
        print(f"HEALTH_OK {url} (但带令牌的请求失败: {exc})")
        return 0

    print(f"HEALTH_OK {url}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
