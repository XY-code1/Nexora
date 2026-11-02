#!/usr/bin/env python3
"""Generate SHA-256 checksums for release artifacts."""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_version(tag: str) -> str:
    """Normalize a release tag to a semver string, e.g. 'v1.2.3' -> '1.2.3'."""
    value = tag.strip()
    if value.startswith("refs/tags/"):
        value = value[len("refs/tags/"):]
    return value[1:] if value.startswith("v") else value


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate SHA-256 checksums.")
    parser.add_argument("files", nargs="+", type=Path, help="Artifact files to checksum.")
    parser.add_argument("--output", type=Path, help="Write the checksum manifest to this file.")
    args = parser.parse_args()

    lines = [f"{sha256(path)}  {path.name}" for path in sorted(args.files) if path.is_file()]
    text = "\n".join(lines) + ("\n" if lines else "")
    if args.output:
        args.output.write_text(text, encoding="utf-8")
    else:
        print(text, end="")
    return 0


if __name__ == "__main__":
    sys.exit(main())
