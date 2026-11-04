from __future__ import annotations

import hashlib
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))

import release_checksums as rc


def test_inno_setup_local_language_file() -> None:
    root = Path(__file__).resolve().parents[1]
    installer = (root / "packaging" / "windows" / "installer.iss").read_text(encoding="utf-8")
    assert 'MessagesFile: "ChineseSimplified.isl"' in installer
    language_file = root / "packaging" / "windows" / "ChineseSimplified.isl"
    assert language_file.is_file()
    assert "[LangOptions]" in language_file.read_text(encoding="utf-8-sig")


def main() -> None:
    test_inno_setup_local_language_file()
    assert rc.parse_version("v1.2.3") == "1.2.3"
    assert rc.parse_version("refs/tags/v2.0.0") == "2.0.0"
    assert rc.parse_version("1.0.0") == "1.0.0"
    assert rc.parse_version("  v0.9.1  ") == "0.9.1"

    with tempfile.TemporaryDirectory() as tmp:
        artifact = Path(tmp) / "app.exe"
        payload = b"hello world\n"
        artifact.write_bytes(payload)
        assert rc.sha256(artifact) == hashlib.sha256(payload).hexdigest()

    print("release packaging tests passed")


if __name__ == "__main__":
    main()
