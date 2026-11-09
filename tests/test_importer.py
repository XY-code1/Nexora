from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))

from core import importer
from core import profile


def expect_failure(function, text: str) -> None:
    try:
        function()
    except importer.ImportError as exc:
        assert text in str(exc), exc
    else:
        raise AssertionError(f"expected failure containing: {text}")


with tempfile.TemporaryDirectory() as temporary:
    vault = Path(temporary) / "vault"
    profile.init(str(vault))

    markdown = """---
type: preference
subject: 回答风格
---

回答先给结论。

---
type: note
subject: 项目背景
---

本地优先。
"""
    items = importer.parse_input("markdown", markdown)
    assert len(items) == 2, items
    assert items[0]["type"] == "preference" and items[0]["subject"] == "回答风格", items[0]
    assert "回答先给结论" in items[0]["content"], items[0]

    preview = importer.preview_import(vault, "markdown", markdown)
    assert preview["summary"] == {"total": 2, "ready": 2, "duplicate": 0, "invalid": 0}, preview
    assert preview["items"][0]["status"] == "ready", preview

    result = importer.commit_import(vault, items, "test-import")
    assert len(result["created"]) == 2, result
    assert result["skipped"] == [], result
    assert len(list((vault / "30 Memory" / "Inbox").glob("*.md"))) == 2

    # 重复导入同一内容会被标记为重复，不会被再次写入
    preview = importer.preview_import(vault, "markdown", markdown)
    assert preview["summary"]["duplicate"] == 2 and preview["summary"]["ready"] == 0, preview
    result = importer.commit_import(vault, items)
    assert result["created"] == [] and len(result["skipped"]) == 2, result

    # JSON 解析与同主题去重
    json_text = '[{"type":"preference","subject":"工作流程","content":"先计划后执行。"}]'
    preview = importer.preview_import(vault, "json", json_text)
    assert preview["summary"]["ready"] == 1, preview
    result = importer.commit_import(vault, importer.parse_input("json", json_text))
    assert len(result["created"]) == 1, result

    same_subject = "---\ntype: preference\nsubject: 工作流程\n---\n另一种说法。"
    preview = importer.preview_import(vault, "markdown", same_subject)
    assert preview["summary"]["duplicate"] == 1, preview

    # 敏感内容在预览和提交阶段都被拒绝
    secret = "---\nsubject: 密钥\n---\nghp_" + "a" * 36 + "\n"
    preview = importer.preview_import(vault, "markdown", secret)
    assert preview["summary"]["invalid"] == 1, preview
    assert "敏感" in preview["items"][0]["reason"], preview
    result = importer.commit_import(vault, importer.parse_input("markdown", secret))
    assert result["created"] == [] and result["skipped"], result

    # JSON 中的空条目被标记为无效
    preview = importer.preview_import(vault, "json", '[{"type":"note","subject":"空","content":""}]')
    assert preview["summary"]["invalid"] == 1, preview

    # 只有空内容的 Markdown 输入视为没有条目
    expect_failure(lambda: importer.parse_input("markdown", "---\ntype: note\n---\n"), "没有解析到")

    # 输入级错误
    expect_failure(lambda: importer.parse_input("markdown", "   "), "没有解析到")
    expect_failure(lambda: importer.parse_input("yaml", "x"), "不支持的导入格式")
    expect_failure(lambda: importer.parse_input("json", "{"), "JSON 解析失败")

print("importer tests passed")
