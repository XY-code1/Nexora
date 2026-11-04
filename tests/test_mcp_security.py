import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

import mcp_server as m
import profile as profile_cli
from core import security


def main():
    assert m.get_access_level("# no frontmatter") == "denied"
    assert m.get_access_level("---\nai_access: nonsense\n---\nsecret") == "denied"
    assert "secret" not in m.apply_access("---\nai_access: summary-only\n---\nsecret")
    assert m.extract_summary("---\nai_access: summary-only\n---\n## 摘要\nsafe\n\n## Detail\nprivate") == "safe"

    with tempfile.TemporaryDirectory() as tmp:
        vault = Path(tmp) / "vault"
        profile_cli.init(str(vault))
        os.environ["PROFILE_VAULT"] = str(vault)
        client, credential = security.create_client(vault, "Security Test", ["profile:read", "memory:pending", "memory:propose"])
        os.environ["PROFILE_AGENT_ID"] = client["id"]
        os.environ["PROFILE_CLIENT_TOKEN"] = credential
        assert "Profile" in m.get_profile()

        denied = vault / "30 Memory" / "Inbox" / "denied.md"
        denied.write_text("---\nai_access: denied\n---\nsecret", encoding="utf-8")
        assert m.list_pending()["totalPending"] == 1

        m.propose_memory("跨AI共享候选记忆", memory_type="preference", subject="sharing")
        pending = m.list_pending()
        assert pending["totalPending"] == 2
        assert pending["byType"] == {"note": 1, "preference": 1}
        assert "跨AI共享" not in str(pending)
        candidate = next(file for file in (vault / "30 Memory" / "Inbox").glob("*.md") if file.name != "denied.md")
        metadata, _ = profile_cli.read_record(candidate)
        assert metadata["source_agent"] == client["id"]
        assert metadata["type"] == "preference"

        try:
            m.get_current_context()
            raise AssertionError("scope check failed open")
        except PermissionError:
            pass

        security.update_scopes(vault, client["id"], ["profile:read", "memory:pending", "memory:propose", "assessment:read"])
        history = vault / "40 Reviews" / "Human3" / "History"
        (history / "z-rejected.md").write_text("---\nstatus: rejected\nai_access: summary-only\n---\n\n## 摘要\n\n不得返回", encoding="utf-8")
        (history / "a-confirmed.md").write_text("---\nstatus: confirmed\nai_access: summary-only\n---\n\n## 摘要\n\n已确认复盘", encoding="utf-8")
        result = m.get_human3_summary()
        assert result == "已确认复盘" and "不得返回" not in result
    print("MCP security tests passed")


if __name__ == "__main__":
    main()
