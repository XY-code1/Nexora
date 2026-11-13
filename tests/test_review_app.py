import sys
import tempfile
import threading
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))
import profile as p

import review_app


def post(url: str, data: dict[str, str]):
    body = urllib.parse.urlencode(data).encode()
    return urllib.request.urlopen(urllib.request.Request(url, data=body, method="POST"))


def main():
    with tempfile.TemporaryDirectory() as tmp:
        vault = Path(tmp) / "vault"
        p.init(str(vault))
        candidate = p.remember(str(vault), "喜欢自然对话", source_agent="test-agent")
        server = review_app.create_server(vault)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            assert "喜欢自然对话" in urllib.request.urlopen(base + "/").read().decode()
            page = urllib.request.urlopen(base + "/candidate?file=" + urllib.parse.quote(candidate.name)).read().decode()
            assert "test-agent" in page and "csrf" in page

            post(base + "/action", {
                "csrf": server.token, "file": candidate.name,
                "action": "edit", "content": "喜欢自然对话和可视化", "reason": "",
            }).read()
            post(base + "/action", {
                "csrf": server.token, "file": candidate.name,
                "action": "confirm", "content": "", "reason": "",
            }).read()
            assert (vault / "30 Memory" / "Confirmed" / candidate.name).is_file()

            rejected = p.remember(str(vault), "不需要保存")
            post(base + "/action", {
                "csrf": server.token, "file": rejected.name,
                "action": "reject", "content": "", "reason": "temporary",
            }).read()
            assert (vault / "30 Memory" / "Rejected" / rejected.name).is_file()

            try:
                post(base + "/action", {"csrf": "wrong", "file": "x.md", "action": "confirm"})
                raise AssertionError("CSRF failed open")
            except urllib.error.HTTPError as exc:
                assert exc.code == 403

            post(base + "/action", {"csrf": server.token, "action": "shutdown"}).read()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
    print("review UI passed")


if __name__ == "__main__":
    main()
