import tempfile
import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parents[1]))

from apps.api import create_app
from core import profile
from core import security


def expect_failure(function, text: str) -> None:
    try:
        function()
    except SystemExit as exc:
        assert text in str(exc), exc
    else:
        raise AssertionError(f"expected failure containing: {text}")


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "vault"
        profile.init(str(root))
        client = TestClient(create_app(root, token="lifecycle-token"), base_url="http://localhost")
        headers = {"Authorization": "Bearer lifecycle-token"}

        # 未授权访问拒绝
        assert client.get("/api/v1/security/clients").status_code == 401

        # 1. 注册客户端（pending_authorization）
        view = security.register_client(root, "Claude Desktop", ["profile:read", "memory:search"])
        assert view["authorization"] == "pending_authorization" and view["activity"] == "never_connected"
        cid = view["id"]

        # 2. 重复注册同名拒绝
        expect_failure(lambda: security.register_client(root, "Claude Desktop", ["profile:read"]), "同名客户端")

        # 3. 授权：签发 token
        authorized, token = security.authorize_client(root, cid)
        assert authorized["authorization"] == "authorized" and token

        # 4. 重新签发：新 token，旧 token 立即失效
        reissued, new_token = security.reissue_token(root, cid)
        assert reissued["authorization"] == "authorized" and new_token != token

        # 5. 旧 token 失效：authorize 拒绝
        try:
            security.authorize(root, cid, token, "profile:read", event_type="profile.read", resource_type="profile")
            raise AssertionError("old token should be rejected")
        except PermissionError as exc:
            assert "INVALID_CREDENTIAL" in str(exc)

        # 新 token 有效：authorize 通过并更新 lastAccessAt
        security.authorize(root, cid, new_token, "profile:read", event_type="profile.read", resource_type="profile")
        current = next(c for c in security.list_clients(root) if c["id"] == cid)
        assert current["activity"] == "recently_active" and current["lastAccessAt"]

        # 6. 撤销授权立即生效
        security.revoke_client(root, cid)
        try:
            security.authorize(root, cid, new_token, "profile:read", event_type="profile.read", resource_type="profile")
            raise AssertionError("revoked client should be rejected")
        except PermissionError as exc:
            assert "CLIENT_REVOKED" in str(exc)

        # 7. 删除客户端（逻辑删除）
        deleted = security.delete_client(root, cid)
        assert deleted["authorization"] == "deleted"

        # 8. 删除后审计记录保留（仍能查到 client.deleted 等事件）
        events = security.query_events(root, page_size=200)["items"]
        cid_events = [event for event in events if event["details"].get("targetClientId") == cid]
        event_types = {event["eventType"] for event in cid_events}
        assert {"client.registered", "client.authorized", "client.token_reissued", "client.revoked", "client.deleted"} <= event_types

        # 删除后拒绝访问
        try:
            security.authorize(root, cid, new_token, "profile:read", event_type="profile.read", resource_type="profile")
            raise AssertionError("deleted client should be rejected")
        except PermissionError as exc:
            assert "CLIENT_DELETED" in str(exc)

        # 9. 多客户端权限隔离
        a, atoken = security.create_client(root, "Client A", ["profile:read"])
        b, btoken = security.create_client(root, "Client B", ["memory:search"])
        security.authorize(root, a["id"], atoken, "profile:read", event_type="profile.read", resource_type="profile")
        try:
            security.authorize(root, a["id"], atoken, "memory:search", event_type="memory.search", resource_type="memory")
            raise AssertionError("Client A should not have memory:search")
        except PermissionError as exc:
            assert "SCOPE_NOT_GRANTED" in str(exc)
        security.authorize(root, b["id"], btoken, "memory:search", event_type="memory.search", resource_type="memory")

        # 10. 服务重启后的状态恢复：新建 app 实例（同一 Vault）读取注册表
        restarted = TestClient(create_app(root, token="lifecycle-token"), base_url="http://localhost")
        restored = restarted.get("/api/v1/security/clients", headers=headers).json()["data"]
        ids = {item["id"] for item in restored}
        assert a["id"] in ids and b["id"] in ids and cid in ids
        assert next(item for item in restored if item["id"] == a["id"])["authorization"] == "authorized"

        # 11. 无效 token 拒绝访问（API 层）
        # MCP authorize 已经在上面覆盖了 INVALID_CREDENTIAL；这里再验证一个未注册客户端 id
        try:
            security.authorize(root, "client-not-registered", "whatever", "profile:read", event_type="profile.read", resource_type="profile")
            raise AssertionError("unknown client should be rejected")
        except PermissionError as exc:
            assert "UNKNOWN_CLIENT" in str(exc)

        # === C2 收尾补充测试 ===

        # 12. 删除后重新注册同名：生成独立 client_id，不继承旧权限
        re_reg = security.register_client(root, "Claude Desktop", ["assessment:read"])
        assert re_reg["id"] != cid and re_reg["authorization"] == "pending_authorization"
        assert re_reg["scopes"] == ["assessment:read"]

        # 13. 新增 authorize / reissue / delete 端点的未授权 401
        assert client.post(f"/api/v1/security/clients/{cid}/authorize").status_code == 401
        assert client.post(f"/api/v1/security/clients/{cid}/reissue").status_code == 401
        assert client.delete(f"/api/v1/security/clients/{cid}").status_code == 401

        # 14. pending 客户端不能更新权限
        expect_failure(lambda: security.update_scopes(root, re_reg["id"], ["memory:search"]), "只有已授权客户端")

        # 15. revoked 客户端不能更新权限，也不能重新授权
        rv = security.register_client(root, "Revoked Client", ["profile:read"])
        rv_view, _rv_token = security.authorize_client(root, rv["id"])
        security.revoke_client(root, rv["id"])
        expect_failure(lambda: security.update_scopes(root, rv["id"], ["memory:search"]), "只有已授权客户端")
        expect_failure(lambda: security.authorize_client(root, rv["id"]), "不能重新授权")

        # 16. deleted 客户端不能更新权限
        expect_failure(lambda: security.update_scopes(root, cid, ["memory:search"]), "只有已授权客户端")

        # 17. authorized 客户端不能通过 authorize 重复签发 Token（必须 reissue）
        au = security.register_client(root, "Authorized Client", ["profile:read"])
        au_view, au_token = security.authorize_client(root, au["id"])
        expect_failure(lambda: security.authorize_client(root, au["id"]), "请使用 reissue")
        au_re, au_new_token = security.reissue_token(root, au["id"])
        assert au_re["authorization"] == "authorized" and au_new_token != au_token

    print("security lifecycle tests passed")


if __name__ == "__main__":
    main()
