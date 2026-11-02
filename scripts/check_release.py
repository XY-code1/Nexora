#!/usr/bin/env python3
"""Fail a public release when tracked/build files contain high-confidence leaks."""

from __future__ import annotations

import argparse
import re
import subprocess
from pathlib import Path

PATTERNS = {
    "Windows user path": re.compile(r"[A-Za-z]:[\\/]" + r"Users[\\/][^\\/\s]+[\\/]", re.IGNORECASE),
    "macOS user path": re.compile(r"/" + r"Users/[^/\s]+/"),
    "Linux home path": re.compile(r"/" + r"home/[^/\s]+/"),
    "private key": re.compile(r"-----BEGIN " + r"(?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "GitHub credential": re.compile(r"\b" + r"(?:gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b"),
    "OpenAI credential": re.compile(r"\b" + r"sk-[A-Za-z0-9_-]{20,}\b"),
}


def tracked_files(root: Path) -> list[Path]:
    output = subprocess.check_output(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=root)
    files = [root / item.decode("utf-8") for item in output.split(b"\0") if item]
    dist = root / "apps" / "web" / "dist"
    if dist.is_dir():
        files.extend(path for path in dist.rglob("*") if path.is_file())
    return files


def scan(files: list[Path], root: Path) -> list[str]:
    findings: list[str] = []
    for path in files:
        if not path.is_file() or path.stat().st_size > 5_000_000:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for label, pattern in PATTERNS.items():
            match = pattern.search(text)
            if match:
                try:
                    display = path.relative_to(root)
                except ValueError:
                    display = path
                line = text.count("\n", 0, match.start()) + 1
                findings.append(f"{display}:{line}: {label}")
    return findings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).parents[1])
    args = parser.parse_args()
    root = args.root.resolve()
    findings = scan(tracked_files(root), root)
    if findings:
        print("Release privacy gate failed:")
        print("\n".join(f"- {finding}" for finding in findings))
        return 1
    print("release privacy gate passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
