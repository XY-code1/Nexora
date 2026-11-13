import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

import profile

import mcp_server
from core import profile as core_profile
from core.access import apply_access, get_access_level


def main():
    assert profile.remember is core_profile.remember
    assert profile.parse_record is core_profile.parse_record

    cases = {
        "allowed": "private body",
        "summary-only": "safe",
        "local-only": "local-only",
        "denied": "禁止读取",
        "invalid": "禁止读取",
    }
    for level, expected in cases.items():
        text = f"---\nai_access: {level}\n---\n\n## 摘要\n\nsafe\n\n## Detail\n\nprivate body"
        assert expected in apply_access(text)
        assert mcp_server.get_access_level(text) == get_access_level(text)

    assert get_access_level("# missing frontmatter") == "denied"
    print("core behavior contract passed")


if __name__ == "__main__":
    main()
