#!/usr/bin/env python3
"""Compatibility CLI for the extracted personal profile core."""

from __future__ import annotations

import argparse
from pathlib import Path

from core.profile import *  # noqa: F403 - public compatibility surface
from core.sync import sync_commit, sync_pull, sync_push, sync_status
from core.vault_management import create_backup, migrate_vault, preview_public_export, restore_backup, stage_public_export


def backup_command(path: str, destination: str | None = None) -> None:
    result = create_backup(Path(path), Path(destination) if destination else None)
    print(f"备份已创建：{result}")


def migrate_command(path: str) -> None:
    result = migrate_vault(Path(path))
    print(f"迁移完成，升级前备份：{result}" if result else "Vault schema已是最新版本。")


def restore_command(path: str, backup: str) -> None:
    restore_backup(Path(path), Path(backup))
    print("备份已恢复。")


def export_public_command(path: str, staging: str, files: list[str]) -> None:
    exported = stage_public_export(Path(path), files, Path(staging))
    print(f"已导出 {len(exported)} 个显式授权文件：{Path(staging).resolve()}")


def export_preview_command(path: str, files: list[str]) -> None:
    report = preview_public_export(Path(path), files)
    for item in report["files"]:
        tag = "可发布" if item["publishable"] else "会被拦截"
        print(f"\n[{tag}] {item['relative']}")
        for reason in item["reasons"]:
            print(f"  原因：{reason}")
        for match in item["secret_matches"]:
            print(f"  疑似敏感信息（{match['label']}）x{match['count']}")
        print("  --- 脱敏预览 ---")
        print(item["redacted_preview"][:2000])


def sync_status_command(path: str) -> None:
    info = sync_status(path)
    print(f"分支：{info['branch']}  远端：{info['upstream'] or '（未配置）'}")
    print(f"领先 {info['ahead']} / 落后 {info['behind']}")
    if info["dirty"]:
        print(f"未提交改动 {len(info['dirty'])} 处：")
        for line in info["dirty"]:
            print(f"  {line}")
    if info["unmerged"]:
        print("存在未解决的合并冲突：")
        for name in info["unmerged"]:
            print(f"  {name}")
    if not info["dirty"] and not info["unmerged"]:
        print("工作区干净。")


def sync_commit_command(path: str, message: str) -> None:
    head = sync_commit(path, message)
    print(f"已提交：{head}")


def sync_pull_command(path: str) -> None:
    result = sync_pull(path)
    print(f"同步完成（{result['status']}）：{result['head']}")


def sync_push_command(path: str) -> None:
    result = sync_push(path)
    print(f"已推送（{result['status']}）：{result['head']}")


def main() -> None:
    parser = argparse.ArgumentParser(prog="profile")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("init", "validate", "build-context", "human3", "list-pending"):
        cmd = commands.add_parser(name)
        cmd.add_argument("path")

    cmd = commands.add_parser("migrate")
    cmd.add_argument("path")

    cmd = commands.add_parser("backup")
    cmd.add_argument("path")
    cmd.add_argument("--destination")

    cmd = commands.add_parser("restore")
    cmd.add_argument("path")
    cmd.add_argument("backup")

    cmd = commands.add_parser("export-public")
    cmd.add_argument("path")
    cmd.add_argument("staging")
    cmd.add_argument("files", nargs="+")

    cmd = commands.add_parser("export-preview")
    cmd.add_argument("path")
    cmd.add_argument("files", nargs="+")

    for name in ("sync-status", "sync-pull", "sync-push"):
        cmd = commands.add_parser(name)
        cmd.add_argument("path")

    cmd = commands.add_parser("sync-commit")
    cmd.add_argument("path")
    cmd.add_argument("--message", "-m", default="chore: local memory update")

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
        "migrate": migrate_command, "backup": backup_command,
        "restore": restore_command, "export-public": export_public_command,
        "export-preview": export_preview_command,
        "sync-status": sync_status_command, "sync-commit": sync_commit_command,
        "sync-pull": sync_pull_command, "sync-push": sync_push_command,
    }
    args = vars(parser.parse_args())
    command = args.pop("command")
    actions[command](**args)


if __name__ == "__main__":
    main()
