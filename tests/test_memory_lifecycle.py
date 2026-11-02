import io
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))
import profile as p


def expect_exit(fn, contains: str):
    try:
        fn()
    except SystemExit as exc:
        assert contains in str(exc)
        return
    raise AssertionError("expected SystemExit")


def main():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp) / "vault"
        p.init(str(root))

        candidate = p.remember(
            str(root), "回答先给结论", source_agent="test-agent",
            memory_type="preference", subject="answer-style",
        )
        p.edit_candidate(str(root), candidate.name, "回答先给结论，再说明原因")
        p.confirm(str(root), candidate.name)
        confirmed = root / "30 Memory" / "Confirmed" / candidate.name
        assert confirmed.is_file()
        meta, _ = p.read_record(confirmed)
        assert meta["status"] == "confirmed"
        assert meta["source_agent"] == "test-agent"

        duplicate = p.remember(str(root), "回答先给结论，再说明原因")
        expect_exit(lambda: p.confirm(str(root), duplicate.name), "相同")
        p.reject(str(root), duplicate.name, "duplicate")
        assert (root / "30 Memory" / "Rejected" / duplicate.name).is_file()

        conflict = p.remember(
            str(root), "回答时先长篇分析", memory_type="preference", subject="answer-style"
        )
        expect_exit(lambda: p.confirm(str(root), conflict.name), "冲突")
        conflict_meta, _ = p.read_record(conflict)
        assert conflict_meta["status"] == "disputed"
        p.reject(str(root), conflict.name, "kept-existing")

        p.supersede(str(root), candidate.name, "默认简洁回答，需要时再展开")
        confirmed_files = list((root / "30 Memory" / "Confirmed").glob("*.md"))
        assert len(confirmed_files) == 1
        old_meta, _ = p.read_record(root / "30 Memory" / "Archived" / candidate.name)
        assert old_meta["status"] == "superseded"

        p.forget(str(root), confirmed_files[0].name, "user-request")
        forgotten_meta, _ = p.read_record(root / "30 Memory" / "Archived" / confirmed_files[0].name)
        assert forgotten_meta["status"] == "forgotten"

        with redirect_stdout(io.StringIO()) as output:
            p.list_pending(str(root))
        assert "暂无" in output.getvalue()
        p.validate(str(root))
    print("memory lifecycle passed")


if __name__ == "__main__":
    main()
