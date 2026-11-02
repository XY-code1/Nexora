"""Authenticated loopback API for the local review client."""

from __future__ import annotations

import argparse
import secrets
import uuid
from pathlib import Path
from typing import Annotated, Any

import uvicorn
from fastapi import BackgroundTasks, Depends, FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware

from core import profile
from core.access import extract_summary
from core.visualization import human3_trend, privacy_audit, profile_overview, timeline
from core.vault_management import assert_vault_isolated, recover_vault_swap, require_current_schema, vault_operation_lock


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status = status
        self.code = code
        self.message = message


class CandidateInput(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    memory_type: str = Field(default="note", max_length=64)
    subject: str = Field(default="", max_length=200)


class EditInput(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    expected_revision: str = Field(pattern=r"^[0-9a-f]{64}$")


class ActionInput(BaseModel):
    expected_revision: str = Field(pattern=r"^[0-9a-f]{64}$")
    reason: str = Field(default="user-request", max_length=200)
    content: str = Field(default="", max_length=4000)


def envelope(data: Any, revision: str | None = None) -> dict[str, Any]:
    meta: dict[str, Any] = {"requestId": uuid.uuid4().hex}
    if revision:
        meta["revision"] = revision
    return {"data": data, "meta": meta}


def domain_error(exc: SystemExit) -> ApiError:
    message = str(exc)
    if "未找到" in message or "不存在" in message:
        return ApiError(404, "NOT_FOUND", message)
    if "其他进程修改" in message or "目标文件已存在" in message:
        return ApiError(409, "REVISION_CONFLICT", message)
    if "冲突" in message or "相同" in message:
        return ApiError(409, "MEMORY_CONFLICT", message)
    return ApiError(400, "INVALID_REQUEST", message)


def memory_view(root: Path, path: Path) -> dict[str, Any]:
    path = profile.safe_vault_file(root, path)
    metadata, body = profile.read_record(path)
    return {
        "id": metadata["id"],
        "status": metadata["status"],
        "type": metadata.get("type", "note"),
        "subject": metadata.get("subject", ""),
        "sourceAgent": metadata.get("source_agent", "unknown"),
        "created": metadata.get("created", ""),
        "updated": metadata.get("updated", ""),
        "content": extract_summary(body),
        "revision": profile.revision(path),
    }


def find(root: Path, folder: str, record_id: str) -> Path:
    with profile.vault_lock(root):
        try:
            return profile.record_by_id(root, folder, record_id)
        except SystemExit as exc:
            raise domain_error(exc) from None


def create_app(vault: Path, token: str | None = None, web_dist: Path | None = None) -> FastAPI:
    root = vault.expanduser().resolve()
    with vault_operation_lock(root):
        recover_vault_swap(root)
    missing = [name for name in profile.REQUIRED if not (root / name).is_file()]
    if missing:
        raise RuntimeError(f"私人档案结构不完整：{', '.join(missing)}")
    assert_vault_isolated(root)
    require_current_schema(root)

    app = FastAPI(title="Personal AI Profile Local API", version="0.1.0")
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])
    app.state.vault = root
    app.state.token = token or secrets.token_urlsafe(32)
    app.state.request_shutdown = None

    def authorize(authorization: Annotated[str | None, Header()] = None) -> None:
        scheme, _, credential = (authorization or "").partition(" ")
        if scheme.lower() != "bearer" or not secrets.compare_digest(credential, app.state.token):
            raise ApiError(401, "UNAUTHORIZED", "需要有效的本地启动会话。")

    auth = Depends(authorize)

    @app.exception_handler(ApiError)
    async def api_error(request: Request, exc: ApiError) -> JSONResponse:
        request_id = uuid.uuid4().hex
        return JSONResponse(
            status_code=exc.status,
            content={"error": {"code": exc.code, "message": exc.message, "details": {}}, "requestId": request_id},
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        request_id = uuid.uuid4().hex
        return JSONResponse(
            status_code=422,
            content={
                "error": {"code": "VALIDATION_ERROR", "message": "请求数据格式无效。", "details": exc.errors()},
                "requestId": request_id,
            },
        )

    @app.get("/api/v1/health")
    def health() -> dict[str, Any]:
        return envelope({"status": "ok", "schemaVersion": 1, "vaultReady": True})

    @app.get("/api/v1/capabilities", dependencies=[auth])
    def capabilities() -> dict[str, Any]:
        return envelope({"memoryLifecycle": True, "visualization": True, "revisionControl": True, "fileLock": True, "shutdown": callable(app.state.request_shutdown)})

    @app.get("/api/v1/visualization/profile", dependencies=[auth])
    def visualization_profile() -> dict[str, Any]:
        with profile.vault_lock(root):
            return envelope(profile_overview(root))

    @app.get("/api/v1/visualization/timeline", dependencies=[auth])
    def visualization_timeline(limit: int = 100) -> dict[str, Any]:
        with profile.vault_lock(root):
            return envelope(timeline(root, max(1, min(limit, 100))))

    @app.get("/api/v1/visualization/privacy", dependencies=[auth])
    def visualization_privacy() -> dict[str, Any]:
        with profile.vault_lock(root):
            return envelope(privacy_audit(root))

    @app.get("/api/v1/visualization/human3", dependencies=[auth])
    def visualization_human3() -> dict[str, Any]:
        with profile.vault_lock(root):
            return envelope(human3_trend(root))

    @app.post("/api/v1/shutdown", dependencies=[auth])
    def shutdown(background_tasks: BackgroundTasks) -> dict[str, Any]:
        callback = app.state.request_shutdown
        if not callable(callback):
            raise ApiError(503, "SHUTDOWN_UNAVAILABLE", "当前启动方式不支持远程关闭。")
        background_tasks.add_task(callback)
        return envelope({"status": "shutting-down"})

    @app.get("/api/v1/memories", dependencies=[auth])
    def list_memories(status: str = "candidate", limit: int = 50) -> dict[str, Any]:
        folders = {"candidate": "Inbox", "confirmed": "Confirmed", "rejected": "Rejected", "archived": "Archived"}
        if status not in folders:
            raise ApiError(400, "INVALID_STATUS", "不支持的记忆状态筛选。")
        with profile.vault_lock(root):
            files = sorted((root / profile.MEMORY_ROOT / folders[status]).glob("*.md"))[:max(1, min(limit, 100))]
            return envelope([memory_view(root, path) for path in files])

    @app.get("/api/v1/memories/{record_id}", dependencies=[auth])
    def get_memory(record_id: str) -> dict[str, Any]:
        with profile.vault_lock(root):
            for folder in ("Inbox", "Confirmed", "Rejected", "Archived"):
                try:
                    return envelope(memory_view(root, profile.record_by_id(root, folder, record_id)))
                except SystemExit:
                    pass
        raise ApiError(404, "NOT_FOUND", f"未找到记忆：{record_id}")

    @app.post("/api/v1/memories/candidates", status_code=201, dependencies=[auth])
    def create_candidate(data: CandidateInput) -> dict[str, Any]:
        try:
            path = profile.remember(str(root), data.content, "local-api", data.memory_type, data.subject)
        except SystemExit as exc:
            raise domain_error(exc) from None
        with profile.vault_lock(root):
            view = memory_view(root, path)
            return envelope(view, view["revision"])

    @app.patch("/api/v1/memories/{record_id}", dependencies=[auth])
    def edit_candidate(record_id: str, data: EditInput) -> dict[str, Any]:
        path = find(root, "Inbox", record_id)
        try:
            profile.edit_candidate(str(root), path.name, data.content, data.expected_revision)
        except SystemExit as exc:
            raise domain_error(exc) from None
        path = find(root, "Inbox", record_id)
        return envelope(memory_view(root, path), profile.revision(path))

    def lifecycle(record_id: str, data: ActionInput, action: str) -> dict[str, Any]:
        folder = "Confirmed" if action in {"forget", "supersede"} else "Inbox"
        path = find(root, folder, record_id)
        try:
            if action == "confirm":
                profile.confirm(str(root), path.name, data.expected_revision)
            elif action == "reject":
                profile.reject(str(root), path.name, data.reason, data.expected_revision)
            elif action == "forget":
                profile.forget(str(root), path.name, data.reason, data.expected_revision)
            elif action == "supersede":
                if not data.content.strip():
                    raise ApiError(400, "INVALID_REQUEST", "替代记忆不能为空。")
                profile.supersede(str(root), path.name, data.content, data.expected_revision)
        except SystemExit as exc:
            raise domain_error(exc) from None
        return envelope({"id": record_id, "action": action, "status": "completed"})

    @app.post("/api/v1/memories/{record_id}/confirm", dependencies=[auth])
    def confirm(record_id: str, data: ActionInput) -> dict[str, Any]:
        return lifecycle(record_id, data, "confirm")

    @app.post("/api/v1/memories/{record_id}/reject", dependencies=[auth])
    def reject(record_id: str, data: ActionInput) -> dict[str, Any]:
        return lifecycle(record_id, data, "reject")

    @app.post("/api/v1/memories/{record_id}/forget", dependencies=[auth])
    def forget(record_id: str, data: ActionInput) -> dict[str, Any]:
        return lifecycle(record_id, data, "forget")

    @app.post("/api/v1/memories/{record_id}/supersede", dependencies=[auth])
    def supersede(record_id: str, data: ActionInput) -> dict[str, Any]:
        return lifecycle(record_id, data, "supersede")

    web_dist = web_dist or Path(__file__).parents[1] / "web" / "dist"
    index = web_dist / "index.html"
    if index.is_file():
        @app.get("/{path:path}", include_in_schema=False)
        def web(path: str) -> FileResponse:
            candidate = (web_dist / path).resolve()
            try:
                candidate.relative_to(web_dist.resolve())
            except ValueError:
                candidate = index
            return FileResponse(candidate if candidate.is_file() else index, headers={"Cache-Control": "no-store"})

    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="启动本地 Personal AI Profile API")
    parser.add_argument("--vault", required=True, type=Path)
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    app = create_app(args.vault)
    print(f"Local API: http://127.0.0.1:{args.port}  Bearer token: {app.state.token}")
    uvicorn.run(app, host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
