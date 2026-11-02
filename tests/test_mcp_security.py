import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

import mcp_server as m
import profile as profile_cli


def main():
    assert m.get_access_level("# no frontmatter") == "denied"
    assert m.get_access_level("---\nai_access: nonsense\n---\nsecret") == "denied"
    assert "secret" not in m.apply_access("---\nai_access: summary-only\n---\nsecret")
    assert m.extract_summary("---\nai_access: summary-only\n---\n## 摘要\nsafe\n\n## Detail\nprivate") == "safe"

    with tempfile.TemporaryDirectory() as tmp:
        vault = Path(tmp) / "vault"
        profile_cli.init(str(vault))
        os.environ["PROFILE_VAULT"] = str(vault)
        os.environ["PROFILE_AGENT_ID"] = "security-test"
        os.environ["PROFILE_SCOPES"] = "profile:read,memory:pending,memory:propose"
        assert "Profile" in m.get_profile()

        denied = vault / "30 Memory" / "Inbox" / "denied.md"
        denied.write_text("---\nai_access: denied\n---\nsecret", encoding="utf-8")
        assert not m.list_pending()

        m.propose_memory("跨AI共享候选记忆", memory_type="preference", subject="sharing")
        pending = m.list_pending()
        assert len(pending) == 1 and "跨AI共享" in pending[0]["content"]
        candidate = next(file for file in (vault / "30 Memory" / "Inbox").glob("*.md") if file.name != "denied.md")
        metadata, _ = profile_cli.read_record(candidate)
        assert metadata["source_agent"] == "security-test"
        assert metadata["type"] == "preference"

        try:
            m.get_current_context()
            raise AssertionError("scope check failed open")
        except PermissionError:
            pass
    print("MCP security tests passed")


if __name__ == "__main__":
    main()
