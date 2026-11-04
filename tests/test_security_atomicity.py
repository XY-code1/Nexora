from __future__ import annotations

import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import sys

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT))

from core import profile, security


def main() -> None:
    with tempfile.TemporaryDirectory() as temporary:
        vault = Path(temporary) / "vault"
        profile.init(str(vault))

        original = security._append_event_unlocked

        def fail_event(*_args, **_kwargs):
            raise OSError("synthetic audit write failure")

        security._append_event_unlocked = fail_event
        try:
            try:
                security.register_client(vault, "Must Roll Back", ["profile:read"])
                raise AssertionError("audit failure should abort registration")
            except OSError:
                pass
        finally:
            security._append_event_unlocked = original

        assert not security.list_clients(vault)
        assert security.verify_audit(vault)["status"] == "missing"
        assert not list((vault / "90 System" / "Transactions").glob("*.json"))

        def register(number: int) -> str:
            return security.register_client(vault, f"Concurrent {number}", ["profile:read"])["id"]

        with ThreadPoolExecutor(max_workers=6) as pool:
            ids = set(pool.map(register, range(12)))
        assert len(ids) == 12
        assert len(security.list_clients(vault)) == 12
        integrity = security.verify_audit(vault)
        assert integrity["status"] == "verified" and integrity["events"] == 12

        target, token = security.authorize_client(vault, next(iter(ids)))
        before_scopes = target["scopes"]
        security._append_event_unlocked = fail_event
        try:
            try:
                security.update_scopes(vault, target["id"], ["memory:search"])
                raise AssertionError("failed audit should roll back scope update")
            except OSError:
                pass
        finally:
            security._append_event_unlocked = original
        restored = next(item for item in security.list_clients(vault) if item["id"] == target["id"])
        assert restored["scopes"] == before_scopes
        assert security.verify_audit(vault)["status"] == "verified"

        try:
            security.authorize(vault, target["id"], "wrong-token", "profile:read", event_type="profile.read", resource_type="profile")
            raise AssertionError("invalid credential should be denied")
        except PermissionError:
            pass
        errored = next(item for item in security.list_clients(vault) if item["id"] == target["id"])
        assert errored["activity"] == "error"
        denied = security.query_events(vault, client_id=target["id"], result="denied")["items"]
        assert denied and denied[0]["reasonCode"] == "INVALID_CREDENTIAL"

        security.authorize(vault, target["id"], token, "profile:read", event_type="profile.read", resource_type="profile")
        recovered = next(item for item in security.list_clients(vault) if item["id"] == target["id"])
        assert recovered["activity"] == "recently_active"

        def access(_number: int) -> None:
            security.authorize(vault, target["id"], token, "profile:read", event_type="profile.read", resource_type="profile")

        with ThreadPoolExecutor(max_workers=6) as pool:
            list(pool.map(access, range(12)))
        assert security.verify_audit(vault)["status"] == "verified"

    print("security registry/audit atomicity and concurrency tests passed")


if __name__ == "__main__":
    main()
