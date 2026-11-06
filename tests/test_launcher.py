import json
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT))

from core import profile


def wait_for_runtime(path: Path) -> dict[str, object]:
    for _ in range(100):
        if path.is_file():
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                pass
        time.sleep(0.1)
    raise AssertionError("launcher did not become ready")


def main():
    assert (ROOT / "apps" / "web" / "dist" / "index.html").is_file(), "run npm build before launcher test"
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        vault = base / "vault"
        second_vault = base / "vault-2"
        runtime_dir = base / "runtime"
        profile.init(str(vault))
        profile.init(str(second_vault))
        command = [
            sys.executable, str(ROOT / "launcher.py"), "--vault", str(vault),
            "--runtime-dir", str(runtime_dir), "--no-browser",
        ]
        process = subprocess.Popen(command, cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        runtime_file = runtime_dir / "runtime.json"
        try:
            runtime = wait_for_runtime(runtime_file)
            port = int(runtime["port"])
            token = str(runtime["token"])
            assert port > 0 and token
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/v1/health", timeout=2) as response:
                assert response.status == 200

            switch = urllib.request.Request(
                f"http://127.0.0.1:{port}/api/v1/vault/switch", method="POST",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                data=json.dumps({"path": str(second_vault)}).encode("utf-8"),
            )
            with urllib.request.urlopen(switch, timeout=2) as response:
                assert response.status == 200
            old_token = token
            for _ in range(100):
                next_runtime = wait_for_runtime(runtime_file)
                if next_runtime.get("vault") == str(second_vault.resolve()) and next_runtime.get("token") != token:
                    runtime = next_runtime
                    break
                time.sleep(0.1)
            else:
                raise AssertionError("launcher did not switch Vault")
            port = int(runtime["port"])
            token = str(runtime["token"])
            stale = urllib.request.Request(
                f"http://127.0.0.1:{port}/api/v1/vault",
                headers={"Authorization": f"Bearer {old_token}"},
            )
            try:
                urllib.request.urlopen(stale, timeout=2)
                raise AssertionError("stale launcher session was accepted")
            except urllib.error.HTTPError as exc:
                assert exc.code == 401

            duplicate = subprocess.run(command, cwd=ROOT, timeout=5)
            assert duplicate.returncode == 0 and process.poll() is None

            request = urllib.request.Request(
                f"http://127.0.0.1:{port}/api/v1/shutdown", method="POST",
                headers={"Authorization": f"Bearer {token}"},
            )
            with urllib.request.urlopen(request, timeout=2) as response:
                assert response.status == 200
            assert process.wait(timeout=10) == 0
            for _ in range(20):
                if not runtime_file.exists():
                    break
                time.sleep(0.1)
            assert not runtime_file.exists()
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=5)
    print("launcher integration passed")


if __name__ == "__main__":
    main()
