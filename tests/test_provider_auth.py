"""Provider authorization: per-call approval, data minimization and audit."""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from core import provider_auth


def main() -> None:
    original_root = provider_auth.app_data_root
    with tempfile.TemporaryDirectory() as tmp:
        provider_auth.app_data_root = lambda: Path(tmp)  # noqa: E731 - test isolation
        try:
            assert provider_auth.list_providers() == []

            # No provider => every call is denied.
            try:
                provider_auth.prepare_call("local-llm", "reflection:summary", {"summary": "x"})
                raise AssertionError("unauthorized provider was accepted")
            except provider_auth.ProviderAuthError as exc:
                assert "不存在或未启用" in str(exc), exc

            provider_auth.authorize_provider("local-llm", ["reflection:summary"])
            assert [item["provider"] for item in provider_auth.list_providers()] == ["local-llm"]

            try:
                provider_auth.authorize_provider("other", ["bogus"])
                raise AssertionError("unknown scope was accepted")
            except provider_auth.ProviderAuthError as exc:
                assert "未知 Scope" in str(exc), exc

            # A scope outside the authorization is denied.
            try:
                provider_auth.prepare_call("local-llm", "memory:search", {"query": "x"})
                raise AssertionError("unauthorized scope was accepted")
            except provider_auth.ProviderAuthError as exc:
                assert "未授权 Scope" in str(exc), exc

            # Data minimization: only allowlisted fields survive.
            preview = provider_auth.prepare_call(
                "local-llm", "reflection:summary",
                {"dimension": "mind", "summary": "这个月更关注节奏。", "secret": "ghp_" + "a" * 36, "vaultPath": "/tmp/vault"},
            )
            assert preview["preview"] == {"dimension": "mind", "summary": "这个月更关注节奏。"}, preview
            assert set(preview["droppedFields"]) == {"secret", "vaultPath"}, preview
            assert preview["status"] == "pending"
            assert provider_auth.pending_calls()[0]["requestId"] == preview["requestId"]

            # Denying returns no payload and records the audit entry.
            denied = provider_auth.decide_call(preview["requestId"], "deny", "user-rejected")
            assert denied["decision"] == "denied" and denied["payload"] == {}, denied
            log = provider_auth.audit_log()
            assert log["integrity"]["status"] == "verified" and log["integrity"]["events"] == 1, log
            assert log["items"][0]["result"] == "denied", log
            assert log["items"][0]["details"]["droppedFields"] == ["secret", "vaultPath"], log
            assert "ghp_" not in str(log), log

            # Approving returns only the minimized payload.
            second = provider_auth.prepare_call("local-llm", "reflection:summary", {"dimension": "body", "summary": "多运动。", "extra": "drop"})
            approved = provider_auth.decide_call(second["requestId"], "approve")
            assert approved["decision"] == "approved" and approved["payload"] == {"dimension": "body", "summary": "多运动。"}, approved
            assert provider_auth.pending_calls() == []

            try:
                provider_auth.decide_call(second["requestId"], "approve")
                raise AssertionError("replayed decision was accepted")
            except provider_auth.ProviderAuthError as exc:
                assert "未找到待确认" in str(exc), exc

            assert provider_auth.audit_log()["integrity"]["events"] == 2

            # Revocation keeps the audit trail intact.
            provider_auth.revoke_provider("local-llm")
            assert provider_auth.list_providers() == []
            try:
                provider_auth.prepare_call("local-llm", "reflection:summary", {"summary": "x"})
                raise AssertionError("revoked provider was accepted")
            except provider_auth.ProviderAuthError:
                pass
        finally:
            provider_auth.app_data_root = original_root

    print("provider authorization, minimization and audit tests passed")


if __name__ == "__main__":
    main()
