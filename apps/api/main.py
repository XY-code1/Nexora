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
from core.onboarding import onboarding_state, propose_answer
from core.human3 import confirm_session, current_session, save_conclusion, save_dimension, session_view, start_session
from core import monthly_reflection
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


class OnboardingInput(BaseModel):
    topic: str = Field(min_length=1, max_length=40)
    content: str = Field(min_length=1, max_length=1000)
    consent: bool


class Human3DimensionInput(BaseModel):
    reflection: str = Field(min_length=1, max_length=2000)
    evidence: str = Field(default="", max_length=1200)
    evidence_state: str = Field(pattern=r"^(sufficient|limited|insufficient)$")
    score: float = Field(ge=0, le=10)
    expected_revision: str = Field(pattern=r"^[0-9a-f]{64}$")


class Human3ConclusionInput(BaseModel):
    summary: str = Field(min_length=1, max_length=1600)
    plan: str = Field(min_length=1, max_length=1600)
    expected_revision: str = Field(pattern=r"^[0-9a-f]{64}$")


class RevisionInput(BaseModel):
    expected_revision: str = Field(pattern=r"^[0-9a-f]{64}$")


class MonthlyCreateInput(BaseModel):
    month: str = Field(pattern=r"^\d{4}-(?:0[1-9]|1[0-2])$")


class MonthlyDimensionInput(BaseModel):
    content: str = Field(default="", max_length=5000)
    expected_revision: str = Field(pattern=r"^[0-9a-f]{64}$")


class MonthlyEventInput(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    dimension: str = Field(pattern=r"^(mind|body|spirit|vocation)$")
    description: str = Field(default="", max_length=1200)
    feeling: str = Field(default="", max_length=500)
    project: str = Field(default="", max_length=120)
    expected_revision: str = Field(pattern=r"^[0-9a-f]{64}$")


class MonthlyGoalsInput(BaseModel):
    goals: list[dict[str, Any]] = Field(max_length=30)
    expected_revision: str = Field(pattern=r"^[0-9a-f]{64}$")


class MonthlySummaryInput(BaseModel):
    summary: str = Field(min_length=1, max_length=2400)
    expected_revision: str = Field(pattern=r"^[0-9a-f]{64}$")


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
    if "冲突" in message or "相同" in message or "已存在" in message:
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
        "visibility": metadata.get("visibility", "private"),
        "aiAccess": metadata.get("ai_access", "denied"),
        "tags": [item.strip() for item in metadata.get("tags", "").split(",") if item.strip()][:20],
        "content": extract_summary(body),
        "revision": profile.revision(path),
    }


