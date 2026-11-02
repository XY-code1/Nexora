#!/usr/bin/env python3
"""Compatibility CLI for the extracted personal profile core."""

from __future__ import annotations

import argparse

from core.profile import *  # noqa: F403 - public compatibility surface


def main() -> None:
    parser = argparse.ArgumentParser(prog="profile")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("init", "validate", "build-context", "human3", "list-pending"):
        cmd = commands.add_parser(name)
        cmd.add_argument("path")

    cmd = commands.add_parser("remember")
    cmd.add_argument("path")
    cmd.add_argument("text")
    cmd.add_argument("--type", dest="memory_type", default="note")
    cmd.add_argument("--subject", default="")

    for name in ("preview", "confirm", "show-source"):
        cmd = commands.add_parser(name)
        cmd.add_argument("path")
        cmd.add_argument("file")

    cmd = commands.add_parser("edit")
    cmd.add_argument("path")
    cmd.add_argument("file")
    cmd.add_argument("text")

    for name in ("reject", "forget"):
        cmd = commands.add_parser(name)
        cmd.add_argument("path")
        cmd.add_argument("file")
        cmd.add_argument("--reason", default="user-request")

    cmd = commands.add_parser("supersede")
    cmd.add_argument("path")
    cmd.add_argument("file")
    cmd.add_argument("text")

    actions = {
        "init": init, "validate": validate, "remember": remember,
        "list-pending": list_pending, "preview": preview, "edit": edit_candidate,
        "confirm": confirm, "reject": reject, "show-source": show_source,
        "forget": forget, "supersede": supersede,
        "build-context": build_context, "human3": human3,
    }
    args = vars(parser.parse_args())
    command = args.pop("command")
    actions[command](**args)


if __name__ == "__main__":
    main()
