"""GitHub onboarding: Device Flow, private verification and the no-token guard."""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from core import github


class FakeTransport:
    def __init__(self, **responses: dict) -> None:
        self.responses = responses
        self.calls: list[tuple[str, str, dict, dict]] = []

    def __call__(self, method: str, url: str, *, data: dict | None = None, headers: dict | None = None) -> dict:
        self.calls.append((method, url, dict(data or {}), dict(headers or {})))
        if url == github.GITHUB_DEVICE_URL:
            return self.responses["device"]
        if url == github.GITHUB_TOKEN_URL:
            return self.responses.get("token", {"error": "authorization_pending"})
        if "/user/repos?" in url:
            return self.responses.get("repos", []) if "page=1" in url else []
        if url.startswith(github.GITHUB_API + "/repos/"):
            return self.responses["repo"]
        if url == github.GITHUB_API + "/user/repos":
            return self.responses["create"]
        raise AssertionError(f"unexpected request: {method} {url}")


def main() -> None:
    original_root = github.app_data_root
    original_request = github._request
    with tempfile.TemporaryDirectory() as tmp:
        github.app_data_root = lambda: Path(tmp)  # noqa: E731 - test isolation
        transport = FakeTransport(
            device={"device_code": "dev-1", "user_code": "ABCD-1234", "verification_uri": "https://github.com/login/device", "expires_in": 900, "interval": 1},
            token={"access_token": "gho_secret_token"},
            repos=[{"name": "vault", "full_name": "alice/vault", "private": True, "permissions": {"push": True}}],
            repo={"full_name": "alice/vault", "private": True, "default_branch": "main", "permissions": {"push": True}},
            create={"full_name": "alice/new-vault", "private": True},
        )
        github.set_transport(transport)
        github.configure_client_id("Iv1.test")
        try:
            code = github.start_device_flow()
            assert code["userCode"] == "ABCD-1234" and code["verificationUri"].startswith("https://"), code
            assert not github.session_active()
            assert github.poll_device_flow() == {"status": "authorized"}
            assert github.session_active()

            repos = github.list_repositories()
            assert repos[0]["fullName"] == "alice/vault" and repos[0]["private"] is True
            # The token is only ever used in a request header, never returned.
            assert transport.calls[-1][3]["Authorization"] == "Bearer gho_secret_token"
            assert github.verify_repository("alice/vault")["private"] is True

            # A public repository is rejected before any remote is touched.
            transport.responses["repo"] = {"full_name": "alice/public", "private": False}
            try:
                github.connect("unused", "alice/public")
                raise AssertionError("public repository was accepted")
            except github.GitHubError as exc:
                assert "public" in str(exc), exc

            created = github.create_repository("new-vault")
            assert created["fullName"] == "alice/new-vault" and created["private"] is True

            # Missing client id is an explicit error, not a silent fallback.
            github.configure_client_id("")
            try:
                github.start_device_flow()
                raise AssertionError("missing client id was accepted")
            except github.GitHubError as exc:
                assert "Client ID" in str(exc), exc

            # Unknown repository names are rejected before any request.
            try:
                github.verify_repository("not-a-full-name")
                raise AssertionError("invalid repository name was accepted")
            except github.GitHubError as exc:
                assert "owner/repo" in str(exc), exc
        finally:
            github.configure_client_id("")
            github.set_transport(original_request)
            github.app_data_root = original_root

    print("github onboarding, verification and privacy guard tests passed")


def test_default_request_retry() -> None:
    """_default_request retries transient transport failures but not 4xx answers."""
    import json
    import urllib.error
    from unittest.mock import patch

    attempts = {"count": 0}

    class FakeResponse:
        def __enter__(self) -> "FakeResponse":
            return self

        def __exit__(self, *args: object) -> bool:
            return False

        def read(self) -> bytes:
            return json.dumps({"ok": True}).encode("utf-8")

    def flaky(request: object, body: object, timeout: object = None):
        attempts["count"] += 1
        if attempts["count"] < 3:
            raise urllib.error.URLError("connection reset")
        return FakeResponse()

    with patch("urllib.request.urlopen", flaky):
        assert github._default_request("GET", "https://api.github.com/user") == {"ok": True}
    assert attempts["count"] == 3, attempts

    attempts["count"] = 0

    def unauthorized(request: object, body: object, timeout: object = None):
        attempts["count"] += 1
        raise urllib.error.HTTPError("https://api.github.com/user", 401, "Unauthorized", {}, None)

    with patch("urllib.request.urlopen", unauthorized):
        try:
            github._default_request("GET", "https://api.github.com/user")
            raise AssertionError("HTTP 401 was not raised")
        except urllib.error.HTTPError:
            pass
    assert attempts["count"] == 1, attempts


if __name__ == "__main__":
    main()
    test_default_request_retry()