def memory_stats(root: Path) -> dict[str, int]:
    counts = {"candidateMemories": 0, "pendingReview": 0, "confirmedMemories": 0}
    for folder, target in (("Inbox", "pendingReview"), ("Confirmed", "confirmedMemories")):
        for path in (root / profile.MEMORY_ROOT / folder).glob("*.md"):
            metadata, _ = profile.read_record(profile.safe_vault_file(root, path))
            counts[target] += 1
            if folder == "Inbox" and metadata.get("status") == "candidate":
                counts["candidateMemories"] += 1
    return counts


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
        return envelope({"memoryLifecycle": True, "visualization": True, "onboarding": True, "human3Reflection": True, "revisionControl": True, "fileLock": True, "shutdown": callable(app.state.request_shutdown)})

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

    @app.get("/api/v1/onboarding", dependencies=[auth])
    def get_onboarding() -> dict[str, Any]:
        with profile.vault_lock(root):
            return envelope(onboarding_state(root))

    @app.post("/api/v1/onboarding/responses", status_code=201, dependencies=[auth])
    def onboarding_response(data: OnboardingInput) -> dict[str, Any]:
        if data.consent is not True:
            raise ApiError(400, "CONSENT_REQUIRED", "只有明确同意后才能创建候选记忆。")
        try:
            path = propose_answer(root, data.topic, data.content)
        except SystemExit as exc:
            raise domain_error(exc) from None
        with profile.vault_lock(root):
            return envelope({"candidateId": profile.read_record(path)[0]["id"], "state": onboarding_state(root)})

    @app.get("/api/v1/human3/session", dependencies=[auth])
    def get_human3_session() -> dict[str, Any]:
        with profile.vault_lock(root):
            return envelope({"session": current_session(root)})

    @app.post("/api/v1/human3/session", status_code=201, dependencies=[auth])
    def create_human3_session() -> dict[str, Any]:
        try:
            path = start_session(str(root))
        except SystemExit as exc:
            raise domain_error(exc) from None
        with profile.vault_lock(root):
            return envelope({"session": session_view(root, path)})

    @app.put("/api/v1/human3/session/{session_id}/dimensions/{dimension}", dependencies=[auth])
    def update_human3_dimension(session_id: str, dimension: str, data: Human3DimensionInput) -> dict[str, Any]:
        try:
            path = save_dimension(str(root), session_id, dimension, data.reflection, data.evidence, data.evidence_state, data.score, data.expected_revision)
        except SystemExit as exc:
            raise domain_error(exc) from None
        with profile.vault_lock(root):
            return envelope({"session": session_view(root, path)})

    @app.put("/api/v1/human3/session/{session_id}/conclusion", dependencies=[auth])
    def update_human3_conclusion(session_id: str, data: Human3ConclusionInput) -> dict[str, Any]:
        try:
            path = save_conclusion(str(root), session_id, data.summary, data.plan, data.expected_revision)
        except SystemExit as exc:
            raise domain_error(exc) from None
        with profile.vault_lock(root):
            return envelope({"session": session_view(root, path)})

    @app.post("/api/v1/human3/session/{session_id}/confirm", dependencies=[auth])
    def confirm_human3_session(session_id: str, data: RevisionInput) -> dict[str, Any]:
        try:
            destination = confirm_session(str(root), session_id, data.expected_revision)
        except SystemExit as exc:
            raise domain_error(exc) from None
        return envelope({"id": session_id, "status": "confirmed", "file": destination.name})

    @app.get("/api/v1/monthly-reflections", dependencies=[auth])
    def monthly_overview() -> dict[str, Any]:
        with profile.vault_lock(root):
            return envelope(monthly_reflection.overview(root))

    @app.get("/api/v1/monthly-reflections/{reflection_id}", dependencies=[auth])
    def monthly_get(reflection_id: str) -> dict[str, Any]:
        with profile.vault_lock(root):
            try:
                return envelope(monthly_reflection.reflection_view(root, monthly_reflection._find(root, reflection_id)))
            except SystemExit as exc:
                raise domain_error(exc) from None

    @app.post("/api/v1/monthly-reflections", status_code=201, dependencies=[auth])
    def monthly_create(data: MonthlyCreateInput) -> dict[str, Any]:
        try:
            path = monthly_reflection.create(str(root), data.month)
        except SystemExit as exc:
            raise domain_error(exc) from None
        with profile.vault_lock(root):
            return envelope(monthly_reflection.reflection_view(root, path))

    @app.put("/api/v1/monthly-reflections/{reflection_id}/dimensions/{dimension}", dependencies=[auth])
    def monthly_dimension(reflection_id: str, dimension: str, data: MonthlyDimensionInput) -> dict[str, Any]:
        try:
            path = monthly_reflection.save_dimension(str(root), reflection_id, dimension, data.content, data.expected_revision)
        except SystemExit as exc:
            raise domain_error(exc) from None
        with profile.vault_lock(root):
            return envelope(monthly_reflection.reflection_view(root, path))

    @app.post("/api/v1/monthly-reflections/{reflection_id}/events", dependencies=[auth])
    def monthly_add_event(reflection_id: str, data: MonthlyEventInput) -> dict[str, Any]:
        try:
            path = monthly_reflection.add_event(str(root), reflection_id, data.model_dump(exclude={"expected_revision"}), data.expected_revision)
        except SystemExit as exc:
            raise domain_error(exc) from None
        with profile.vault_lock(root):
            return envelope(monthly_reflection.reflection_view(root, path))

    @app.delete("/api/v1/monthly-reflections/{reflection_id}/events/{event_id}", dependencies=[auth])
    def monthly_delete_event(reflection_id: str, event_id: str, expected_revision: str) -> dict[str, Any]:
        try:
            path = monthly_reflection.delete_event(str(root), reflection_id, event_id, expected_revision)
        except SystemExit as exc:
            raise domain_error(exc) from None
        with profile.vault_lock(root):
            return envelope(monthly_reflection.reflection_view(root, path))

    @app.put("/api/v1/monthly-reflections/{reflection_id}/goals", dependencies=[auth])
    def monthly_goals(reflection_id: str, data: MonthlyGoalsInput) -> dict[str, Any]:
        try:
            path = monthly_reflection.save_goals(str(root), reflection_id, data.goals, data.expected_revision)
        except SystemExit as exc:
            raise domain_error(exc) from None
        with profile.vault_lock(root):
            return envelope(monthly_reflection.reflection_view(root, path))

    @app.post("/api/v1/monthly-reflections/{reflection_id}/summary-draft", dependencies=[auth])
    def monthly_summary_draft(reflection_id: str, data: RevisionInput) -> dict[str, Any]:
        try:
            path = monthly_reflection.generate_summary(str(root), reflection_id, data.expected_revision)
        except SystemExit as exc:
            raise domain_error(exc) from None
        with profile.vault_lock(root):
            return envelope(monthly_reflection.reflection_view(root, path))

    @app.put("/api/v1/monthly-reflections/{reflection_id}/summary", dependencies=[auth])
    def monthly_summary(reflection_id: str, data: MonthlySummaryInput) -> dict[str, Any]:
        try:
            path = monthly_reflection.save_summary(str(root), reflection_id, data.summary, data.expected_revision)
        except SystemExit as exc:
            raise domain_error(exc) from None
        with profile.vault_lock(root):
            return envelope(monthly_reflection.reflection_view(root, path))

    @app.post("/api/v1/monthly-reflections/{reflection_id}/confirm", dependencies=[auth])
    def monthly_confirm(reflection_id: str, data: RevisionInput) -> dict[str, Any]:
        try:
            path = monthly_reflection.confirm(str(root), reflection_id, data.expected_revision)
        except SystemExit as exc:
            raise domain_error(exc) from None
        with profile.vault_lock(root):
            return envelope(monthly_reflection.reflection_view(root, path))

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

    @app.get("/api/v1/memory-stats", dependencies=[auth])
    def get_memory_stats() -> dict[str, Any]:
        with profile.vault_lock(root):
            return envelope(memory_stats(root))

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
