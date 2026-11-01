import subprocess
import sys
import tempfile
from pathlib import Path


def main():
    root = Path(__file__).parents[1]
    with tempfile.TemporaryDirectory() as tmp:
        vault = Path(tmp) / "vault"
        run = lambda *args: subprocess.run(
            [sys.executable, str(root / "profile.py"), *args],
            check=True, capture_output=True, text=True
        )
        run("init", str(vault))
        run("remember", str(vault), "喜欢先给结论")
        candidate = next((vault / "30 Memory" / "Inbox").glob("*.md"))
        run("confirm", str(vault), candidate.name)
        run("build-context", str(vault))
        run("human3", str(vault))
        run("validate", str(vault))
        assert next((vault / "30 Memory" / "Confirmed").glob("*.md"))
        assert (vault / "90 System" / "Indexes" / "ai-context.md").is_file()
    print("smoke test passed")


if __name__ == "__main__":
    main()

