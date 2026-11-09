import subprocess
import sys
import tempfile
from contextlib import redirect_stdout
from concurrent.futures import ThreadPoolExecutor
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parents[1]))

from apps.api import create_app
import apps.api.main as api_main
from core import profile


def test_startup_token_is_hidden_unless_requested():
    app = SimpleNamespace(state=SimpleNamespace(token="test-admin-token"))
    hidden_output = StringIO()
    with patch.object(api_main, "create_app", return_value=app), patch.object(api_main.uvicorn, "run"), patch.object(
        sys, "argv", ["api-main", "--vault", "unused"]
    ), redirect_stdout(hidden_output):
        api_main.main()
    assert "Local API: http://127.0.0.1:8765" in hidden_output.getvalue()
    assert "Bearer token" not in hidden_output.getvalue()
    assert "test-admin-token" not in hidden_output.getvalue()

    visible_output = StringIO()
    with patch.object(api_main, "create_app", return_value=app), patch.object(api_main.uvicorn, "run"), patch.object(
        sys, "argv", ["api-main", "--vault", "unused", "--show-token"]
    ), redirect_stdout(visible_output):
        api_main.main()
    assert "Bearer token: test-admin-token" in visible_output.getvalue()


def main():
    test_startup_token_is_hidden_unless_requested()
    with tempfile.TemporaryDirectory() as tmp:
        vault = Path(tmp) / "vault"
        profile.init(str(vault))
        web_dist = Path(tmp) / "web-dist"
        (web_dist / "assets").mkdir(parents=True)
        (web_dist / "index.html").write_text("<h1>review app</h1>", encoding="utf-8")
        (web_dist / "assets" / "app.js").write_text("console.log('review')", encoding="utf-8")
        app = create_app(vault, token="test-token", web_dist=web_dist)
        client = TestClient(app, base_url="http://localhost")
        headers = {"Authorization": "Bearer test-token"}

        # ai_access governs AI egress, not what the authenticated local user can review.
        for case, access in {
            "allowed": "allowed",
            "summary-only": "summary-only",
            "local-only": "local-only",
            "denied": "denied",
            "missing": None,
            "invalid": "not-a-policy",
        }.items():
            record_id = f"mem-policy-{case}"
            access_line = f"ai_access: {access}\n" if access is not None else ""
            record = vault / "30 Memory" / "Rejected" / f"{case}.md"
            record.write_text(
                f"---\nid: {record_id}\nstatus: rejected\n{access_line}---\n\n"
                "## 摘要\n\n显式摘要。\n\n## 私密正文\n\n完整正文仅用于本地审核。\n",
                encoding="utf-8",
            )
            view = client.get(f"/api/v1/memories/{record_id}", headers=headers).json()["data"]
            assert "完整正文仅用于本地审核。" in view["content"]
            assert view["aiAccess"] == (access or "denied")

        assert client.get("/api/v1/health").status_code == 200
        assert "review app" in client.get("/").text
        assert "review app" in client.get("/client-route").text
        assert "console.log" in client.get("/assets/app.js").text
        assert client.get("/%2e%2e/secret.txt").status_code == 200
        assert client.get("/api/v1/memories").status_code == 401
        assert client.get("/api/v1/health", headers={"Host": "evil.example"}).status_code == 400
        invalid = client.post("/api/v1/memories/candidates", headers=headers, json={"content": ""})
        assert invalid.status_code == 422 and invalid.json()["error"]["code"] == "VALIDATION_ERROR"

        created = client.post(
            "/api/v1/memories/candidates",
            headers=headers,
            json={"content": "回答先给结论", "memory_type": "preference", "subject": "answer-style"},
        )
        assert created.status_code == 201
        memory = created.json()["data"]
        revision = memory["revision"]
        assert memory["aiAccess"] == "summary-only" and memory["visibility"] == "private"
        assert client.get("/api/v1/memory-stats").status_code == 401
        stats = client.get("/api/v1/memory-stats", headers=headers).json()["data"]
        assert stats == {"candidateMemories": 1, "pendingReview": 1, "confirmedMemories": 0}

        edited = client.patch(
            f"/api/v1/memories/{memory['id']}",
            headers=headers,
            json={"content": "回答先给结论，再说明原因", "expected_revision": revision},
        )
        assert edited.status_code == 200
        current_revision = edited.json()["data"]["revision"]

        stale = client.patch(
            f"/api/v1/memories/{memory['id']}",
            headers=headers,
            json={"content": "覆盖其他修改", "expected_revision": revision},
        )
        assert stale.status_code == 409
        assert stale.json()["error"]["code"] == "REVISION_CONFLICT"

        confirmed = client.post(
            f"/api/v1/memories/{memory['id']}/confirm",
            headers=headers,
            json={"expected_revision": current_revision},
        )
        assert confirmed.status_code == 200
        stats = client.get("/api/v1/memory-stats", headers=headers).json()["data"]
        assert stats == {"candidateMemories": 0, "pendingReview": 0, "confirmedMemories": 1}

        confirmed_view = client.get(f"/api/v1/memories/{memory['id']}", headers=headers).json()["data"]
        superseded = client.post(
            f"/api/v1/memories/{memory['id']}/supersede",
            headers=headers,
            json={"expected_revision": confirmed_view["revision"], "content": "默认简洁回答"},
        )
        assert superseded.status_code == 200
        replacement = client.get(
            "/api/v1/memories?status=confirmed", headers=headers,
        ).json()["data"][0]
        forgotten = client.post(
            f"/api/v1/memories/{replacement['id']}/forget",
            headers=headers,
            json={"expected_revision": replacement["revision"], "reason": "user-request"},
        )
        assert forgotten.status_code == 200

        second = client.post(
            "/api/v1/memories/candidates", headers=headers, json={"content": "临时信息"},
        ).json()["data"]
        rejected = client.post(
            f"/api/v1/memories/{second['id']}/reject",
            headers=headers,
            json={"expected_revision": second["revision"], "reason": "temporary"},
        )
        assert rejected.status_code == 200

        candidate = profile.remember(str(vault), "并发候选")
        candidate_revision = profile.revision(candidate)

        def edit(value: str) -> str:
            try:
                profile.edit_candidate(str(vault), candidate.name, value, candidate_revision)
                return "ok"
            except SystemExit:
                return "conflict"

        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(edit, ("并发修改A", "并发修改B")))
        assert sorted(outcomes) == ["conflict", "ok"]

        rollback_source = vault / "30 Memory" / "Inbox" / "rollback.md"
        rollback_source.write_text("original", encoding="utf-8")
        rollback_destination = vault / "30 Memory" / "Confirmed" / "rollback.md"
        journal, _ = profile.begin_transaction(vault, {
            rollback_source: "original", rollback_destination: None,
        })
        rollback_source.unlink()
        rollback_destination.write_text("partial", encoding="utf-8")
        profile.recover_transactions(vault)
        assert rollback_source.read_text(encoding="utf-8") == "original"
        assert not rollback_destination.exists() and not journal.exists()

        # GitHub onboarding endpoints (fake transport, no network).
        from core import github as github_mod

        class _FakeGitHub:
            def __init__(self) -> None:
                self.repo = {"full_name": "alice/vault", "private": True, "default_branch": "main", "permissions": {}}

            def __call__(self, method: str, url: str, *, data: dict | None = None, headers: dict | None = None) -> dict:
                if url == github_mod.GITHUB_DEVICE_URL:
                    return {"device_code": "dev-1", "user_code": "ABCD-1234", "verification_uri": "https://github.com/login/device", "expires_in": 900, "interval": 1}
                if url == github_mod.GITHUB_TOKEN_URL:
                    return {"access_token": "gho_fake"}
                if "/user/repos?" in url:
                    return [{"name": "vault", "full_name": "alice/vault", "private": True, "permissions": {}}] if "page=1" in url else []
                if url.startswith(github_mod.GITHUB_API + "/repos/"):
                    return dict(self.repo, full_name=url.rsplit("/", 1)[-1])
                if url == github_mod.GITHUB_API + "/user/repos":
                    return {"full_name": "alice/new-vault", "private": True}
                raise AssertionError(f"unexpected request: {method} {url}")

        fake = _FakeGitHub()
        github_mod.set_transport(fake)
        github_mod.configure_client_id("Iv1.test")
        try:
            status = client.get("/api/v1/github/status", headers=headers)
            assert status.status_code == 200 and status.json()["data"]["configured"] is True, status.text

            device = client.post("/api/v1/github/device-code", headers=headers)
            assert device.status_code == 200 and device.json()["data"]["userCode"] == "ABCD-1234", device.text

            poll = client.post("/api/v1/github/device-poll", headers=headers)
            assert poll.status_code == 200 and poll.json()["data"]["status"] == "authorized", poll.text

            repos = client.get("/api/v1/github/repositories", headers=headers)
            assert repos.status_code == 200 and repos.json()["data"][0]["fullName"] == "alice/vault", repos.text

            verified = client.post("/api/v1/github/verify", headers=headers, json={"repository": "alice/vault"})
            assert verified.status_code == 200 and verified.json()["data"]["private"] is True, verified.text

            fake.repo = {"full_name": "alice/public", "private": False}
            public = client.post("/api/v1/github/verify", headers=headers, json={"repository": "alice/public"})
            assert public.status_code == 200 and public.json()["data"]["private"] is False, public.text

            created = client.post("/api/v1/github/create", headers=headers, json={"name": "new-vault"})
            assert created.status_code == 201 and created.json()["data"]["private"] is True, created.text
        finally:
            github_mod.configure_client_id("")
            github_mod.set_transport(None)

        # Provider authorization: start from a clean registry.
        for item in client.get("/api/v1/providers", headers=headers).json()["data"]["providers"]:
            client.delete(f"/api/v1/providers/{item['provider']}", headers=headers)
        overview = client.get("/api/v1/providers", headers=headers)
        assert overview.status_code == 200 and overview.json()["data"]["providers"] == [], overview.text
        assert set(overview.json()["data"]["scopes"]) == {"reflection:summary", "profile:summary", "memory:search"}, overview.text

        denied = client.post("/api/v1/providers/preview", headers=headers, json={"provider": "local-llm", "scope": "reflection:summary", "context": {"summary": "x"}})
        assert denied.status_code == 409, denied.text

        granted = client.post("/api/v1/providers", headers=headers, json={"provider": "local-llm", "scopes": ["reflection:summary"]})
        assert granted.status_code == 201, granted.text

        preview = client.post("/api/v1/providers/preview", headers=headers, json={"provider": "local-llm", "scope": "reflection:summary", "context": {"summary": "x", "secret": "y"}})
        assert preview.status_code == 200, preview.text
        data = preview.json()["data"]
        assert data["preview"] == {"summary": "x"} and data["droppedFields"] == ["secret"], data

        decided = client.post("/api/v1/providers/calls", headers=headers, json={"request_id": data["requestId"], "action": "approve"})
        assert decided.status_code == 200 and decided.json()["data"]["payload"] == {"summary": "x"}, decided.text

        log = client.get("/api/v1/providers/audit", headers=headers)
        assert log.status_code == 200 and log.json()["data"]["integrity"]["events"] >= 1, log.text
        assert log.json()["data"]["items"][0]["details"]["provider"] == "local-llm", log.text

        # Events endpoint and resident watcher.
        events = client.get("/api/v1/vault/events", headers=headers)
        assert events.status_code == 200 and "events" in events.json()["data"], events.text

        import time
        from core.vault_identity import VaultMonitor
        monitor = VaultMonitor(vault, poll_interval=0.2)
        monitor.start()
        try:
            (vault / "10 Profile" / "Profile.md").write_text("edited externally\n", encoding="utf-8")
            for _ in range(60):
                if monitor.events:
                    break
                time.sleep(0.05)
            assert monitor.view()["externalChange"] is True, monitor.view()
            assert monitor.events, monitor.events
        finally:
            monitor.stop()

        # Git 历史：只读提交列表。
        for command in (["init", "-b", "main"], ["config", "user.email", "a@example.com"], ["config", "user.name", "A"], ["add", "-A"], ["commit", "-m", "init"]):
            subprocess.run(["git", *command], cwd=str(vault), capture_output=True, text=True)
        history = client.get("/api/v1/git/history", headers=headers)
        assert history.status_code == 200, history.text
        data = history.json()["data"]
        assert data["branch"] == "main" and len(data["commits"]) == 1, data
        assert data["commits"][0]["subject"] == "init", data

        # 从 Git 历史恢复：先创建安全备份，再回退工作区。
        current = client.get("/api/v1/backups", headers=headers).json()["data"]["currentRevision"]
        restored = client.post("/api/v1/git/restore", headers=headers, json={"commit": data["commits"][0]["id"], "expected_vault_revision": current})
        assert restored.status_code == 200, restored.text
        result = restored.json()["data"]
        assert result["restoredCommit"] == data["commits"][0]["id"], result
        assert result["safetyBackup"]["integrity"] == "verified", result

        # 过期的 Vault revision 会被拒绝。
        stale = client.post("/api/v1/git/restore", headers=headers, json={"commit": data["commits"][0]["id"], "expected_vault_revision": current})
        assert stale.status_code == 409 and stale.json()["error"]["code"] == "REVISION_CONFLICT", stale.text

        # 导入：预览后可写入候选，重复内容被去重，解析失败返回 400。
        preview = client.post("/api/v1/imports/preview", headers=headers, json={
            "format": "markdown",
            "content": "---\ntype: preference\nsubject: 工作流程\n---\n先计划后执行。\n",
        })
        assert preview.status_code == 200, preview.text
        assert preview.json()["data"]["summary"]["ready"] == 1, preview.text

        imported = client.post("/api/v1/imports", headers=headers, json={
            "items": [{"type": "preference", "subject": "工作流程", "content": "先计划后执行。"}],
            "source": "test-import",
        })
        assert imported.status_code == 201, imported.text
        assert len(imported.json()["data"]["created"]) == 1, imported.text

        again = client.post("/api/v1/imports", headers=headers, json={
            "items": [{"type": "preference", "subject": "工作流程", "content": "先计划后执行。"}],
        })
        assert again.status_code == 201
        assert again.json()["data"]["created"] == [], again.text

        bad = client.post("/api/v1/imports/preview", headers=headers, json={"format": "json", "content": "{"})
        assert bad.status_code == 400 and bad.json()["error"]["code"] == "IMPORT_PARSE_FAILED", bad.text

        # 按 vault_id 连接已登记的个人空间（路径不经过 Web）。
        current_id = client.get("/api/v1/vault", headers=headers).json()["data"]["vaultId"]
        registered = client.get("/api/v1/vaults", headers=headers).json()["data"]
        current = next((item for item in registered if item["vaultId"] == current_id), None)
        assert current is not None and "path" not in current, registered
        app.state.request_restart = lambda next_vault: None
        connected = client.post("/api/v1/vaults/connect", headers=headers, json={"vault_id": current_id})
        assert connected.status_code == 200, connected.text
        assert connected.json()["data"]["status"] == "restarting"

        missing = client.post("/api/v1/vaults/connect", headers=headers, json={"vault_id": "vault_missing"})
        assert missing.status_code == 404 and missing.json()["error"]["code"] == "VAULT_NOT_FOUND", missing.text

    print("local API and consistency tests passed")


if __name__ == "__main__":
    main()
