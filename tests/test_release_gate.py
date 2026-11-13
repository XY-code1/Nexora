from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from scripts.check_release import scan

with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary)
    clean = root / "clean.txt"
    clean.write_text("public template without personal data", encoding="utf-8")
    assert scan([clean], root) == []

    windows = root / "windows.txt"
    windows.write_text("C:\\Users\\private-person\\vault\\Profile.md", encoding="utf-8")
    assert any("Windows user path" in item for item in scan([windows], root))

    secret = root / "secret.txt"
    secret.write_text("github" + "_pat_" + "abcdefghijklmnopqrstuvwxyz123456", encoding="utf-8")
    assert any("GitHub credential" in item for item in scan([secret], root))

print("release privacy gate tests passed")
