#!/usr/bin/env python3
"""Minimal local-first personal profile CLI; standard library only."""

from __future__ import annotations

import argparse
import re
import shutil
import sys
import uuid
from datetime import date
from pathlib import Path

ROOT = Path(__file__).parent
REQUIRED = ["10 Profile/Profile.md", "00 Dashboard/Current Context.md", "AGENTS.md", "profile.config.yml"]
SECRET_PATTERNS = {
    "private key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "GitHub token": re.compile(r"\b(?:gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b"),
    "generic secret": re.compile(r"(?i)\b(api[_ -]?key|token|password|secret)\s*[:=]\s*[^\s<>{}]{8,}"),
}


def vault(path: str) -> Path:
    return Path(path).expanduser().resolve()


def init(path: str) -> None:
    target = vault(path)
    if target.exists() and any(target.iterdir()):
        raise SystemExit(f"目标目录非空：{target}")
    shutil.copytree(ROOT / "template", target, dirs_exist_ok=True)
    print(f"已初始化：{target}")


def markdown_files(root: Path):
    yield from root.rglob("*.md")


def validate(path: str) -> None:
    root = vault(path)
    errors: list[str] = []
    for name in REQUIRED:
        if not (root / name).is_file():
            errors.append(f"缺少 {name}")
    for file in markdown_files(root):
        text = file.read_text(encoding="utf-8")
        for label, pattern in SECRET_PATTERNS.items():
            if pattern.search(text):
                errors.append(f"{file.relative_to(root)}：疑似 {label}")
    if errors:
        print("验证失败：")
        print("\n".join(f"- {item}" for item in errors))
        raise SystemExit(1)
    print("验证通过：结构完整，未发现已知秘密模式。")


def remember(path: str, text: str, source_agent: str = "local-cli") -> None:
    root = vault(path)
    day = date.today().isoformat()
    record_id = f"mem-{day.replace('-', '')}-{uuid.uuid4().hex[:8]}"
    destination = root / "30 Memory" / "Inbox" / f"{day}-{record_id}.md"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        f"---\nid: {record_id}\nstatus: candidate\ncreated: {day}\n"
        f"visibility: private\nai_access: summary-only\nsource_agent: {source_agent}\n---\n\n"
        f"# 候选记忆\n\n## 摘要\n\n{text.strip()}\n",
        encoding="utf-8",
    )
    print(f"候选记忆已创建：{destination}")


def confirm(path: str, file: str) -> None:
    root = vault(path)
    source = (root / "30 Memory" / "Inbox" / file).resolve()
    inbox = (root / "30 Memory" / "Inbox").resolve()
    if inbox not in source.parents or not source.is_file():
        raise SystemExit("只能确认 memory/inbox 中存在的文件。")
    text = source.read_text(encoding="utf-8").replace("status: candidate", "status: confirmed", 1)
    destination = root / "30 Memory" / "Confirmed" / source.name
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(text, encoding="utf-8")
    source.unlink()
    print(f"已确认：{destination}")


def section(file: Path, limit: int = 3000) -> str:
    if not file.is_file():
        return "（暂无）"
    return file.read_text(encoding="utf-8").strip()[:limit]


def build_context(path: str) -> None:
    root = vault(path)
    destination = root / "90 System" / "Indexes" / "ai-context.md"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        "# AI Context\n\n> 自动生成；只包含任务所需的最小上下文。\n\n"
        f"## Profile\n\n{section(root / '10 Profile' / 'Profile.md')}\n\n"
        f"## Current Context\n\n{section(root / '00 Dashboard' / 'Current Context.md')}\n",
        encoding="utf-8",
    )
    print(f"上下文已生成：{destination}")


def human3(path: str) -> None:
    root = vault(path)
    day = date.today().isoformat()
    destination = root / "40 Reviews" / "Human3" / "Answers" / f"{day}.md"
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        raise SystemExit(f"今日问卷已存在：{destination}")
    questions = (ROOT / "prompts" / "human3-questions.md").read_text(encoding="utf-8")
    destination.write_text(
        f"---\nassessment: human3\ndate: {day}\nstatus: draft\nai_access: summary-only\n---\n\n{questions}",
        encoding="utf-8",
    )
    print(f"问卷已创建：{destination}")


def main() -> None:
    parser = argparse.ArgumentParser(prog="profile")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("init", "validate", "build-context", "human3"):
        cmd = commands.add_parser(name)
        cmd.add_argument("path")
    cmd = commands.add_parser("remember")
    cmd.add_argument("path")
    cmd.add_argument("text")
    cmd = commands.add_parser("confirm")
    cmd.add_argument("path")
    cmd.add_argument("file")
    args = parser.parse_args()
    actions = {"init": init, "validate": validate, "remember": remember,
               "confirm": confirm, "build-context": build_context, "human3": human3}
    values = vars(args)
    command = values.pop("command")
    actions[command](**values)


if __name__ == "__main__":
    main()

