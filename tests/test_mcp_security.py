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

        try:
            m.get_current_context()
            raise AssertionError("scope check failed open")
        except PermissionError:
            pass
    print("MCP security tests passed")


if __name__ == "__main__":
    main()
